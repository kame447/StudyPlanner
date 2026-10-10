import { createOpenAiCompatibleClient, resetOpenAiCompatibleClientRequestBudgetForTest, type OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { createWeeklyPlanningSemanticNormalizerV5 } from '../semantic/weeklyPlanningSemanticNormalizerV5';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from '../semantic/weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { parseWeeklyPlanningFactGraphV5, serializeWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphValidatorV5';
import { loadWeeklyPlanningStableV5PersistedSession, saveWeeklyPlanningStableV5PersistedSession } from '../application/weeklyPlanningStableV5SessionStorage';
import { createInitialPlanningState } from '../weeklyPlanningReducer';
import { resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from './weeklyPlanningStableV5TraceRuntime';
import { listWeeklyPlanningTraceOutboxItems } from './weeklyPlanningTraceOutbox';
import type { WeeklyPlanningTraceTurnDiagnosticEntry } from './weeklyPlanningTraceTypes';

// The real client runs against a fully stubbed direct transport; no live proxy is used.
vi.mock('../../../lib/aiConfig', async importOriginal => ({
  ...await importOriginal<typeof import('../../../lib/aiConfig')>(),
  usesCloudflareOpenAiProxy: () => false,
}));

import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { createWeeklyPlanningSemanticPipelineV5 } from '../semantic/weeklyPlanningSemanticPipelineV5';
import { WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, type WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS,
  measureWeeklyPlanningTraceJsonBytes,
} from '../../../../shared/weeklyPlanningTraceContract';
import {
  prepareWeeklyPlanningTraceServerWrite,
} from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import {
  beginWeeklyPlanningStableV5DebugTrace,
  recordWeeklyPlanningStableV5DebugTrace,
  resetWeeklyPlanningStableV5DebugTraceForTest,
  takeWeeklyPlanningStableV5DebugTrace,
  type WeeklyPlanningStableV5DebugTraceEvent,
} from './weeklyPlanningStableV5DebugTrace';
import {
  recordWeeklyPlanningStableV5TurnTrace,
  resetWeeklyPlanningStableV5TraceRuntimeForTest,
} from './weeklyPlanningStableV5TraceRuntime';
import { createWeeklyPlanningTurnDiagnosticV2 } from './weeklyPlanningTurnDiagnosticV2';

const repositoryState = vi.hoisted(() => ({
  failWrites: true,
  attempts: [] as Array<{ session: Record<string, unknown>; entries: Record<string, unknown>[] }>,
  successfulWrites: [] as Array<{
    session: Record<string, unknown>;
    entries: Record<string, unknown>[];
  }>,
}));

vi.mock('./weeklyPlanningTraceRepository', () => ({
  isWeeklyPlanningTraceEnabled: () => true,
  getWeeklyPlanningTraceRepository: () => ({
    async appendEntries(params: {
      session: Record<string, unknown>;
      entries: Record<string, unknown>[];
    }) {
      repositoryState.attempts.push(structuredClone(params));
      if (repositoryState.failWrites) throw new Error('intentional trace write failure');
      repositoryState.successfulWrites.push(structuredClone(params));
    },
  }),
}));

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
}

function correctionTrace(requestId: string): WeeklyPlanningStableV5DebugTraceEvent[] {
  beginWeeklyPlanningStableV5DebugTrace(requestId);
  recordWeeklyPlanningStableV5DebugTrace({
    requestId,
    stage: 'canonical_correction_application_evaluated',
    data: {
      inputCanonicalization: {
        graph: { secretGraphPayload: 'must-not-be-persisted', facts: 'x'.repeat(40_000) },
      },
      application: { status: 'applied' },
      resultingCanonicalization: {
        graph: { secretGraphPayload: 'must-not-be-persisted' },
      },
    },
  });
  recordWeeklyPlanningStableV5DebugTrace({
    requestId,
    stage: 'semantic_canonicalization_evaluated',
    data: {
      branch: 'semantic_canonicalizer',
      result: { status: 'applied' },
      adoptedOperations: {
        fromRevision: 3,
        toRevision: 5,
        superseded: [{ kind: 'workload', id: 'workload-old' }],
        added: [{ kind: 'workload', id: 'workload-new' }],
        removed: [{ kind: 'correction_intent', id: 'correction-1' }],
        futureCorrectionSentinel: { retained: true },
      },
      localReferenceResolution: {
        replacement: 'workload-new',
      },
      rejectionErrors: [],
    },
  });
  return takeWeeklyPlanningStableV5DebugTrace(requestId);
}

function traceInput(params: {
  requestId: string;
  debugTraceEvents: WeeklyPlanningStableV5DebugTraceEvent[];
}) {
  return {
    userId: 'trace-user',
    conversationId: 'weekly-conversation-123e4567-e89b-52d3-a456-426614174000',
    requestId: params.requestId,
    userText: '数学は3時間ではなく1時間にしてください',
    assistantMessage: '数学の時間を1時間に変更しました。',
    responseSource: 'ai' as const,
    outcome: 'scheduler_ready',
    debugTraceEvents: params.debugTraceEvents,
    previewCount: 0,
  };
}

const subject = {
  token: `wpt_${'a'.repeat(43)}`,
  epoch: '100',
};
const canonicalIds = {
  sessionId: 'weekly-trace-123e4567-e89b-52d3-a456-426614174000',
  logicalConversationId: 'weekly-conversation-123e4567-e89b-52d3-a456-426614174000',
};

beforeEach(() => {
  repositoryState.failWrites = true;
  repositoryState.attempts.length = 0;
  repositoryState.successfulWrites.length = 0;
  vi.stubGlobal('window', { localStorage: createStorage() });
  resetWeeklyPlanningStableV5DebugTraceForTest();
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
});

afterEach(() => {
  resetOpenAiCompatibleClientRequestBudgetForTest();
  resetWeeklyPlanningStableV5DebugTraceForTest();
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  vi.unstubAllGlobals();
});

describe('weekly planning correction trace persistence gate', () => {
  it('queues a failed correction diagnostic, retries it, and passes Worker preparation', async () => {
    const firstRequestId = 'weekly-correction-trace-request-1';
    await recordWeeklyPlanningStableV5TurnTrace(traceInput({
      requestId: firstRequestId,
      debugTraceEvents: correctionTrace(firstRequestId),
    }));
    expect(repositoryState.attempts).toHaveLength(1);
    expect(repositoryState.successfulWrites).toHaveLength(0);

    repositoryState.failWrites = false;
    const secondRequestId = 'weekly-correction-trace-request-2';
    await recordWeeklyPlanningStableV5TurnTrace(traceInput({
      requestId: secondRequestId,
      debugTraceEvents: correctionTrace(secondRequestId),
    }));

    expect(repositoryState.successfulWrites).toHaveLength(2);
    const retried = repositoryState.successfulWrites[0];
    const retriedEntry = retried.entries[0];
    const serialized = JSON.stringify(retriedEntry);
    expect(serialized).not.toContain('must-not-be-persisted');
    expect(serialized).toContain('futureCorrectionSentinel');
    expect(serialized).toContain('workload-old');
    expect(measureWeeklyPlanningTraceJsonBytes(retriedEntry)).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes,
    );

    const prepared = prepareWeeklyPlanningTraceServerWrite({
      session: retried.session,
      entries: retried.entries,
    }, subject, canonicalIds, '2026-08-01T00:00:00.000Z');
    expect(prepared.entries).toHaveLength(1);
    expect(JSON.stringify(prepared.entries[0])).toContain('futureCorrectionSentinel');
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes,
    );
  });

  it('keeps a large correction turn savable with explicit truncation metadata', () => {
    const hugeDiff = Array.from({ length: 400 }, (_, index) => ({
      kind: 'workload',
      id: `workload-${index}`,
      details: 'x'.repeat(1_000),
    }));
    const diagnostic = createWeeklyPlanningTurnDiagnosticV2({
      id: `${canonicalIds.sessionId}-00000000`,
      sessionId: canonicalIds.sessionId,
      logicalConversationId: canonicalIds.logicalConversationId,
      sequence: 0,
      turnIndex: 0,
      requestId: 'large-correction-request',
      occurredAt: '2026-08-01T00:00:00.000Z',
      observedAt: '2026-08-01T00:00:00.000Z',
      expireAt: '2026-11-01T00:00:00.000Z',
      userText: '大量の訂正を確認するテスト',
      assistantMessage: '訂正内容を確認しました。',
      outcome: 'scheduler_ready',
      previewCount: 0,
      debugTraceEvents: [{
        schemaVersion: 2,
        sequence: 0,
        stage: 'semantic_canonicalization_evaluated',
        occurredAt: '2026-08-01T00:00:00.000Z',
        severity: 'info',
        data: {
          branch: 'semantic_canonicalizer',
          result: { status: 'applied' },
          adoptedOperations: {
            superseded: hugeDiff,
            added: hugeDiff,
            removed: hugeDiff,
          },
          localReferenceResolution: {},
          rejectionErrors: [],
        },
      }],
    });

    expect(diagnostic.diagnostics.truncation?.applied).toBe(true);
    expect(measureWeeklyPlanningTraceJsonBytes(diagnostic)).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes,
    );

    const prepared = prepareWeeklyPlanningTraceServerWrite({
      session: {
        id: canonicalIds.sessionId,
        logicalConversationId: canonicalIds.logicalConversationId,
        userId: 'trace-user',
        status: 'active',
        startedAt: '2026-08-01T00:00:00.000Z',
        lastActivityAt: '2026-08-01T00:00:00.000Z',
        turnCount: 1,
        entryCount: 1,
        hasPreview: false,
        hasApprovalFailure: false,
        hasFallback: false,
        hasError: false,
        appVersion: '0.1.0',
        schemaVersion: 2,
        expireAt: '2026-11-01T00:00:00.000Z',
      },
      entries: [diagnostic as unknown as Record<string, unknown>],
    }, subject, canonicalIds, '2026-08-01T00:00:00.000Z');

    expect(prepared.entries).toHaveLength(1);
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes,
    );
  });
});


it('persists real explicit-window correction diagnostics through failure, retry and Worker limits', async () => {
  for (const oversized of [false, true]) {
    repositoryState.failWrites = true;
    repositoryState.attempts.length = 0;
    repositoryState.successfulWrites.length = 0;
    window.localStorage.clear();
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    let document: WeeklyPlanningSemanticDocumentV5 = {
      schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, planningIntent: 'create_plan',
      planningWindow: { localId: 'old', kind: 'relative_day', value: 'tomorrow', start: null, end: null, sourceText: '明日の予定を立てたい' },
      tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], uncertainties: [], corrections: [], decisions: [],
    };
    const pipeline = createWeeklyPlanningSemanticPipelineV5({ normalize: async () => ({ status: 'accepted', document,
      diagnostics: { schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, jsonSchemaName: 'weekly_planning_semantic_document_v5',
        normalizerVersion: 'weekly-planning-semantic-normalizer-v5', attemptCount: 1, repairAttempted: false,
        requestBytes: [1], responseLengths: [1], latencyMs: 1, validationErrors: [], providerError: null } }) });
    const schedulerContext = { ownerId: 'trace-user', currentDate: '2026-10-06', planningStartDate: '2026-10-06', planningEndDate: '2026-10-06', timeZone: 'Asia/Tokyo' };
    const first = await pipeline.run({ graph: createEmptyWeeklyPlanningFactGraphV5(), conversationId: canonicalIds.logicalConversationId,
      turnId: 'window-initial', expectedRevision: 0, userText: '明日の予定を立てたい', recentConversation: [], publicStateSummary: {}, schedulerContext });
    const oldId = first.canonicalization!.localToFactId.old;
    document = { ...document, planningIntent: 'update_plan', planningWindow: { ...document.planningWindow!, localId: 'new', value: 'today', sourceText: '明日じゃなくて今日だ' },
      corrections: [{ localId: 'fix', target: { kind: 'planning_window', publicId: oldId, localId: null, mention: '明日' },
        operation: 'replace', replacementLocalId: 'new', sourceText: '明日じゃなくて今日だ' }] };
    const requestId = `window-trace-${oversized ? 'large' : 'small'}`;
    beginWeeklyPlanningStableV5DebugTrace(requestId);
    const corrected = await pipeline.run({ graph: first.graph, conversationId: canonicalIds.logicalConversationId,
      turnId: requestId, expectedRevision: first.graph.revision, userText: '明日じゃなくて今日だ', recentConversation: [], publicStateSummary: {}, schedulerContext });
    expect(corrected.canonicalization?.status).toBe('applied');
    const canonical = corrected.canonicalization!;
    const events = takeWeeklyPlanningStableV5DebugTrace(requestId);
    const event = events.find(entry => entry.stage === 'semantic_canonicalization_evaluated')!;
    expect(event).toBeDefined();
    const data = event.data as Record<string, unknown>;
    // Exceed the document budget while staying within the outbox's separate
    // 192 KiB ingress limit; overflowing that queue is intentionally rejected.
    data.adoptedOperations = { ...(data.adoptedOperations as Record<string, unknown>),
      futureWindowCorrectionSentinel: { retained: true }, ...(oversized ? { futureLargePayload: 'x'.repeat(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes * 2) } : {}) };
    await recordWeeklyPlanningStableV5TurnTrace({ ...traceInput({ requestId, debugTraceEvents: events }),
      userText: '明日じゃなくて今日だ', assistantMessage: '予定に入れる作業を教えてください。', outcome: 'nothing_to_schedule' });
    expect(repositoryState.successfulWrites).toHaveLength(0);
    expect(window.localStorage.length).toBeGreaterThan(0);
    repositoryState.failWrites = false;
    await recordWeeklyPlanningStableV5TurnTrace(traceInput({ requestId: `${requestId}-retry`, debugTraceEvents: [] }));
    expect(repositoryState.successfulWrites).toHaveLength(2);
    const retried = repositoryState.successfulWrites[0];
    // Retry rebuilds the observation timestamp; all original diagnostic content stays.
    const originalEntry = repositoryState.attempts[0].entries[0];
    const { observedAt: firstObservedAt, ...originalContent } = originalEntry;
    const { observedAt: retriedObservedAt, ...retriedContent } = retried.entries[0];
    expect(retriedContent).toEqual(originalContent);
    expect(Date.parse(String(retriedObservedAt))).toBeGreaterThanOrEqual(Date.parse(String(firstObservedAt)));
    const entry = retried.entries[0];
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const prepared = prepareWeeklyPlanningTraceServerWrite(retried, subject, canonicalIds, '2026-10-06T00:00:00Z');
    expect(prepared.entries).toHaveLength(1);
    const stored = prepared.entries[0];
    expect(measureWeeklyPlanningTraceJsonBytes(stored)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    const serialized = JSON.stringify(stored);
    if (oversized) {
      expect(serialized).toContain('truncation');
      expect(entry).toMatchObject({ diagnostics: { truncation: { applied: true } } });
    } else {
      expect(serialized).toContain('futureWindowCorrectionSentinel');
      expect(stored).toMatchObject({ decision: { stateDiff: {
        fromRevision: canonical.diff!.fromRevision, toRevision: canonical.diff!.toRevision,
        superseded: expect.arrayContaining([{ kind: 'planning_window', id: oldId }]),
        added: expect.arrayContaining([{ kind: 'planning_window', id: canonical.localToFactId.new }]),
        removed: expect.arrayContaining([{ kind: 'correction_intent', id: canonical.localToFactId.fix }]),
      } } });
      for (const id of [oldId, canonical.localToFactId.new, canonical.localToFactId.fix]) expect(serialized).toContain(id);
      for (const key of ['fromRevision', 'toRevision', 'superseded', 'added', 'removed']) expect(serialized).toContain(`"${key}"`);
      expect(serialized).toContain(`"fromRevision":${canonical.diff!.fromRevision}`);
      expect(serialized).toContain(`"toRevision":${canonical.diff!.toRevision}`);
    }
  }
});

const SELF_REFERENCE_TEXT = '資料は明日の13時まで、1回60分、週2回です。';
const SELF_REFERENCE_SENTINEL = 'future-h-self-reference-safe-field';
const TRANSPORT_ONLY_CREDENTIAL = 'synthetic-h-transport-only';
const SELF_REFERENCE_WEEK = '2026-10-11';

function selfReferenceFixture(target: 'self' | 'local') {
  const task = (localId: string, title: string): WeeklyPlanningSemanticDocumentV5['tasks'][number] => ({
    localId, existingPublicId: null, category: 'study', decompositionStatus: 'atomic', title,
    study: { purpose: 'self_study', activityKind: 'reading', contextLabel: null, components: [] },
    workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [],
    durableContextSignals: [], sourceText: SELF_REFERENCE_TEXT,
  });
  const base = (): WeeklyPlanningSemanticDocumentV5 => ({
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan', planningWindow: null, tasks: [], relations: [],
    availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [],
    uncertainties: [], corrections: [], decisions: [],
  });
  const setup = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
    graph: createEmptyWeeklyPlanningFactGraphV5(),
    document: { ...base(), tasks: [task('setup-a', '資料'), task('setup-b', '調整')] },
    context: { conversationId: canonicalIds.logicalConversationId, turnId: 'setup', expectedRevision: 0 },
  });
  if (setup.status !== 'applied') throw new Error(setup.errors.join(','));
  const ownId = setup.graph.tasks.find(item => item.title === '資料')!.id;
  const targetLocalId = target === 'self' ? ownId : 'shell';
  const document: WeeklyPlanningSemanticDocumentV5 = {
    ...base(), tasks: [{
      ...task('shell', '資料'), existingPublicId: ownId,
      temporalConstraints: [{
        localId: 'new-deadline', targetLocalId, kind: 'deadline', constraintLevel: 'hard',
        dateExpression: 'tomorrow', namedTimePeriod: null, startTime: '13:00', endTime: null,
        precision: 'exact', sourceText: SELF_REFERENCE_TEXT,
      }],
      effortEstimates: [{
        localId: 'new-effort', targetLocalId, kind: 'session_duration', minutes: 60,
        unitCode: 'session', precision: 'exact', sourceText: SELF_REFERENCE_TEXT,
      }],
      recurrence: [{
        localId: 'new-recurrence', targetLocalId, kind: 'times_per_week', count: 2, days: [],
        sourceText: SELF_REFERENCE_TEXT,
      }],
    }],
  };
  return { graph: setup.graph, ownId, document };
}

function checkpointRoundtrip(graph: ReturnType<typeof selfReferenceFixture>['graph']) {
  // Canonical target proof belongs to this checkpoint oracle, not to the trace entry.
  const serialized = serializeWeeklyPlanningFactGraphV5(graph);
  expect(parseWeeklyPlanningFactGraphV5(serialized).graph).toEqual(graph);
  expect(saveWeeklyPlanningStableV5PersistedSession({
    ownerId: 'trace-user', weekStartDate: SELF_REFERENCE_WEEK,
    conversationId: canonicalIds.logicalConversationId, graph,
    planningState: createInitialPlanningState(SELF_REFERENCE_WEEK),
  })).toBe(true);
  const restored = loadWeeklyPlanningStableV5PersistedSession({
    ownerId: 'trace-user', weekStartDate: SELF_REFERENCE_WEEK,
  });
  expect(restored?.graph).toEqual(graph);
  return restored!.graph;
}

async function generatedSelfReferenceTurn(mode: 'self' | 'local' | 'repair', oversized = false) {
  const fixture = selfReferenceFixture(mode === 'local' ? 'local' : 'self');
  const graph = checkpointRoundtrip(fixture.graph);
  const before = structuredClone(graph);
  const compact = JSON.stringify(fixture.document);
  // Internal whitespace survives the real client's trim(), unlike trailing padding.
  const acceptedRaw = oversized ? `{${' '.repeat(6_000)}${compact.slice(1)}` : compact;
  const scripted = mode === 'repair' ? ['not-json', acceptedRaw] : [acceptedRaw];
  const requests: Array<Parameters<OpenAiCompatibleClient['createChatCompletion']>[0]> = [];
  const bodies: Record<string, unknown>[] = [];
  const transport = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${TRANSPORT_ONLY_CREDENTIAL}`);
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const content = scripted.shift();
    if (content === undefined) throw new Error('scripted self-reference provider exhausted');
    return Response.json({ choices: [{ message: { content } }] });
  });
  vi.stubGlobal('fetch', transport);
  const client = createOpenAiCompatibleClient({
    provider: 'openai', baseUrl: 'https://self-reference.invalid/v1', model: 'gpt-5.4-mini',
    apiKey: TRANSPORT_ONLY_CREDENTIAL,
  });
  const delegate = client.createChatCompletion.bind(client);
  client.createChatCompletion = async request => {
    requests.push(structuredClone(request));
    return delegate(request);
  };
  const requestId = 'h-self-reference-trace-request';
  beginWeeklyPlanningStableV5DebugTrace(requestId);
  const result = await createWeeklyPlanningSemanticPipelineV5(
    createWeeklyPlanningSemanticNormalizerV5(client),
  ).run({
    graph, conversationId: canonicalIds.logicalConversationId, turnId: requestId,
    expectedRevision: graph.revision, userText: SELF_REFERENCE_TEXT,
    schedulerContext: { ownerId: 'trace-user', currentDate: '2026-10-10',
      planningStartDate: SELF_REFERENCE_WEEK, planningEndDate: '2026-10-17', timeZone: 'Asia/Tokyo' },
  });
  expect(result.normalization.status).toBe('accepted');
  expect(result.canonicalization?.status).toBe('applied');
  expect(graph).toEqual(before);
  expect(transport).toHaveBeenCalledTimes(mode === 'repair' ? 2 : 1);
  expect(scripted).toEqual([]);
  bodies.forEach((body, index) => {
    expect(body.messages).toEqual(requests[index].messages);
    expect(body.response_format).toEqual(requests[index].responseFormat);
    expect(body.max_completion_tokens).toBe(requests[index].maxCompletionTokens);
  });
  const events = takeWeeklyPlanningStableV5DebugTrace(requestId);
  expect(JSON.stringify(events)).not.toContain(TRANSPORT_ONLY_CREDENTIAL);
  const attempt = mode === 'repair' ? 'repair' : 'initial';
  const requestEvents = events.filter(event => event.stage === 'semantic_provider_request');
  expect(requestEvents).toHaveLength(requests.length);
  requestEvents.forEach((event, index) => {
    const data = event.data as { attempt: string; requestBytes: number; request: { messages: Array<{role: string; content: string}> } };
    expect(data.attempt).toBe(index === 0 ? 'initial' : 'repair');
    expect(data.requestBytes).toBe(measureWeeklyPlanningTraceJsonBytes(requests[index]));
    data.request.messages.forEach((message, messageIndex) => {
      const original = requests[index].messages[messageIndex];
      expect(message.role).toBe(original.role);
      if (new TextEncoder().encode(original.content).byteLength <= 20_000) expect(message.content).toBe(original.content);
      else {
        expect(message.content).toContain(original.content.slice(0, 100));
        expect(message.content).toContain(original.content.slice(-100));
        expect(message.content).toContain('trace head-tail');
      }
    });
  });
  const validation = events.find(event => event.stage === 'semantic_validation_result'
    && (event.data as { attempt?: string }).attempt === attempt);
  expect(validation).toBeDefined();
  const validationData = validation!.data as { accepted: boolean; parsedDocument: Record<string, unknown> };
  expect(validationData.accepted).toBe(true);
  // The existing collector clips this depth-five array, even when empty.
  // Keep every H target, scalar value and source field exact; do not claim a lossless parsed document.
  const expectedParsed = structuredClone(result.normalization.document) as unknown as {
    tasks: Array<{ recurrence: Array<{ days: unknown }> }>;
  };
  expect(expectedParsed.tasks[0].recurrence[0].days).toEqual([]);
  expectedParsed.tasks[0].recurrence[0].days = '[trace depth limit]';
  expect(validationData.parsedDocument).toEqual(expectedParsed);
  // Only these safe diagnostic-only fields are simulated. All semantic fields stay producer-derived.
  validationData.parsedDocument = { ...validationData.parsedDocument,
    futureSelfReferenceTraceField: SELF_REFERENCE_SENTINEL,
    ...(oversized ? { futureLargeSelfReferenceField: 'x'.repeat(48 * 1024) } : {}),
  };
  const { futureSelfReferenceTraceField: _future, futureLargeSelfReferenceField: _large, ...realDocument } = validationData.parsedDocument;
  expect(realDocument).toEqual(expectedParsed);
  const restored = checkpointRoundtrip(result.graph);
  for (const facts of [restored.temporalConstraints, restored.effortEstimates, restored.recurrences]) {
    expect(facts).toHaveLength(1);
    expect(facts[0].targetFactId).toBe(fixture.ownId);
    expect(facts[0].taskId).toBe(fixture.ownId);
    expect(facts[0].source).toMatchObject({ conversationId: canonicalIds.logicalConversationId,
      turnId: requestId, sourceText: SELF_REFERENCE_TEXT });
  }
  expect(restored.recurrences[0].days).toEqual([]);
  expect(restored.tasks).toEqual(graph.tasks);
  return { fixture, result, events, acceptedRaw, requestId, attempt, requests, expectedParsed };
}

async function persistGeneratedSelfReference(turn: Awaited<ReturnType<typeof generatedSelfReferenceTurn>>) {
  const input = { ...traceInput({ requestId: turn.requestId, debugTraceEvents: turn.events }),
    userText: SELF_REFERENCE_TEXT, assistantMessage: '条件を確認しました。', outcome: turn.result.status };
  await recordWeeklyPlanningStableV5TurnTrace(input);
  expect(repositoryState.attempts).toHaveLength(1);
  expect(repositoryState.successfulWrites).toHaveLength(0);
  const queued = listWeeklyPlanningTraceOutboxItems({ userId: input.userId, conversationId: input.conversationId });
  expect(queued).toHaveLength(1);
  expect(queued[0].input).toEqual(input);
  expect(measureWeeklyPlanningTraceJsonBytes(queued[0])).toBeLessThanOrEqual(192 * 1024);
  expect(JSON.stringify(queued)).not.toContain(TRANSPORT_ONLY_CREDENTIAL);
  resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
  repositoryState.failWrites = false;
  await recordWeeklyPlanningStableV5TurnTrace({ ...input, requestId: `${turn.requestId}:retry`, debugTraceEvents: [] });
  expect(repositoryState.successfulWrites).toHaveLength(2);
  expect(listWeeklyPlanningTraceOutboxItems({ userId: input.userId, conversationId: input.conversationId })).toEqual([]);
  const replayed = repositoryState.successfulWrites[0];
  const entry = replayed.entries[0] as unknown as WeeklyPlanningTraceTurnDiagnosticEntry;
  const original = repositoryState.attempts[0].entries[0];
  const { observedAt: firstObservedAt, ...firstContent } = original;
  const { observedAt, ...replayedContent } = entry;
  expect(replayedContent).toEqual(firstContent);
  expect(Date.parse(observedAt)).toBeGreaterThanOrEqual(Date.parse(String(firstObservedAt)));
  expect(entry.requestId).toBe(turn.requestId);
  expect(repositoryState.successfulWrites[1].entries[0].sequence).toBe(entry.sequence + 1);
  expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
  const prepared = prepareWeeklyPlanningTraceServerWrite(replayed, subject, canonicalIds, '2026-10-10T00:00:00.000Z');
  expect(prepared.entries).toHaveLength(1);
  const stored = prepared.entries[0];
  expect(stored.requestId).toBe(turn.requestId);
  expect(stored.aiInterpreter).toEqual(entry.aiInterpreter);
  expect(stored).not.toHaveProperty('userId');
  expect(prepared.session).not.toHaveProperty('userId');
  expect(JSON.stringify(prepared)).not.toContain(TRANSPORT_ONLY_CREDENTIAL);
  expect(measureWeeklyPlanningTraceJsonBytes(stored)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
  return { replayed, entry, stored };
}

function resetSelfReferenceWorld() {
  repositoryState.failWrites = true;
  repositoryState.attempts.length = 0;
  repositoryState.successfulWrites.length = 0;
  window.localStorage.clear();
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  resetWeeklyPlanningStableV5DebugTraceForTest();
  resetOpenAiCompatibleClientRequestBudgetForTest();
}

it('preserves generated own-task public-to-local evidence through failed append, reload, retry and Worker preparation', async () => {
  let expectedGraph: ReturnType<typeof selfReferenceFixture>['graph'] | undefined;
  for (const mode of ['local', 'self', 'repair'] as const) {
    // Independent fixture worlds use equal turn identities so canonical source equality is meaningful.
    resetSelfReferenceWorld();
    const turn = await generatedSelfReferenceTurn(mode);
    const { replayed, entry } = await persistGeneratedSelfReference(turn);
    if (expectedGraph) expect(turn.result.graph).toEqual(expectedGraph);
    else expectedGraph = structuredClone(turn.result.graph);
    const raw = entry.aiInterpreter.rawResponses.find(response => response.attempt === turn.attempt)!;
    expect(raw).toBeDefined();
    expect(raw.truncated).toBe(false);
    expect(raw.text).toBe(turn.acceptedRaw);
    const rawDocument = JSON.parse(raw.text) as WeeklyPlanningSemanticDocumentV5;
    const accepted = entry.aiInterpreter.structuredResults.find(result => result.attempt === turn.attempt && result.accepted)!;
    expect(accepted).toBeDefined();
    expect(rawDocument.tasks[0].recurrence[0].days).toEqual([]);
    expect(accepted.structuredResult).toEqual({ ...turn.expectedParsed,
      futureSelfReferenceTraceField: SELF_REFERENCE_SENTINEL });
    const parsed = accepted.structuredResult as WeeklyPlanningSemanticDocumentV5;
    for (const kind of ['temporalConstraints', 'effortEstimates', 'recurrence'] as const) {
      expect(rawDocument.tasks[0][kind][0].targetLocalId).toBe(mode === 'local' ? 'shell' : turn.fixture.ownId);
      expect(parsed.tasks[0][kind][0].targetLocalId).toBe(parsed.tasks[0].localId);
    }
    expect(entry.aiInterpreter.input.planningStateSummary).toMatchObject({
      tasks: turn.fixture.graph.tasks.map(task => ({ publicId: task.id, category: task.category, title: task.title })),
    });
    expect(entry.aiInterpreter.input.requests.map(request => request.attempt)).toEqual(mode === 'repair' ? ['initial', 'repair'] : ['initial']);
    entry.aiInterpreter.input.requests.forEach((request, index) => {
      expect(request.requestBytes).toBe(measureWeeklyPlanningTraceJsonBytes(turn.requests[index]));
      expect(request.purpose).toBe(turn.requests[index].purpose);
      expect(request.maxCompletionTokens).toBe(turn.requests[index].maxCompletionTokens);
    });
    expect(entry.aiInterpreter.rawResponses.map(response => response.attempt)).toEqual(mode === 'repair' ? ['initial', 'repair'] : ['initial']);
    if (mode === 'repair') {
      expect(entry.aiInterpreter.rawResponses[0].text).toBe('not-json');
      expect(entry.aiInterpreter.structuredResults[0]).toMatchObject({ attempt: 'initial', accepted: false });
    }
    // Existing Worker v2 policy rejects forbidden owner keys; it does not redact arbitrary diagnostic text.
    const tampered = structuredClone(replayed);
    (tampered.entries[0].diagnostics as Record<string, unknown>).futureOwnerCheck = { userId: 'synthetic-wrong-owner' };
    expect(() => prepareWeeklyPlanningTraceServerWrite(tampered, subject, canonicalIds, '2026-10-10T00:00:00.000Z'))
      .toThrow('trace turn diagnostic entry schema is invalid');
  }
});

it('saves a generated self-reference turn with explicit raw and structured truncation', async () => {
  resetSelfReferenceWorld();
  const turn = await generatedSelfReferenceTurn('self', true);
  const { entry, stored } = await persistGeneratedSelfReference(turn);
  const raw = entry.aiInterpreter.rawResponses.find(response => response.attempt === turn.attempt)!;
  expect(raw.truncated).toBe(true);
  expect(raw.originalBytes).toBe(new TextEncoder().encode(turn.acceptedRaw).byteLength);
  expect(raw.checksum).toMatch(/^fnv1a32:/);
  expect(raw.text).toContain('trace head-tail');
  expect(raw.text).not.toBe(turn.acceptedRaw);
  const accepted = entry.aiInterpreter.structuredResults.find(result => result.attempt === turn.attempt && result.accepted)!;
  expect(accepted.structuredResult).toMatchObject({ traceTruncated: true, originalBytes: expect.any(Number), checksum: expect.stringMatching(/^fnv1a32:/) });
  expect(entry.diagnostics.truncation).toMatchObject({ applied: true });
  expect(JSON.stringify(entry.diagnostics.truncation)).toContain('aiInterpreter.rawResponses[0].text');
  expect(JSON.stringify(entry.diagnostics.truncation)).toContain('aiInterpreter.structuredResults[0].structuredResult');
  expect(JSON.stringify(stored)).not.toContain('x'.repeat(48 * 1024));
  // Truncated raw/document evidence is explicitly partial, not a claim of complete target reconstruction.
});
