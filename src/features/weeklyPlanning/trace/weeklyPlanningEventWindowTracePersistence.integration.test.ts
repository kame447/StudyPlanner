import '../application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime, type ScriptedConversation } from '../testUtils/weeklyPlanningScriptedConversationHarness';
import { FIXED_EVENT_TURNS, eventDocument, eventRendererReply, eventStudyTask, fixedEventTask, type Json } from '../testUtils/weeklyPlanningFixedEventOnlyFixture';
import { boundWeeklyPlanningDialogueRendererTraceForTransport } from './weeklyPlanningDialogueRendererTrace';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from './weeklyPlanningStableV5TraceRuntime';
import { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';
import { listWeeklyPlanningTraceOutboxItems } from './weeklyPlanningTraceOutbox';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository } from './weeklyPlanningTraceTypes';

const USER = 'ev-trace-owner';
const CONVERSATION = 'weekly-conversation-9c753879-159c-4eea-832f-8d59e90e8991';
const SENTINEL = 'future-window-policy-evidence';
let restoreStorage: () => void;
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
beforeEach(() => {
  restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  resetScriptedConversationRuntime(); resetWeeklyPlanningStableV5TraceRuntimeForTest();
});
afterEach(() => {
  provider?.restore(); resetScriptedConversationRuntime(); resetWeeklyPlanningStableV5TraceRuntimeForTest();
  setWeeklyPlanningTraceRepositoryForTests(undefined); restoreStorage();
});

it.each(['replacement', 'suspension', 'quantity_role'] as const)('persists real %s evidence through outbox retry, Worker preparation, sentinel and truncation limits', async shape => {
  let phase = 0;
  let conversation: ScriptedConversation;
  provider = installScriptedWeeklyPlanningProvider(call => {
    if (call.kind === 'renderer') return eventRendererReply(call);
    if (shape === 'quantity_role') {
      if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'quantity_role_answer', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: 'target' });
      const study = eventStudyTask('problem');
      return JSON.stringify(eventDocument({ planningIntent: 'create_plan', planningWindow: { localId: 'week', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' },
        tasks: [{ ...study, sourceText: '数学の問題集を20問', workloads: [{ ...study.workloads[0], quantityRole: 'unknown', sourceText: '20問' }],
          effortEstimates: [{ localId: 'pace', targetLocalId: 'study-amount', kind: 'duration_per_unit', minutes: 3, unitCode: 'problem', precision: 'approximate', sourceText: '1問3分くらい' }] }], conversationActs: [] }));
    }
    const window = { localId: phase ? 'today' : 'tomorrow', kind: 'relative_day', value: phase ? 'today' : 'tomorrow', start: null, end: null, sourceText: phase ? '今日' : '明日' };
    return JSON.stringify(eventDocument({ planningIntent: phase === 1 ? 'update_plan' : 'create_plan', planningWindow: window,
      tasks: phase === 2 ? [fixedEventTask()] : [],
      uncertainties: phase === 1 ? [] : [{ localId: 'need', targetLocalId: window.localId, field: 'opaque', reason: '期間を確認', sourceText: window.sourceText }],
      ...(phase === 1 ? { corrections: [{ localId: 'correct', target: { kind: 'planning_window', publicId: conversation.graph()!.planningWindows[0].id, localId: null, mention: null }, operation: 'replace', replacementLocalId: 'today', sourceText: FIXED_EVENT_TURNS[1] }] } : {}),
      conversationActs: phase === 2 ? [{ kind: 'request_event_registration', targetPublicId: null }] : [],
    }));
  });
  conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', ownerId: USER, conversationId: CONVERSATION, now: () => '2026-10-07T00:00:00.000Z' });
  const texts = shape === 'quantity_role' ? ['来週、数学の問題集を20問、1問3分くらい', 'これからやる20問です'] : FIXED_EVENT_TURNS;
  await conversation.submit(texts[0]);
  const oldNeedId = conversation.graph()!.uncertainties[0]?.id;
  const oldEffortId = conversation.graph()!.effortEstimates[0]?.id;
  phase = 1;
  let turn = await conversation.submit(texts[1]);
  if (shape === 'suspension') { phase = 2; turn = await conversation.submit(texts[2]); }
  expect(turn.result?.failure).toBeUndefined();
  const canonical = turn.debugTrace.find(event => event.stage === 'semantic_canonicalization_evaluated')!.data as Json;
  const diff = canonical.adoptedOperations as Json;
  if (shape === 'replacement') expect(diff.removed).toContainEqual({ kind: 'uncertainty', id: oldNeedId });
  else if (shape === 'suspension') {
    expect(turn.result?.communicationFacts?.statusReason).toBe('fixed_event_manual_entry');
    expect(turn.result?.state.lastQuestionContext).toBeUndefined();
    const needs = conversation.graph()!.uncertainties;
    const newNeed = needs[needs.length - 1];
    expect(conversation.graph()!.factLifecycles.find(entry => entry.factId === newNeed.id)?.status).toBe('active');
    expect(diff.added).toContainEqual({ kind: 'uncertainty', id: newNeed.id });
    expect(diff.removed).not.toContainEqual({ kind: 'uncertainty', id: newNeed.id });
  } else {
    expect(diff.superseded).toContainEqual({ kind: 'effort_estimate', id: oldEffortId });
    const active = new Set(conversation.graph()!.factLifecycles.filter(entry => entry.status === 'active').map(entry => entry.factId));
    const pace = conversation.graph()!.effortEstimates.find(fact => active.has(fact.id))!;
    expect(pace).toMatchObject({ kind: 'duration_per_unit', minutes: 3 });
    expect(active.has(pace.targetFactId)).toBe(true);
    expect(diff.added).toContainEqual({ kind: 'effort_estimate', id: pace.id });
  }
  diff.futureField = SENTINEL;
  canonical.graph = { privateWindowGraph: 'must-not-be-persisted' };
  const trace = boundWeeklyPlanningDialogueRendererTraceForTransport(turn.result!.dialogueRendererTrace!);
  const renderer = turn.calls.find(call => call.kind === 'renderer')!;
  expect((trace.request!.promptContext as Json).messages).toEqual(renderer.messages);
  const input = { userId: USER, conversationId: CONVERSATION, requestId: turn.requestId!, userText: texts[phase],
    assistantMessage: turn.result!.message, responseSource: turn.result!.responseSource,
    dialogueRendererTrace: trace, outcome: turn.result!.state.status, previewCount: turn.result!.draftCandidates.length, debugTraceEvents: turn.debugTrace };
  const oversized = structuredClone(input);
  oversized.requestId = `${input.requestId}-oversized`;
  const largeCanonical = oversized.debugTraceEvents.find(event => event.stage === 'semantic_canonicalization_evaluated')!.data as Json;
  (largeCanonical.adoptedOperations as Json).futureLargeField = 'x'.repeat(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes * 2);
  const entries: WeeklyPlanningTraceEntry[] = [];
  const workerEntries: Json[] = [];
  let failOnce = true;
  const repository: WeeklyPlanningTraceRepository = {
    async upsertSession() {},
    async appendEntries(write) {
      if (failOnce) { failOnce = false; throw new Error('injected EV append failure'); }
      const prepared = prepareWeeklyPlanningTraceServerWrite({ session: write.session as unknown as Json, entries: write.entries as unknown as Json[] },
        { token: `wpt_${'a'.repeat(43)}`, epoch: '107' },
        { sessionId: 'weekly-trace-9c753879-159c-4eea-832f-8d59e90e8991', logicalConversationId: CONVERSATION }, '2026-10-08T00:00:00.000Z');
      workerEntries.push(...prepared.entries);
      entries.push(...write.entries);
    },
    async listSessions() { return []; }, async listSessionsForAdmin() { return []; }, async archiveSessionForAdmin() {}, async getSession() { return null; }, async listEntries() { return []; },
  };
  setWeeklyPlanningTraceRepositoryForTests(repository);
  await recordWeeklyPlanningStableV5TurnTrace(input);
  expect(entries).toEqual([]);
  expect(listWeeklyPlanningTraceOutboxItems({ userId: USER, conversationId: CONVERSATION })).toHaveLength(1);
  resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
  await recordWeeklyPlanningStableV5TurnTrace(oversized);
  expect(entries).toHaveLength(2);
  expect(listWeeklyPlanningTraceOutboxItems({ userId: USER, conversationId: CONVERSATION })).toEqual([]);
  // Verify outside the repository callback: assertion failures must not be
  // swallowed by the production retry boundary as simulated transport errors.
  for (const entry of entries) {
        expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
        const worker = workerEntries.find(candidate => candidate.requestId === entry.requestId)!;
        expect(measureWeeklyPlanningTraceJsonBytes(worker)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
        for (const persisted of [entry, worker]) {
          const serialized = JSON.stringify(persisted);
          expect(serialized).not.toContain('must-not-be-persisted');
          if (entry.requestId === input.requestId) {
            expect(serialized).toContain(SENTINEL);
            expect(persisted).toMatchObject({ decision: { stateDiff: {
              fromRevision: diff.fromRevision, toRevision: diff.toRevision, removed: diff.removed,
            } } });
            if (shape === 'suspension') expect(serialized).toContain('fixed_event_manual_entry');
          } else {
            expect(serialized).toMatch(/truncated|Truncated|truncation/u);
            expect(serialized).not.toContain('x'.repeat(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes * 2));
          }
        }
      }
});
