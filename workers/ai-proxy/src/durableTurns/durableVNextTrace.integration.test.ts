import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { executeDurableVNextTurn } from './durableVNextTurn';
import { serializeWeeklyPlanningTurnResult } from './weeklyPlanningTurnResult';
import { prepareWeeklyPlanningTraceServerWrite } from '../weeklyPlanningTracePrivacy';
import { createWeeklyPlanningTurnRequestContext } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningTemporalContext';
import { executeDurableWeeklyTurn } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningDurableTurnClient';
import { recordCommittedWeeklyPlanningApplicationTurn } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningTurnTraceSideEffects';
import { createMemoryStorageHarness } from '../../../../src/features/weeklyPlanning/testUtils/weeklyPlanningApplicationTestHarness';
import { successfulWeeklyPlanningRendererCompletion } from '../../../../src/features/weeklyPlanning/testUtils/__tests__/weeklyPlanningRendererCompletionFixture';
import { readWeeklyPlanningStableV5DebugTrace, resetWeeklyPlanningStableV5DebugTraceForTest } from '../../../../src/features/weeklyPlanning/trace/weeklyPlanningStableV5DebugTrace';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from '../../../../src/features/weeklyPlanning/trace/weeklyPlanningStableV5TraceRuntime';
import { listWeeklyPlanningTraceOutboxItems } from '../../../../src/features/weeklyPlanning/trace/weeklyPlanningTraceOutbox';
import type { WeeklyPlanningTraceTurnDiagnosticEntry } from '../../../../src/features/weeklyPlanning/trace/weeklyPlanningTraceTypes';
import { VNEXT_PROVIDER_RESPONSE_FORMAT } from '../../../../src/features/weeklyPlanning/vnext/semantic/weeklyPlanningVNextProviderSchema';
import { parseWeeklyPlanningVNextSessionCheckpoint } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextSessionCheckpoint';
import type { WeeklyPlanningVNextDurableTurnInput, WeeklyPlanningVNextDurableTurnResult } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextDurableTurn';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../../shared/weeklyPlanningTraceContract';
import type { AiProxyWorkerEnv } from '../worker';

const repository = vi.hoisted(() => ({ fail: true,
  attempts: [] as Array<{ session: Record<string, unknown>; entries: Record<string, unknown>[] }>,
  writes: [] as Array<{ session: Record<string, unknown>; entries: Record<string, unknown>[] }>,
}));
vi.mock('../../../../src/features/weeklyPlanning/trace/weeklyPlanningTraceRepository', () => ({ isWeeklyPlanningTraceEnabled: () => true,
  getWeeklyPlanningTraceRepository: () => ({ async appendEntries(params: { session: Record<string, unknown>; entries: Record<string, unknown>[] }) {
    repository.attempts.push(structuredClone(params));
    if (repository.fail) throw new Error('intentional first append failure');
    repository.writes.push(structuredClone(params));
  } }),
}));
const ids = { sessionId: 'weekly-trace-123e4567-e89b-52d3-a456-426614174000', logicalConversationId: 'weekly-conversation-123e4567-e89b-52d3-a456-426614174000' };
const STARTED = '2026-10-13T20:00:00.000Z';
const userText = '昨日は数学を30分勉強し、月曜は休みました。英語は時間を覚えていません。来週は数学を7ページ進めたい。';
const sentinel = 'future-vnext-durable-trace-safe-field';
const studyRecord = { dateExpression: '2026-10-13', subject: '数学', minutes: 30 };
const restDay = '2026-10-12';
const studyRecordQuestion = { reason: 'missing_minutes', label: '英語' };
const derivedActualId = 'wp-actual-alice-2026-10-13-数学';
const empty = { add: [], patch: [], remove: [], relate: [], defer: [] };
const reading = JSON.stringify({ planningIntent: 'discuss', conversationActs: [], answer: null,
  studyRecords: [studyRecord], studyRestDays: [restDay], studyRecordQuestion, delta: { ...empty, add: [
  { kind: 'task', localId: 'task', category: 'study', title: '数学' },
  { kind: 'workload', localId: 'work', taskRef: { localId: 'task' }, componentRef: null, quantityRole: 'remaining', amount: 7,
    unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null }] } });
const env = { OPENAI_API_KEY: 'server-key', ALLOWED_CHAT_MODELS: 'gpt-6-luna',
  AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 0 }) }) } } as unknown as AiProxyWorkerEnv;

beforeEach(() => {
  repository.fail = true; repository.attempts.length = 0; repository.writes.length = 0;
  vi.stubGlobal('window', { localStorage: createMemoryStorageHarness().storage });
  resetWeeklyPlanningStableV5TraceRuntimeForTest(); resetWeeklyPlanningStableV5DebugTraceForTest();
});
afterEach(() => { resetWeeklyPlanningStableV5TraceRuntimeForTest(); resetWeeklyPlanningStableV5DebugTraceForTest(); vi.unstubAllGlobals(); });

it.each([false, true])('carries a Worker-executed VNext turn\'s provider and renderer evidence through the existing trace persistence boundary (oversized=%s)', async oversized => {
  const payload: WeeklyPlanningVNextDurableTurnInput = { core: 'vnext', weekStartDate: '2026-10-12', checkpoint: null, legacyV5Checkpoint: null,
    input: { userId: 'alice', conversationId: ids.logicalConversationId, traceRequestId: 'chat:request:1', inputStateRevision: 0, messages: [],
      userText, selectedDate: '2026-10-13', plans: [], scheduleTemplates: [],
      requestContext: createWeeklyPlanningTurnRequestContext({ startedAtIso: STARTED, timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' }) } };
  const semantic = ['{}', reading];
  const sent: Array<{ messages: { content: string }[]; response_format?: { json_schema?: { name?: string } } }> = [];
  vi.stubGlobal('fetch', async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as (typeof sent)[number];
    sent.push(body);
    const content = body.response_format?.json_schema?.name === VNEXT_PROVIDER_RESPONSE_FORMAT.json_schema.name
      ? semantic.shift() : await successfulWeeklyPlanningRendererCompletion(body);
    return Response.json({ model: 'gpt-6-luna', choices: [{ message: { content } }] });
  });
  const executed = await executeDurableVNextTurn(env, payload, async (_request, send) => send());
  expect(semantic).toEqual([]);
  const checkpoint = parseWeeklyPlanningVNextSessionCheckpoint({ raw: executed.checkpointAfter!, ownerId: 'alice', weekStartDate: '2026-10-12' });
  expect(checkpoint?.vnext.actualRecords).toEqual([expect.objectContaining({
    id: derivedActualId, occurrenceDate: studyRecord.dateExpression, subject: studyRecord.subject, minutes: studyRecord.minutes, status: 'pending',
  })]);
  expect(checkpoint?.vnext.pendingStudyRecordQuestion).toEqual(studyRecordQuestion);
  expect(readWeeklyPlanningStableV5DebugTrace('chat:request:1')).toEqual([]);
  const events = executed.result.debugTraceEvents!;
  expect(events.map(event => event.stage)).toEqual(expect.arrayContaining(['semantic_provider_request', 'semantic_provider_response', 'semantic_validation_result']));
  // A future field must reach storage without any schema being updated for it.
  const validation = events.filter(event => event.stage === 'semantic_validation_result').slice(-1)[0];
  const parsed = (validation.data as { parsedDocument: Record<string, unknown> }).parsedDocument;
  parsed.futureVNextTraceField = sentinel;
  if (oversized) parsed.futureLargeVNextTraceField = 'x'.repeat(48 * 1024);

  // The Durable Object stores this string and the browser's real codec reads it back.
  const serialized = serializeWeeklyPlanningTurnResult(executed);
  const pending = { conversationId: ids.logicalConversationId, turnId: `${ids.logicalConversationId}:turn:1`, requestId: 'chat:request:1',
    weekStartDate: '2026-10-12', baseRevision: 0, startedAt: STARTED };
  const identity = { ownerId: 'alice', conversationId: pending.conversationId, requestId: pending.requestId, baseRevision: 0, startedAt: Date.parse(STARTED) };
  const completed = await executeDurableWeeklyTurn<WeeklyPlanningVNextDurableTurnResult>(
    { version: 1, ownerId: 'alice', snapshot: undefined as never, pending, payload }, { ports: {
      endpoint: 'https://durable.invalid/turn', token: async () => 'owner-token', now: () => identity.startedAt,
      wait: async () => { throw new Error('completed receipt must not poll'); },
      fetch: async () => Response.json({ status: 'completed', identity, result: serialized }),
    } });
  expect(completed.core).toBe('vnext');
  expect(completed.result.debugTraceEvents).toEqual(events);

  await recordCommittedWeeklyPlanningApplicationTurn({ ownerId: 'alice', pending, userText, result: completed.result });
  expect(repository.writes).toEqual([]);
  const queued = listWeeklyPlanningTraceOutboxItems({ userId: 'alice', conversationId: ids.logicalConversationId });
  expect(queued).toHaveLength(1);
  expect(JSON.stringify(queued)).toContain(sentinel);
  resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest(); repository.fail = false;
  await recordWeeklyPlanningStableV5TurnTrace({ ...queued[0].input, requestId: 'chat:request:1-retry', debugTraceEvents: [] });
  expect(repository.writes).toHaveLength(2);
  expect(listWeeklyPlanningTraceOutboxItems({ userId: 'alice', conversationId: ids.logicalConversationId })).toEqual([]);
  const retried = repository.writes[0];
  const entry = retried.entries[0] as unknown as WeeklyPlanningTraceTurnDiagnosticEntry;
  expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
  // The exact bytes the Worker sent to the provider are what the trace holds.
  expect(entry.aiInterpreter.input.requests[0].messages.slice(-1)[0]?.content).toBe(sent[0].messages.slice(-1)[0]?.content);
  expect(entry.aiInterpreter.rawResponses[0].text).toBe('{}');
  expect(entry.aiInterpreter.structuredResults.map(result => result.accepted)).toContain(true);
  if (!oversized) {
    expect(entry.aiInterpreter.rawResponses[1].text).toContain(JSON.stringify([restDay]));
    const structured = JSON.stringify(entry.aiInterpreter.structuredResults);
    expect(structured).toContain(JSON.stringify(studyRecord));
    expect(structured).toContain(JSON.stringify([restDay]));
    expect(structured).toContain(JSON.stringify(studyRecordQuestion));
    // The trace captures the provider reading, without copying this turn's derived checkpoint ID/status.
    expect(JSON.stringify(entry)).not.toContain(derivedActualId);
    expect(JSON.stringify(entry.decision.stateDiff)).not.toContain('pendingStudyRecordQuestion');
  }
  const prepared = prepareWeeklyPlanningTraceServerWrite(retried, { token: `wpt_${'a'.repeat(43)}`, epoch: '100' }, ids, '2026-10-14T00:00:00Z');
  expect(prepared.entries).toHaveLength(1);
  expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
  expect(JSON.stringify(prepared)).not.toContain('server-key');
  if (oversized) {
    // A large value never drops the turn: it is truncated with explicit evidence, before and after Worker preparation.
    expect(entry.diagnostics.truncation).toMatchObject({ applied: true });
    expect(JSON.stringify(prepared)).not.toContain('x'.repeat(48 * 1024));
    expect((prepared.entries[0].diagnostics as Record<string, unknown>).truncation).toMatchObject({ applied: true });
  } else {
    expect(JSON.stringify(prepared)).toContain(sentinel);
    expect(JSON.stringify(prepared)).toContain(JSON.stringify(studyRecord));
    expect(JSON.stringify(prepared)).toContain(JSON.stringify([restDay]));
    expect(JSON.stringify(prepared)).toContain(JSON.stringify(studyRecordQuestion));
    expect(JSON.stringify(prepared)).not.toContain(derivedActualId);
    expect(JSON.stringify(prepared.entries[0].decision.stateDiff)).not.toContain('pendingStudyRecordQuestion');
  }
});
