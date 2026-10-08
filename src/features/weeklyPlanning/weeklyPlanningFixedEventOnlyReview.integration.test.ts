// Preload the lazy runtime during collection; this test measures conversation behavior, not module transform time.
import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, describe, expect, it } from 'vitest';
import { resetScriptedConversationRuntime, type ScriptedConversationTurn } from './testUtils/weeklyPlanningScriptedConversationHarness';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { BUSY_ONLY_TEXT, FIXED_EVENT_TURNS, MIXED_EVENT_TEXT, eventStudyTask, fixedEventTask, installFixedEventConversation, type Json } from './testUtils/weeklyPlanningFixedEventOnlyFixture';

let fixture: ReturnType<typeof installFixedEventConversation>;
afterEach(() => { fixture?.provider.restore(); resetScriptedConversationRuntime(); });
function rendererDecision(turn: ScriptedConversationTurn) {
  return turn.calls.find(call => call.kind === 'renderer')?.payload?.applicationDecision as Json;
}
function assertNoWrite(turn: ScriptedConversationTurn) {
  expect(turn.result?.failure, JSON.stringify(turn.debugTrace)).toBeUndefined();
  expect(turn.result?.state.shouldSavePlan).not.toBe(true);
  expect(turn.result?.message).not.toMatch(/(?:登録|保存|追加)しました/u);
  if (turn.result?.interactionOutcome) expect(turn.calls.filter(call => call.kind === 'semantic_generic').length).toBeLessThanOrEqual(2);
}

describe('fixed-event-only controller regression (issue6048944396)', () => {
  it.each(['legacy_v5', 'interaction_v1'] as const)('five-turn fixed-only purpose and authority in %s', async architecture => {
    fixture = installFixedEventConversation({ architecture });
    const turns: ScriptedConversationTurn[] = [];
    let acceptedGraph: unknown;
    for (const text of FIXED_EVENT_TURNS) {
      const turn = await fixture.conversation.submit(text);
      assertNoWrite(turn); turns.push(turn);
      if (turns.length === 3) acceptedGraph = createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!);
      if (turns.length > 3) expect(createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!)).toEqual(acceptedGraph);
    }
    expect(fixture.conversation.getState().draftBlocks).toEqual([]);
    expect(fixture.conversation.getState().previewCandidates ?? []).toEqual([]);
    expect(createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!).planningWindows.map(window => window.value)).toEqual(['today']);
    const questions = turns.slice(2).map(turn => turn.result?.state.lastQuestionContext?.targetSlot ?? null);
    if (architecture === 'legacy_v5') {
      // Historical control, not a claim that legacy's loop is fixed.
      expect(questions).toEqual(Array(3).fill('stable_v5:missing_schedulable_work'));
      expect(turns.map(turn => rendererDecision(turn).communication)).toEqual(Array(5).fill(undefined));
    } else {
      expect(questions).toEqual([null, null, null]);
      expect(turns.map(turn => (rendererDecision(turn).communication as Json).scheduleIntent))
        .toEqual(['clarify_schedule_request', 'clarify_schedule_request', 'register_event', 'register_event', 'register_event']);
      expect((rendererDecision(turns[0]).communication as Json).questionPurposes).toEqual(['clarify_schedule_request']);
      expect(rendererDecision(turns[0]).questionIntent).toMatchObject({ kind: 'schedule_request', purpose: 'clarify_schedule_request' });
      expect(turns.slice(2).map(turn => turn.result?.communicationFacts?.statusReason))
        .toEqual(['fixed_event_manual_entry', 'no_additional_work', 'no_additional_work']);
      expect(turns.filter(turn => turn.result?.message.includes('予定を追加'))).toHaveLength(1);
      expect(turns.slice(2).every(turn => !/[?？]/u.test(turn.result!.message))).toBe(true);
    }
  });

  it.each(['legacy_v5', 'interaction_v1'] as const)('busy-time-only optional invitation terminates on typed decline in %s', async architecture => {
    fixture = installFixedEventConversation({ architecture, busyOnly: true });
    const turns = [];
    for (const text of [FIXED_EVENT_TURNS[0], FIXED_EVENT_TURNS[1], BUSY_ONLY_TEXT, ...FIXED_EVENT_TURNS.slice(3)]) {
      const turn = await fixture.conversation.submit(text); assertNoWrite(turn); turns.push(turn);
    }
    if (architecture === 'interaction_v1') {
      expect((rendererDecision(turns[2]).communication as Json).questionPurposes).toEqual(['clarify_schedule_request']);
      expect(turns.slice(3).map(turn => turn.result?.state.lastQuestionContext)).toEqual([undefined, undefined]);
      expect(turns.slice(3).map(turn => turn.result?.communicationFacts?.statusReason)).toEqual(['no_additional_work', 'no_additional_work']);
    } else expect(turns.slice(3).map(turn => turn.result?.state.lastQuestionContext?.targetSlot)).toEqual(Array(2).fill('stable_v5:missing_schedulable_work'));
    expect(turns.every(turn => !turn.result?.message.includes('予定を追加'))).toBe(true);
  });

  it.each(['legacy_v5', 'interaction_v1'] as const)('unavailable representation keeps explicit event registration intent in %s', async architecture => {
    fixture = installFixedEventConversation({ architecture, busyOnly: true, registrationAct: true });
    const turns = [];
    for (const text of FIXED_EVENT_TURNS) {
      const turn = await fixture.conversation.submit(text); assertNoWrite(turn); turns.push(turn);
    }
    if (architecture === 'interaction_v1') {
      expect(turns.slice(2).map(turn => turn.result?.state.lastQuestionContext)).toEqual([undefined, undefined, undefined]);
      expect(turns.slice(2).map(turn => turn.result?.communicationFacts?.statusReason))
        .toEqual(['fixed_event_manual_entry', 'no_additional_work', 'no_additional_work']);
      expect((rendererDecision(turns[2]).communication as Json).scheduleIntent).toBe('register_event');
      expect(turns.filter(turn => turn.result?.message.includes('予定を追加'))).toHaveLength(1);
      const acknowledgement = await fixture.conversation.submit('わかりました'); assertNoWrite(acknowledgement);
      expect(acknowledgement.result?.state.lastQuestionContext).toBeUndefined();
      expect(acknowledgement.result?.message).not.toContain('予定を追加');
      const second = await fixture.conversation.submit('その予定も追加して'); assertNoWrite(second);
      expect(second.result?.communicationFacts?.statusReason).toBe('fixed_event_manual_entry');
      const afterSecond = await fixture.conversation.submit('わかりました'); assertNoWrite(afterSecond);
      expect(afterSecond.result?.state.lastQuestionContext).toBeUndefined();
      expect(afterSecond.result?.message).not.toContain('予定を追加');
      expect(fixture.conversation.graph()!.tasks).toEqual([]);
      expect(fixture.conversation.graph()!.availabilityDeclarations).toHaveLength(1);
    } else expect(turns.slice(2).map(turn => turn.result?.state.lastQuestionContext?.targetSlot)).toEqual(Array(3).fill('stable_v5:missing_schedulable_work'));
  });

  it('presents the handoff even when the same typed request shifts the topic', async () => {
    fixture = installFixedEventConversation({ busyOnly: true, registrationAct: true, topicShift: true });
    await fixture.conversation.submit(FIXED_EVENT_TURNS[0]); await fixture.conversation.submit(FIXED_EVENT_TURNS[1]);
    const event = await fixture.conversation.submit(FIXED_EVENT_TURNS[2]); assertNoWrite(event);
    expect((rendererDecision(event).communication as Json).goal).toBe('report_status');
    expect(event.result?.message).toContain('予定を追加');
    expect(event.result?.state.lastQuestionContext).toBeUndefined();
  });

  it.each(['登録しました。', '「予定を追加」で登録しました。', 'ほかに予定を入れたいですか？', '内容を確認しました。', '「予定を追加」から入力してください。ほかに予定があれば教えてください。'])('renderer violations use truthful one-time fallback: %s', async rendererText => {
    fixture = installFixedEventConversation({ rendererText });
    await fixture.conversation.submit(FIXED_EVENT_TURNS[0]);
    await fixture.conversation.submit(FIXED_EVENT_TURNS[1]);
    const event = await fixture.conversation.submit(FIXED_EVENT_TURNS[2]);
    assertNoWrite(event);
    expect(event.result?.responseSource).toBe('deterministic_fallback');
    expect(event.result?.message).toContain('予定を追加');
    expect(event.result?.message).toContain('保存できません');
    const declined = await fixture.conversation.submit(FIXED_EVENT_TURNS[3]);
    assertNoWrite(declined);
    expect(declined.result?.state.lastQuestionContext).toBeUndefined();
    expect(declined.result?.message).not.toContain('予定を追加');
    expect(declined.result?.message).not.toMatch(/[?？]/u);
  });

  it('still schedules study work beside a fixed event', async () => {
    fixture = installFixedEventConversation({ registrationAct: true, eventOverride: doc => ({ ...doc, tasks: [fixedEventTask(), eventStudyTask()] }) });
    await fixture.conversation.submit(FIXED_EVENT_TURNS[0]); await fixture.conversation.submit(FIXED_EVENT_TURNS[1]);
    const turn = await fixture.conversation.submit(MIXED_EVENT_TEXT); assertNoWrite(turn);
    expect(turn.result?.draftCandidates.length).toBeGreaterThan(0);
    expect(turn.result?.communicationFacts?.statusReason).toBeNull();
    expect(turn.result?.communicationFacts?.scheduleIntent).toBeUndefined();
    expect(fixture.conversation.graph()!.tasks).toHaveLength(2);
    const before = fixture.conversation.getState().previewCandidates;
    const declined = await fixture.conversation.submit(FIXED_EVENT_TURNS[3]); assertNoWrite(declined);
    expect(declined.result?.communicationFacts?.statusReason).toBe('preview_unchanged');
    expect(fixture.conversation.getState().previewCandidates).toEqual(before);
  });

  it('keeps existing-schedule detail purpose and required date question when declined', async () => {
    fixture = installFixedEventConversation({ registrationAct: true, eventOverride: doc => ({ ...doc,
      planningWindow: { localId: 'week', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' },
      tasks: [{ ...fixedEventTask(), sourceText: '部活', temporalConstraints: [{ ...fixedEventTask().temporalConstraints[0],
        dateExpression: null, sourceText: '10:30〜12:00',
      }] }],
    }) });
    const event = await fixture.conversation.submit('来週、部活が10:30〜12:00にある'); assertNoWrite(event);
    expect(event.result?.state.lastQuestionContext?.targetSlot).toBe('stable_v5:missing_commitment_date_scope');
    expect((rendererDecision(event).communication as Json).scheduleIntent).toBe('confirm_existing_schedule');
    expect(rendererDecision(event).questionIntent).toMatchObject({ kind: 'resolution_question', resolutionKind: 'commitment_date_scope' });
    const declined = await fixture.conversation.submit(FIXED_EVENT_TURNS[3]); assertNoWrite(declined);
    expect(declined.result?.state.lastQuestionContext?.targetSlot).toBe('stable_v5:missing_commitment_date_scope');
    expect(declined.result?.communicationFacts?.statusReason).toBeNull();
  });

  it.each(['effort', 'material', 'bounds'] as const)('decline never closes required %s clarification', async need => {
    fixture = installFixedEventConversation({ registrationAct: true, eventOverride: doc => ({ ...doc,
      tasks: [fixedEventTask(), ...(need === 'bounds' ? [{ ...eventStudyTask(), temporalConstraints: [{
        localId: 'study-deadline', targetLocalId: 'study', kind: 'earliest_start', constraintLevel: 'hard', dateExpression: 'tomorrow',
        namedTimePeriod: null, startTime: null, endTime: null, precision: 'exact', sourceText: '明日まで',
      }] }] : [eventStudyTask('problem')])],
      ...(need === 'material' ? { uncertainties: [{ localId: 'material-need', targetLocalId: 'study', field: 'material', reason: '教材の特定が必要', sourceText: '数学の問題集' }] } : {}),
    }) });
    await fixture.conversation.submit(FIXED_EVENT_TURNS[0]); await fixture.conversation.submit(FIXED_EVENT_TURNS[1]);
    const event = await fixture.conversation.submit(`${FIXED_EVENT_TURNS[2]}。数学の問題集を20問解く。数学を20分勉強する。明日まで`);
    assertNoWrite(event);
    const question = event.result!.state.lastQuestionContext;
    expect(question).toBeDefined();
    expect(question?.targetSlot).not.toBe('stable_v5:missing_schedulable_work');
    const graph = createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!);
    const declined = await fixture.conversation.submit(FIXED_EVENT_TURNS[3]); assertNoWrite(declined);
    expect(declined.result?.state.lastQuestionContext?.targetSlot).toBe(question?.targetSlot);
    expect(declined.result?.state.lastQuestionContext?.topicId).toBe(question?.topicId);
    expect(createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!)).toEqual(graph);
    expect(declined.result?.communicationFacts?.statusReason).toBeNull();
  });
});
