import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOpenAiCompatibleClient, resetOpenAiCompatibleClientRequestBudgetForTest } from '../../../services/ai/openAiCompatibleClient';
import { executeIsolatedWeeklyPlanningTurn, type IsolatedWeeklyPlanningTurnResult } from '../application/weeklyPlanningIsolatedTurn';
import { durableReceipt } from '../application/weeklyPlanningDurableTurn.testUtils';
import { executeDurableWeeklyTurn } from '../application/weeklyPlanningDurableTurnClient';
import { recordCommittedWeeklyPlanningApplicationTurn, recordDiscardedWeeklyPlanningApplicationTurn, recordFailedWeeklyPlanningApplicationTurn } from '../application/weeklyPlanningTurnTraceSideEffects';
import { createMemoryStorageHarness } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { successfulWeeklyPlanningRendererCompletion } from '../testUtils/__tests__/weeklyPlanningRendererCompletionFixture';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import type { WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
import { readWeeklyPlanningStableV5DebugTrace, recordWeeklyPlanningStableV5DebugTrace, resetWeeklyPlanningStableV5DebugTraceForTest } from './weeklyPlanningStableV5DebugTrace';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from './weeklyPlanningStableV5TraceRuntime';
import { listWeeklyPlanningTraceOutboxItems } from './weeklyPlanningTraceOutbox';
import type { WeeklyPlanningTraceTurnDiagnosticEntry } from './weeklyPlanningTraceTypes';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { DURABLE_TURN_LIMITS } from '../../../../workers/ai-proxy/src/durableTurns/durableTurnJob';
import { serializeWeeklyPlanningTurnResult } from '../../../../workers/ai-proxy/src/durableTurns/weeklyPlanningTurnResult';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../../shared/weeklyPlanningTraceContract';

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
const userText = '10月14日に数学を60分勉強したい';
const credential = 'synthetic-isolated-transport-only';
const sentinel = 'future-isolated-trace-safe-field';
function document(): WeeklyPlanningSemanticDocumentV5 {
  return { schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'create_plan',
    planningWindow: { localId: 'window', kind: 'absolute', value: '2026-10-14', start: '2026-10-14', end: '2026-10-14', sourceText: userText },
    tasks: [{ localId: 'math', category: 'study', title: '数学', study: { purpose: 'self_study', contextLabel: '数学', components: [] },
      sourceText: userText, workloads: [{ localId: 'work', quantityRole: 'target', amount: 60, unitCode: 'minute', unitLabel: '分',
        rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: userText }],
      effortEstimates: [], recurrence: [], temporalConstraints: [] }],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [] };
}
beforeEach(() => {
  repository.fail = true; repository.attempts.length = 0; repository.writes.length = 0;
  vi.stubGlobal('window', { localStorage: createMemoryStorageHarness().storage });
  resetOpenAiCompatibleClientRequestBudgetForTest(); resetWeeklyPlanningStableV5TraceRuntimeForTest(); resetWeeklyPlanningStableV5DebugTraceForTest();
});
afterEach(() => {
  resetOpenAiCompatibleClientRequestBudgetForTest(); resetWeeklyPlanningStableV5TraceRuntimeForTest(); resetWeeklyPlanningStableV5DebugTraceForTest(); vi.unstubAllGlobals();
});

describe('isolated trace transport through application, outbox retry and Worker preparation', () => {
  it.each(['committed', 'discarded', 'failed'] as const)('retains actual provider and repair evidence for a %s turn', async kind => {
    await verifyPersistence(kind, false);
  });
  it('saves a large isolated trace with explicit truncation instead of dropping the turn', async () => {
    await verifyPersistence('committed', true);
  });
  it('persists a durable output-limit truncation notice through failed append, retry and Worker preparation', async () => {
    const receipt = durableReceipt();
    const graph = createEmptyWeeklyPlanningFactGraphV5(); graph.appliedTurnKeys = [''];
    const output: IsolatedWeeklyPlanningTurnResult = { result: { state: createInitialPlanningIntakeState(),
      message: '候補を確認してください。', draftCandidates: [], stableV5Graph: graph }, stagedContextFacts: [], observedDate: '2026-10-14' };
    graph.appliedTurnKeys[0] = 'x'.repeat(DURABLE_TURN_LIMITS.outputBytes - measureWeeklyPlanningTraceJsonBytes(output) - 1000);
    recordWeeklyPlanningStableV5DebugTrace({ requestId: receipt.pending.requestId, stage: 'semantic_provider_response',
      data: { attempt: 'initial', rawResponse: 'r'.repeat(3000), responseLength: 3000 } });
    output.result.debugTraceEvents = readWeeklyPlanningStableV5DebugTrace(receipt.pending.requestId);
    resetWeeklyPlanningStableV5DebugTraceForTest();
    const transported = JSON.parse(serializeWeeklyPlanningTurnResult(output)) as IsolatedWeeklyPlanningTurnResult;
    expect(transported.result.debugTraceEvents).toMatchObject([{ stage: 'trace_collector_truncated', data: { reason: 'durable_output_limit' } }]);
    await recordCommittedWeeklyPlanningApplicationTurn({ ownerId: receipt.ownerId, pending: receipt.pending, userText, result: transported.result });
    expect(repository.writes).toEqual([]);
    const queued = listWeeklyPlanningTraceOutboxItems({ userId: receipt.ownerId, conversationId: receipt.pending.conversationId });
    expect(queued).toHaveLength(1);
    expect(queued[0].input.debugTraceEvents).toEqual(transported.result.debugTraceEvents);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest(); repository.fail = false;
    await recordWeeklyPlanningStableV5TurnTrace({ ...queued[0].input, requestId: 'retry-truncated-turn', debugTraceEvents: [] });
    expect(repository.writes).toHaveLength(2);
    expect(listWeeklyPlanningTraceOutboxItems({ userId: receipt.ownerId, conversationId: receipt.pending.conversationId })).toEqual([]);
    const write = repository.writes[0];
    const entry = write.entries[0] as unknown as WeeklyPlanningTraceTurnDiagnosticEntry;
    expect(entry.diagnostics.truncation).toMatchObject({ applied: true, fields: expect.arrayContaining(['debugTraceEvents']), originalCounts: { debugTraceEvents: 1 } });
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const prepared = prepareWeeklyPlanningTraceServerWrite(write, { token: `wpt_${'a'.repeat(43)}`, epoch: '100' }, ids, '2026-10-14T00:00:00Z');
    expect(prepared.entries).toHaveLength(1);
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    expect((prepared.entries[0].diagnostics as Record<string, unknown>).truncation).toMatchObject({ applied: true,
      fields: expect.arrayContaining(['debugTraceEvents']), originalCounts: { debugTraceEvents: 1 } });
  });
});

async function verifyPersistence(kind: 'committed' | 'discarded' | 'failed', oversized: boolean) {
  const receipt = durableReceipt();
  receipt.pending.conversationId = receipt.payload.input.conversationId = ids.logicalConversationId;
  receipt.payload.input.userText = userText;
  const requestId = receipt.payload.input.traceRequestId;
  const compact = JSON.stringify(document());
  const raw = oversized ? `{${' '.repeat(6000)}${compact.slice(1)}` : compact;
  const requests: Array<{ messages: Array<{ role: string; content: string }>; response_format?: unknown }> = [];
  const semanticResponses = ['{}', raw];
  vi.stubGlobal('fetch', async (_url: RequestInfo | URL, init?: RequestInit) => {
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${credential}`);
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    const content = body.response_format?.json_schema?.name === 'weekly_planning_semantic_document_v5'
      ? semanticResponses.shift() : await successfulWeeklyPlanningRendererCompletion(body);
    expect(content).toBeTypeOf('string');
    return Response.json({ choices: [{ message: { content } }] });
  });
  const client = createOpenAiCompatibleClient({ provider: 'openai', baseUrl: 'https://isolated.invalid/v1', model: 'gpt-5.4-mini', apiKey: credential });
  const isolated = await executeIsolatedWeeklyPlanningTurn(receipt.payload, client);
  expect(isolated.result.failure).toBeUndefined();
  expect(isolated.result.draftCandidates).toHaveLength(1);
  expect(semanticResponses).toEqual([]);
  expect(readWeeklyPlanningStableV5DebugTrace(requestId)).toEqual([]);
  const events = isolated.result.debugTraceEvents!;
  expect(events.map(e => e.stage)).toEqual(expect.arrayContaining(['semantic_provider_request', 'semantic_provider_response', 'semantic_validation_result', 'semantic_repair_prepared', 'runtime_preview_scheduler_evaluated']));
  const validation = events.filter(e => e.stage === 'semantic_validation_result').slice(-1)[0];
  const parsed = (validation.data as { parsedDocument: Record<string, unknown> }).parsedDocument;
  parsed.futureIsolatedTraceField = sentinel;
  if (oversized) parsed.futureLargeIsolatedTraceField = 'x'.repeat(48 * 1024);
  // The Durable Object stores this JSON string; the real browser codec must carry the new evidence.
  const serialized = JSON.stringify(isolated);
  expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(DURABLE_TURN_LIMITS.outputBytes);
  const identity = { ownerId: receipt.ownerId, conversationId: receipt.pending.conversationId,
    requestId: receipt.pending.requestId, baseRevision: receipt.pending.baseRevision, startedAt: Date.parse(receipt.pending.startedAt) };
  const completed: IsolatedWeeklyPlanningTurnResult = await executeDurableWeeklyTurn(receipt, { ports: {
    endpoint: 'https://durable.invalid/turn', token: async () => 'synthetic-owner-token', now: () => identity.startedAt,
    wait: async () => { throw new Error('completed receipt must not poll'); },
    fetch: async () => Response.json({ status: 'completed', identity, result: serialized }),
  } });
  expect(completed.result.debugTraceEvents).toEqual(events);
  recordWeeklyPlanningStableV5DebugTrace({ requestId, stage: 'runtime_branch_selected', data: { branch: 'browser-after-isolated' } });
  const params = { ownerId: receipt.ownerId, pending: receipt.pending, userText, result: completed.result };
  if (kind === 'committed') await recordCommittedWeeklyPlanningApplicationTurn(params);
  else if (kind === 'discarded') await recordDiscardedWeeklyPlanningApplicationTurn({ ...params, reason: 'stale' });
  else await recordFailedWeeklyPlanningApplicationTurn({ ...params, error: new Error('commit failed'),
    assistantMessage: { id: 'failed', role: 'assistant', content: '保存できませんでした。', createdAt: receipt.pending.startedAt } });
  expect(readWeeklyPlanningStableV5DebugTrace(requestId)).toEqual([]);
  expect(repository.writes).toEqual([]);
  const queued = listWeeklyPlanningTraceOutboxItems({ userId: receipt.ownerId, conversationId: ids.logicalConversationId });
  expect(queued).toHaveLength(1);
  expect(queued[0].input.debugTraceEvents?.map(e => e.stage)).toContain('semantic_repair_prepared');
  expect(JSON.stringify(queued)).toContain(sentinel);
  resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest(); repository.fail = false;
  await recordWeeklyPlanningStableV5TurnTrace({ ...queued[0].input, requestId: `${requestId}-retry`, debugTraceEvents: [] });
  expect(repository.writes).toHaveLength(2);
  expect(listWeeklyPlanningTraceOutboxItems({ userId: receipt.ownerId, conversationId: ids.logicalConversationId })).toEqual([]);
  const retried = repository.writes[0];
  const entry = retried.entries[0] as unknown as WeeklyPlanningTraceTurnDiagnosticEntry;
  const { observedAt: _initialObserved, ...initial } = repository.attempts[0].entries[0];
  const { observedAt: _retryObserved, ...retry } = entry;
  expect(retry).toEqual(initial);
  expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
  expect(entry.aiInterpreter.input.requests.map(r => r.attempt)).toEqual(['initial', 'repair']);
  expect(entry.aiInterpreter.input.requests[0].messages.slice(-1)[0]?.content).toBe(requests[0].messages.slice(-1)[0]?.content);
  // The existing collector compacts the deeply nested response schema, but retains its identity.
  expect(entry.aiInterpreter.input.requests[0].responseFormat).toMatchObject({ type: 'json_schema',
    json_schema: { name: 'weekly_planning_semantic_document_v5', strict: true } });
  expect(requests[0].response_format).toMatchObject({ type: 'json_schema',
    json_schema: { name: 'weekly_planning_semantic_document_v5', strict: true } });
  expect(entry.aiInterpreter.rawResponses[0].text).toBe('{}');
  expect(entry.aiInterpreter.structuredResults.map(r => r.accepted)).toEqual([false, true]);
  expect(entry.aiInterpreter.structuredResults[0].errors.length).toBeGreaterThan(0);
  expect(entry.decision.reason).toBe('browser-after-isolated');
  expect(entry.constraintContext.scheduler?.preview).toMatchObject({ candidateCount: 1 });
  const prepared = prepareWeeklyPlanningTraceServerWrite(retried, { token: `wpt_${'a'.repeat(43)}`, epoch: '100' }, ids, '2026-10-14T00:00:00Z');
  expect(prepared.entries).toHaveLength(1);
  const stored = prepared.entries[0];
  expect(measureWeeklyPlanningTraceJsonBytes(stored)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
  expect(stored).not.toHaveProperty('userId');
  expect(JSON.stringify(prepared)).not.toContain(credential);
  if (oversized) {
    expect(entry.diagnostics.truncation).toMatchObject({ applied: true });
    expect(entry.aiInterpreter.rawResponses[1]).toMatchObject({ truncated: true, originalBytes: new TextEncoder().encode(raw).byteLength, checksum: expect.stringMatching(/^fnv1a32:/) });
    expect(JSON.stringify(stored)).not.toContain('x'.repeat(48 * 1024));
    expect((stored.diagnostics as Record<string, unknown>).truncation).toMatchObject({ applied: true });
  } else {
    expect(entry.aiInterpreter.rawResponses[1]).toMatchObject({ text: raw, truncated: false });
    expect(entry.aiInterpreter.structuredResults[1].structuredResult).toMatchObject({ futureIsolatedTraceField: sentinel,
      tasks: [{ title: '数学' }] });
    expect(JSON.stringify(stored)).toContain(sentinel);
  }
}
