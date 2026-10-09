import { afterEach, expect, it } from 'vitest';
import '../application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { measureWeeklyPlanningTraceJsonBytes, WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { createScriptedConversation, resetScriptedConversationRuntime } from '../testUtils/weeklyPlanningScriptedConversationHarness';
import { BULK, DECLINE, OVERLOAD, examBusyPlans, installExamOverloadProvider } from '../testUtils/weeklyPlanningExamOverloadFixture';
import { beginWeeklyPlanningStableV5DebugTrace, recordWeeklyPlanningStableV5DebugTrace, takeWeeklyPlanningStableV5DebugTrace } from './weeklyPlanningStableV5DebugTrace';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from './weeklyPlanningStableV5TraceRuntime';
import { listWeeklyPlanningTraceOutboxItems } from './weeklyPlanningTraceOutbox';
import { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository, WeeklyPlanningTraceSession } from './weeklyPlanningTraceTypes';

/*
 * Issue #488 B3: the capacity-shortfall facts handed to the renderer are persisted as numbers and counts only
 * (task titles are user text and never persisted here), through outbox retry, Worker preparation, caps and future fields.
 */
const OWNER = 'b3-trace-owner';
const CONVERSATION = 'weekly-conversation-723e4567-e89b-42d3-a456-426614174000';
const SENTINEL = 'future-shortfall-field';
let provider: ReturnType<typeof installExamOverloadProvider>;
let restoreStorage: () => void;
afterEach(() => {
  provider?.restore(); restoreStorage?.(); resetScriptedConversationRuntime();
  resetWeeklyPlanningStableV5TraceRuntimeForTest(); setWeeklyPlanningTraceRepositoryForTests(undefined);
});


type Json = Record<string, unknown>;
it('persists the capacity shortfall as numbers only through outbox retry, Worker preparation, caps and future fields', async () => {
  restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  resetScriptedConversationRuntime(); resetWeeklyPlanningStableV5TraceRuntimeForTest();
  provider = installExamOverloadProvider(30);
  const conv = createScriptedConversation({ provider, plans: examBusyPlans, ownerId: OWNER, conversationId: CONVERSATION, architecture: 'interaction_v1', weekStartDate: '2026-10-12', now: () => '2026-10-09T09:00:00.000Z' });
  await conv.submit(BULK);
  await conv.submit(DECLINE);
  const turn = await conv.submit(OVERLOAD);
  const event = turn.debugTrace.find((entry) => JSON.stringify(entry.data).includes('unmetMinutes'));
  expect(event).toBeTruthy();
  const facts = (((event!.data as Json).projectedResult as Json).communicationFacts as Json).capacityShortfall as Json;
  expect(facts).toMatchObject({ requiredMinutes: expect.any(Number), unmetMinutes: expect.any(Number), unmetWorkCount: expect.any(Number), moreCount: expect.any(Number) });
  expect(Object.keys(facts).sort()).toEqual(['moreCount', 'requiredMinutes', 'unmetMinutes', 'unmetWorkCount']);
  // Task titles are user text: the persisted fact has no label.
  expect(JSON.stringify(facts)).not.toContain('物理');

  const traceInput = {
    userId: OWNER, conversationId: CONVERSATION, requestId: turn.requestId!, userText: OVERLOAD,
    assistantMessage: turn.result!.message, responseSource: turn.result!.responseSource, outcome: 'question' as const,
    debugTraceEvents: turn.debugTrace, previewCount: 0,
  };
  const extend = (large: boolean) => {
    const requestId = `${CONVERSATION}:request:${large ? 'large' : 'future'}`;
    beginWeeklyPlanningStableV5DebugTrace(requestId);
    // The recorded shortfall gains a future field, a title and (large) a huge value: none may be persisted.
    for (const entry of turn.debugTrace) {
      const data = structuredClone(entry.data) as Json;
      const facts = ((data.projectedResult as Json | undefined)?.communicationFacts as Json | undefined);
      if (entry.stage === 'turn_executor_result_projected' && facts?.capacityShortfall) {
        Object.assign(facts.capacityShortfall as Json, { futureShortfall: SENTINEL, unmetWork: [{ label: SENTINEL }],
          ...(large ? { futureLargeValue: 'あ'.repeat(30_000) } : {}) });
      }
      recordWeeklyPlanningStableV5DebugTrace({ requestId, stage: entry.stage, data });
    }
    return { ...traceInput, requestId, debugTraceEvents: takeWeeklyPlanningStableV5DebugTrace(requestId) };
  };
  const future = extend(false);
  const large = extend(true);
  const writes: Array<{ session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }> = [];
  let fail = true;
  const repository: WeeklyPlanningTraceRepository = {
    async upsertSession() {}, async appendEntries(params) {
      if (fail) { fail = false; throw new Error('first shortfall trace append failed'); }
      writes.push(structuredClone(params));
    }, async listSessions() { return []; }, async listSessionsForAdmin() { return []; },
    async archiveSessionForAdmin() {}, async getSession() { return null; }, async listEntries() { return []; },
  };
  setWeeklyPlanningTraceRepositoryForTests(repository);
  await recordWeeklyPlanningStableV5TurnTrace(traceInput);
  expect(writes).toHaveLength(0);
  expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toHaveLength(1);
  resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
  await recordWeeklyPlanningStableV5TurnTrace(future);
  await recordWeeklyPlanningStableV5TurnTrace(large);
  expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toEqual([]);
  const entries = writes.flatMap((write) => write.entries);
  expect(entries).toHaveLength(3);
  const prepared = writes.flatMap((write) => prepareWeeklyPlanningTraceServerWrite({
    session: write.session as unknown as Record<string, unknown>, entries: write.entries as unknown as Record<string, unknown>[],
  }, { token: `wpt_${'f'.repeat(43)}`, epoch: '105' }, { sessionId: 'weekly-trace-723e4567-e89b-42d3-a456-426614174000', logicalConversationId: CONVERSATION }, '2026-10-07T00:00:00.000Z').entries);
  for (const entry of entries) expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
  for (const entry of prepared) expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
  for (const set of [entries, prepared]) {
    const text = (id: string) => JSON.stringify(set.find((entry) => (entry as unknown as { requestId: string }).requestId === id));
    for (const marker of ['capacityShortfall', 'unmetMinutes', 'requiredMinutes']) expect(text(turn.requestId!)).toContain(marker);
    for (const id of [future.requestId, large.requestId]) {
      expect(text(id)).toContain('unmetMinutes');
      expect(text(id)).not.toContain(SENTINEL);
      expect(text(id)).not.toContain('あ'.repeat(30_000));
    }
  }
});
