// @ts-expect-error The e2e support module is plain ESM without declarations.
import { summarizeDurableTurnBody } from '../../../../tests/e2e/support/vnext-durable-summary.mjs';
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
const userText = '数学を7ページ';
const sentinel = 'future-vnext-durable-trace-safe-field';
const empty = { add: [], patch: [], remove: [], relate: [], defer: [] };
const reading = JSON.stringify({ planningIntent: 'discuss', conversationActs: [], answer: null, delta: { ...empty, add: [
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


// The browser-side durable observation (tests/e2e/support/vnext-durable-observation.mjs) reads only what the page sees:
// the completed body of the durable turn API. Prove it against a real Worker-executed VNext turn, positively and negatively.
it('summarizes a real Worker-executed durable VNext turn and reports what would break the production contract', async () => {
  const payload: WeeklyPlanningVNextDurableTurnInput = { core: 'vnext', weekStartDate: '2026-10-12', checkpoint: null, legacyV5Checkpoint: null,
    input: { userId: 'alice', conversationId: ids.logicalConversationId, traceRequestId: 'chat:request:1', inputStateRevision: 0, messages: [],
      userText, selectedDate: '2026-10-13', plans: [], scheduleTemplates: [],
      requestContext: createWeeklyPlanningTurnRequestContext({ startedAtIso: STARTED, timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' }) } };
  const semantic = ['{}', reading];
  const sent: Array<{ response_format?: { json_schema?: { name?: string } } }> = [];
  vi.stubGlobal('fetch', async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as (typeof sent)[number];
    sent.push(body);
    const content = body.response_format?.json_schema?.name === VNEXT_PROVIDER_RESPONSE_FORMAT.json_schema.name
      ? semantic.shift() : await successfulWeeklyPlanningRendererCompletion(body as never);
    return Response.json({ model: 'gpt-6-luna', choices: [{ message: { content } }] });
  });
  const executed = await executeDurableVNextTurn(env, payload, async (_request, send) => send());
  const identity = { ownerId: 'alice', conversationId: ids.logicalConversationId, requestId: 'chat:request:1', baseRevision: 0, startedAt: 1 };
  const wire = (result: string, status = 'completed') => JSON.stringify({ status, identity, result });
  const summarize = (output: unknown) => summarizeDurableTurnBody(wire(JSON.stringify(output)));

  const good = summarizeDurableTurnBody(wire(serializeWeeklyPlanningTurnResult(executed)));
  expect(good).toMatchObject({ requestId: 'chat:request:1', core: 'vnext', traceAvailable: true, traceTruncated: false });
  // Exactly what the Worker sent: two VNext readings (the first rejected, one repair) and one renderer call.
  expect(good.schemas).toEqual(sent.map(body => body.response_format?.json_schema?.name).filter(name => name === 'weekly_planning_vnext_native_v1'));
  expect(good.schemas.length + good.rendererCalls).toBe(sent.length);

  // Negative: each way the contract could break is visible in the summary.
  const withSchema = structuredClone(executed);
  const request = withSchema.result.debugTraceEvents!.find(event => event.stage === 'semantic_provider_request')!;
  (request.data as { request: { responseFormat: { json_schema: { name: string } } } }).request.responseFormat.json_schema.name = 'weekly_planning_semantic_document_v5';
  expect(summarize(withSchema).schemas).toContain('weekly_planning_semantic_document_v5');
  expect(summarizeDurableTurnBody(wire('{}', 'running'))).toBeNull();
  const noTrace = structuredClone(executed); delete noTrace.result.debugTraceEvents;
  expect(summarize(noTrace)).toMatchObject({ traceAvailable: false, schemas: [] });
  const truncated = structuredClone(executed);
  truncated.result.debugTraceEvents = [{ stage: 'trace_collector_truncated', data: {} } as never];
  expect(summarize(truncated)).toMatchObject({ traceTruncated: true, schemas: [] });
  expect(summarize({ ...executed, core: 'stable_v5' }).core).toBe('stable_v5');
});
