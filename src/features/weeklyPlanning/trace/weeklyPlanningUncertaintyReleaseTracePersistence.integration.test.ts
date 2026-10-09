import { afterEach, expect, it } from 'vitest';
import '../application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { measureWeeklyPlanningTraceJsonBytes, WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime, scriptedRendererReply } from '../testUtils/weeklyPlanningScriptedConversationHarness';
import { beginWeeklyPlanningStableV5DebugTrace, recordWeeklyPlanningStableV5DebugTrace, takeWeeklyPlanningStableV5DebugTrace } from './weeklyPlanningStableV5DebugTrace';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from './weeklyPlanningStableV5TraceRuntime';
import { listWeeklyPlanningTraceOutboxItems } from './weeklyPlanningTraceOutbox';
import { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository, WeeklyPlanningTraceSession } from './weeklyPlanningTraceTypes';

/*
 * Issue #488 B3: a released free-form question is persisted as ids and a count only
 * (the quote is user text and never persisted here), through outbox retry, Worker preparation, caps and future fields.
 */
const OWNER = 'hrel-trace-owner';
const CONVERSATION = 'weekly-conversation-723e4567-e89b-42d3-a456-426614174000';
const SENTINEL = 'future-release-field';
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
let restoreStorage: () => void;
afterEach(() => {
  provider?.restore(); restoreStorage?.(); resetScriptedConversationRuntime();
  resetWeeklyPlanningStableV5TraceRuntimeForTest(); setWeeklyPlanningTraceRepositoryForTests(undefined);
});


type Json = Record<string, unknown>;
const T1 = '来週、レポートの文献を30ページ読む。1ページ3分くらい';
const T2 = 'あ、やっぱり25ページで、1ページ3分のまま。あとこれって1日でまとめて読んでも平気？';
const T3 = 'うん、それで';
const Q = 'あとこれって1日でまとめて読んでも平気？';
const doc = (o: Json = {}): Json => ({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null, tasks: [], relations: [],
  availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [], conversationActs: [], ...o });
const paper = (id: string | null, extra: Json = {}): Json => ({ localId: 'paper', existingPublicId: id, decompositionStatus: 'atomic', category: 'study', title: 'レポートの文献',
  study: { purpose: 'self_study', activityKind: 'reading', contextLabel: null, components: [] }, workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [],
  durableContextSignals: [], sourceText: '文献を30ページ読む', ...extra });
const amount = (n: number, text: string): Json => ({ localId: `a${n}`, quantityRole: 'target', amount: n, unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: text });
const rate = (a: string): Json => ({ localId: `r-${a}`, targetLocalId: a, kind: 'duration_per_unit', minutes: 3, unitCode: 'page', precision: 'approximate', sourceText: '1ページ3分' });
function script(text: string, taskId: string | undefined): Json {
  if (text === T1) return doc({ planningIntent: 'create_plan', planningWindow: { localId: 'w', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' },
    tasks: [paper(null, { workloads: [amount(30, '30ページ')], effortEstimates: [rate('a30')] })] });
  if (text === T2) return doc({ tasks: [paper(taskId!, { sourceText: 'やっぱり25ページで', workloads: [amount(25, '25ページ')], effortEstimates: [{ ...rate('a25'), localId: 'r2' }] })],
    uncertainties: [{ localId: 'u', targetLocalId: 'paper', field: 'one_day_completion_feasibility', reason: 'r', sourceText: Q }],
    conversationActs: [{ kind: 'consultation_request', targetPublicId: taskId }] });
  return doc({ conversationActs: [{ kind: 'answer_pending_question', targetPublicId: taskId }] });
}
it('persists the released point as ids and a count only, through outbox retry, Worker preparation, caps and future fields', async () => {
  restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  resetScriptedConversationRuntime(); resetWeeklyPlanningStableV5TraceRuntimeForTest();
  provider = installScriptedWeeklyPlanningProvider(call => {
    if (call.kind === 'renderer') return scriptedRendererReply(call, 'わかりました。');
    const summary = (call.payload?.publicStateSummary ?? {}) as Json;
    const taskId = (((summary.tasks ?? []) as Json[])[0]?.publicId as string | undefined);
    return JSON.stringify(script(String(call.payload?.userText ?? ''), taskId));
  });
  const conv = createScriptedConversation({ provider, ownerId: OWNER, conversationId: CONVERSATION, architecture: 'interaction_v1', weekStartDate: '2026-10-12', now: () => '2026-10-08T00:00:00.000Z' });
  await conv.submit(T1);
  await conv.submit(T2);
  const turn = await conv.submit(T3);
  expect(turn.result?.communicationFacts?.uncertaintyReleased?.count).toBe(1);
  const event = turn.debugTrace.find((entry) => entry.stage === 'turn_executor_result_projected')!;
  const released = ((event.data as Json).projectedResult as Json | undefined)?.communicationFacts as Json | undefined;
  expect(Object.keys((released?.uncertaintyReleased ?? {}) as Json).sort()).toEqual(['count', 'ids']);
  expect(JSON.stringify(released)).not.toContain('平気');

  const traceInput = {
    userId: OWNER, conversationId: CONVERSATION, requestId: turn.requestId!, userText: T3,
    assistantMessage: turn.result!.message, responseSource: turn.result!.responseSource, outcome: 'preview' as const,
    debugTraceEvents: turn.debugTrace, previewCount: turn.result!.draftCandidates.length,
  };
  const extend = (large: boolean) => {
    const requestId = `${CONVERSATION}:request:${large ? 'large' : 'future'}`;
    beginWeeklyPlanningStableV5DebugTrace(requestId);
    for (const entry of turn.debugTrace) {
      const data = structuredClone(entry.data) as Json;
      const facts = ((data.projectedResult as Json | undefined)?.communicationFacts as Json | undefined);
      if (entry.stage === 'turn_executor_result_projected' && facts?.uncertaintyReleased) {
        Object.assign(facts.uncertaintyReleased as Json, { quote: SENTINEL, futureRelease: SENTINEL, ...(large ? { futureLargeValue: 'あ'.repeat(30_000) } : {}) });
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
      if (fail) { fail = false; throw new Error('first release trace append failed'); }
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
    expect(text(turn.requestId!)).toContain('releasedUncertainties');
    for (const id of [future.requestId, large.requestId]) {
      expect(text(id)).toContain('releasedUncertainties');
      expect(text(id)).not.toContain(SENTINEL);
      expect(text(id)).not.toContain('あ'.repeat(30_000));
    }
  }
});

it('the AI-rendered release reply is followed by the application sentence (not renderer wording)', async () => {
  restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  resetScriptedConversationRuntime(); resetWeeklyPlanningStableV5TraceRuntimeForTest();
  provider = installScriptedWeeklyPlanningProvider(call => {
    if (call.kind === 'renderer') {
      const decision = call.payload?.applicationDecision as Json;
      return scriptedRendererReply(call, decision.actionKind === 'preview_ready'
        ? '候補を作りました。内容を見て、よければ下の「この内容で仮予定にする」を押してください。' : 'わかりました。');
    }
    const summary = (call.payload?.publicStateSummary ?? {}) as Json;
    const taskId = (((summary.tasks ?? []) as Json[])[0]?.publicId as string | undefined);
    return JSON.stringify(script(String(call.payload?.userText ?? ''), taskId));
  });
  const conv = createScriptedConversation({ provider, ownerId: OWNER, conversationId: CONVERSATION, architecture: 'interaction_v1', weekStartDate: '2026-10-12', now: () => '2026-10-08T00:00:00.000Z' });
  await conv.submit(T1);
  await conv.submit(T2);
  const turn = await conv.submit(T3);
  expect(turn.result?.responseSource).toBe('ai');
  expect(turn.result?.message).toMatch(/\n\n「あとこれって1日でまとめて読んでも平気？」について未確定の点を残したまま、仮予定を作りました。$/);
});
