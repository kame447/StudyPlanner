import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from '../semantic/weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOpenAiCompatibleClient, resetOpenAiCompatibleClientRequestBudgetForTest, type OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { createWeeklyPlanningSemanticNormalizerV5 } from '../semantic/weeklyPlanningSemanticNormalizerV5';
import { createWeeklyPlanningSemanticPipelineV5 } from '../semantic/weeklyPlanningSemanticPipelineV5';
import { materialIdentityDocument, materialIdentityState, materialIdentityEffortFixture, MATERIAL_IDENTITY_TEXT } from '../testUtils/__tests__/weeklyPlanningMaterialIdentityFixture';
import { createMemoryStorageHarness } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { loadWeeklyPlanningStableV5PersistedSession, saveWeeklyPlanningStableV5PersistedSession } from '../application/weeklyPlanningStableV5SessionStorage';
import { createInitialPlanningState } from '../weeklyPlanningReducer';
import { isWeeklyPlanningFactActiveV5 } from '../semantic/weeklyPlanningFactLifecycleV5';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { beginWeeklyPlanningStableV5DebugTrace, resetWeeklyPlanningStableV5DebugTraceForTest, takeWeeklyPlanningStableV5DebugTrace } from './weeklyPlanningStableV5DebugTrace';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from './weeklyPlanningStableV5TraceRuntime';
import { listWeeklyPlanningTraceOutboxItems } from './weeklyPlanningTraceOutbox';
import type { WeeklyPlanningTraceTurnDiagnosticEntry } from './weeklyPlanningTraceTypes';

vi.mock('../../../lib/aiConfig', async importOriginal => ({
  ...await importOriginal<typeof import('../../../lib/aiConfig')>(), usesCloudflareOpenAiProxy: () => false,
}));
const repository = vi.hoisted(() => ({ fail: true,
  attempts: [] as Array<{ session: Record<string, unknown>; entries: Record<string, unknown>[] }>,
  writes: [] as Array<{ session: Record<string, unknown>; entries: Record<string, unknown>[] }>,
}));
vi.mock('./weeklyPlanningTraceRepository', () => ({ isWeeklyPlanningTraceEnabled: () => true,
  getWeeklyPlanningTraceRepository: () => ({ async appendEntries(params: { session: Record<string, unknown>; entries: Record<string, unknown>[] }) {
    repository.attempts.push(structuredClone(params));
    if (repository.fail) throw new Error('intentional first append failure');
    repository.writes.push(structuredClone(params));
  } }),
}));
const ids = { sessionId: 'weekly-trace-123e4567-e89b-52d3-a456-426614174000', logicalConversationId: 'weekly-conversation-123e4567-e89b-52d3-a456-426614174000' };
const owner = 'material-identity-owner';
const week = '2026-10-11';
const transportCredential = 'synthetic-material-transport-only';
const sentinel = 'future-material-identity-safe-field';
beforeEach(() => {
  repository.fail = true; repository.attempts.length = 0; repository.writes.length = 0;
  resetOpenAiCompatibleClientRequestBudgetForTest(); resetWeeklyPlanningStableV5DebugTraceForTest();
  vi.stubGlobal('window', { localStorage: createMemoryStorageHarness().storage });
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
});
afterEach(() => { resetOpenAiCompatibleClientRequestBudgetForTest(); resetWeeklyPlanningStableV5TraceRuntimeForTest(); resetWeeklyPlanningStableV5DebugTraceForTest(); vi.unstubAllGlobals(); });

describe('explicit material identity actual normalization and persistence boundaries', () => {
  it.each([{ oversized: false, independentDetail: false }, { oversized: true, independentDetail: false },
    { oversized: false, independentDetail: true }, { oversized: true, independentDetail: true }])('retains generated identity evidence through reload, failed append, retry and Worker (%j)', async ({ oversized, independentDetail }) => {
    const fixture = materialIdentityEffortFixture();
    const graph = independentDetail ? fixture.graph : materialIdentityState();
    const userText = independentDetail ? fixture.userText : MATERIAL_IDENTITY_TEXT;
    // Persisted sessions require every accepted fact to belong to this exact
    // conversation, including the fixture's historical facts.
    for (const facts of [graph.tasks, graph.components, graph.workloads, graph.effortEstimates, graph.temporalConstraints, graph.uncertainties]) {
      for (const fact of facts) fact.source = { ...fact.source, conversationId: ids.logicalConversationId };
    }
    expect(saveWeeklyPlanningStableV5PersistedSession({ ownerId: owner, weekStartDate: week, conversationId: ids.logicalConversationId,
      graph, planningState: createInitialPlanningState(week) })).toBe(true);
    const before = structuredClone(graph);
    const document = independentDetail ? fixture.document : materialIdentityDocument();
    const compact = JSON.stringify(document);
    const rawResponse = oversized ? `{${' '.repeat(6000)}${compact.slice(1)}` : compact;
    const requests: Array<Parameters<OpenAiCompatibleClient['createChatCompletion']>[0]> = [];
    const bodies: Record<string, unknown>[] = [];
    const transport = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${transportCredential}`);
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (bodies.length > 1) throw new Error('identity fixture must not request an extra model call');
      return Response.json({ choices: [{ message: { content: rawResponse } }] });
    });
    vi.stubGlobal('fetch', transport);
    const client = createOpenAiCompatibleClient({ provider: 'openai', baseUrl: 'https://material-identity.invalid/v1', model: 'gpt-5.4-mini', apiKey: transportCredential });
    const delegate = client.createChatCompletion.bind(client);
    client.createChatCompletion = async request => { requests.push(structuredClone(request)); return delegate(request); };
    const requestId = `material-identity-${oversized ? 'large' : 'normal'}`;
    beginWeeklyPlanningStableV5DebugTrace(requestId);
    const result = await createWeeklyPlanningSemanticPipelineV5(createWeeklyPlanningSemanticNormalizerV5(client)).run({
      graph, conversationId: ids.logicalConversationId, turnId: requestId, expectedRevision: graph.revision,
      userText, publicStateSummary: { pendingQuestion: { actionId: 'ask-material', questionCode: 'semantic_uncertainty', targetFactId: 'u', graphRevision: graph.revision } },
      schedulerContext: { ownerId: owner, currentDate: '2026-10-10', planningStartDate: week, planningEndDate: '2026-10-17', timeZone: 'Asia/Tokyo' },
    });
    expect(result.normalization.status, JSON.stringify(result.normalization.diagnostics)).toBe('accepted');
    expect(result.normalization.diagnostics.attemptCount).toBe(1);
    expect(result.normalization.document).toEqual(document);
    expect(result.canonicalization?.status, JSON.stringify(result.canonicalization?.errors)).toBe('applied');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(bodies[0].messages).toEqual(requests[0].messages);
    expect(bodies[0].response_format).toEqual(requests[0].responseFormat);
    expect(graph).toEqual(before);
    const canonical = result.canonicalization!;
    const replacement = canonical.localToFactId.material;
    expect(replacement).not.toBe('m');
    expect(isWeeklyPlanningFactActiveV5(result.graph, 'u')).toBe(false);
    expect(isWeeklyPlanningFactActiveV5(result.graph, 'other')).toBe(true);
    if (independentDetail) {
      expect(isWeeklyPlanningFactActiveV5(result.graph, 'u_effort')).toBe(false);
      expect(result.graph.effortEstimates.find(fact => fact.id === canonical.localToFactId.total))
        .toMatchObject({ kind: 'total_duration', minutes: 60, targetFactId: replacement });
      expect(canonical.diff!.removed).toContainEqual({ kind: 'uncertainty', id: 'u_effort' });
    }
    expect(result.scheduler?.issues.some(issue => issue.factId === 'u')).toBe(false);
    expect(result.scheduler?.issues.some(issue => issue.factId === 'other')).toBe(true);
    const events = takeWeeklyPlanningStableV5DebugTrace(requestId);
    const providerRequest = events.find(event => event.stage === 'semantic_provider_request');
    expect(providerRequest?.data).toMatchObject({ attempt: 'initial', requestBytes: measureWeeklyPlanningTraceJsonBytes(requests[0]) });
    const validation = events.find(event => event.stage === 'semantic_validation_result')!;
    // The existing collector bounds deeply nested component payloads. The full
    // accepted document above, actual raw response below and canonical diff own
    // the exact identity proof; do not mistake the trace view for a full graph.
    expect(validation.data).toMatchObject({ accepted: true, parsedDocument: {
      corrections: document.corrections, tasks: [expect.objectContaining({ existingPublicId: 't',
        study: expect.objectContaining({ components: ['[trace depth limit]'] }) })],
    } });
    const canonicalEvent = events.find(event => event.stage === 'semantic_canonicalization_evaluated')!;
    const data = canonicalEvent.data as Record<string, unknown>;
    data.adoptedOperations = { ...(data.adoptedOperations as Record<string, unknown>), futureMaterialIdentityField: sentinel,
      ...(oversized ? { futureLargeMaterialIdentityField: 'x'.repeat(48 * 1024) } : {}) };
    const state = createInitialPlanningState(week);
    expect(saveWeeklyPlanningStableV5PersistedSession({ ownerId: owner, weekStartDate: week, conversationId: ids.logicalConversationId, graph: result.graph, planningState: state })).toBe(true);
    const restored = loadWeeklyPlanningStableV5PersistedSession({ ownerId: owner, weekStartDate: week });
    expect(restored?.graph).toEqual(result.graph);
    const repeated = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({ graph: restored!.graph, document,
      context: { conversationId: ids.logicalConversationId, turnId: requestId, userText, expectedRevision: restored!.graph.revision } });
    expect(repeated.status).toBe('duplicate'); expect(repeated.graph).toEqual(restored!.graph);
    expect(loadWeeklyPlanningStableV5PersistedSession({ ownerId: 'foreign', weekStartDate: week })).toBeNull();
    const input = { userId: owner, conversationId: ids.logicalConversationId, requestId, userText,
      assistantMessage: '別の確認を続けます。', responseSource: 'ai' as const, outcome: result.status, debugTraceEvents: events, previewCount: 0 };
    await recordWeeklyPlanningStableV5TurnTrace(input);
    expect(repository.writes).toHaveLength(0);
    const queued = listWeeklyPlanningTraceOutboxItems({ userId: owner, conversationId: ids.logicalConversationId });
    expect(queued).toHaveLength(1); expect(queued[0].input).toEqual(input);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest(); repository.fail = false;
    await recordWeeklyPlanningStableV5TurnTrace({ ...input, requestId: `${requestId}-retry`, debugTraceEvents: [] });
    expect(repository.writes).toHaveLength(2);
    expect(listWeeklyPlanningTraceOutboxItems({ userId: owner, conversationId: ids.logicalConversationId })).toEqual([]);
    const retried = repository.writes[0];
    const entry = retried.entries[0] as unknown as WeeklyPlanningTraceTurnDiagnosticEntry;
    const { observedAt: originalObservedAt, ...originalContent } = repository.attempts[0].entries[0];
    const { observedAt: retryObservedAt, ...retryContent } = entry;
    expect(retryContent).toEqual(originalContent); expect(Date.parse(retryObservedAt)).toBeGreaterThanOrEqual(Date.parse(String(originalObservedAt)));
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const prepared = prepareWeeklyPlanningTraceServerWrite(retried, { token: `wpt_${'a'.repeat(43)}`, epoch: '100' }, ids, '2026-10-11T00:00:00Z');
    expect(prepared.entries).toHaveLength(1);
    const stored = prepared.entries[0];
    expect(measureWeeklyPlanningTraceJsonBytes(stored)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    expect(JSON.stringify(prepared)).not.toContain(transportCredential);
    expect(stored).not.toHaveProperty('userId');
    expect(entry.aiInterpreter.input.requests).toHaveLength(1);
    expect(entry.aiInterpreter.input.requests[0].requestBytes).toBe(measureWeeklyPlanningTraceJsonBytes(requests[0]));
    if (oversized) {
      expect(entry.diagnostics.truncation).toMatchObject({ applied: true });
      expect(entry.aiInterpreter.rawResponses[0]).toMatchObject({ truncated: true, originalBytes: new TextEncoder().encode(rawResponse).byteLength, checksum: expect.stringMatching(/^fnv1a32:/) });
      expect(JSON.stringify(stored)).not.toContain('x'.repeat(48 * 1024));
    } else {
      if (independentDetail) expect(stored).toMatchObject({ decision: { stateDiff: { removed: expect.arrayContaining([{ kind: 'uncertainty', id: 'u_effort' }]) } } });
      expect(entry.aiInterpreter.rawResponses[0]).toMatchObject({ text: rawResponse, truncated: false });
      expect(JSON.stringify(stored)).toContain(sentinel);
      expect(stored).toMatchObject({ decision: { stateDiff: {
        fromRevision: before.revision, toRevision: result.graph.revision,
        added: expect.arrayContaining([{ kind: 'component', id: replacement }]),
        superseded: expect.arrayContaining([{ kind: 'component', id: 'm' }]),
        removed: expect.arrayContaining([{ kind: 'uncertainty', id: 'u' }, { kind: 'correction_intent', id: canonical.localToFactId.correction }]),
      } } });
    }
  });
});
