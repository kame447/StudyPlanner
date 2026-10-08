// Synthetic typed responses mirror only the reported semantic shape, never calendar data.
import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, describe, expect, it } from 'vitest';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime, type ScriptedConversation } from './testUtils/weeklyPlanningScriptedConversationHarness';
import { FIXED_EVENT_TURNS, eventDocument, eventRendererReply, eventStudyTask, fixedEventTask, type Json } from './testUtils/weeklyPlanningFixedEventOnlyFixture';
import { weeklyPlanningActiveFactReferenceErrorsV5 } from './semantic/weeklyPlanningActiveFactReferenceInvariantV5';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './semantic/weeklyPlanningActiveSchedulerGraphViewV5';

let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
afterEach(() => { provider?.restore(); resetScriptedConversationRuntime(); });
function setup(options: { correction?: boolean; registrationAct?: boolean } = {}) {
  let conversation: ScriptedConversation;
  let phase = 0;
  const window = (today: boolean) => ({ localId: today ? 'today-window' : 'tomorrow-window', kind: 'relative_day', value: today ? 'today' : 'tomorrow', start: null, end: null, sourceText: today ? '今日' : '明日' });
  provider = installScriptedWeeklyPlanningProvider(call => {
    if (call.kind === 'renderer') return eventRendererReply(call);
    if (call.kind === 'semantic_focused_authorization') return JSON.stringify({ decision: 'fallback' });
    if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    let doc: Json;
    if (phase === 0) doc = eventDocument({ planningIntent: 'create_plan', planningWindow: window(false), uncertainties: [{
      localId: 'window-need', targetLocalId: 'tomorrow-window', field: 'tasks', reason: '予定に入れる内容を確認', sourceText: FIXED_EVENT_TURNS[0],
    }], conversationActs: [] });
    else if (phase === 1) doc = eventDocument({ planningIntent: 'update_plan', planningWindow: window(true),
      ...(options.correction === false ? {} : { corrections: [{ localId: 'move-day', target: { kind: 'planning_window', publicId: createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!).planningWindows[0].id, localId: null, mention: null }, operation: 'replace', replacementLocalId: 'today-window', sourceText: FIXED_EVENT_TURNS[1] }] }), conversationActs: [] });
    else if (phase === 2) doc = eventDocument({ planningIntent: 'create_plan', planningWindow: window(true), tasks: [fixedEventTask()], conversationActs: options.registrationAct === false ? [] : [{ kind: 'request_event_registration', targetPublicId: null }] });
    else doc = eventDocument({ conversationActs: [{ kind: phase === 3 ? 'decline_additional_work' : 'answer_pending_question', targetPublicId: null }] });
    return JSON.stringify(doc);
  });
  conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', now: () => '2026-10-07T00:00:00.000Z' });
  return { conversation, submit: async (index: number) => { phase = index; return conversation.submit(FIXED_EVENT_TURNS[index]); } };
}

describe('live event window uncertainty follow-up (3604)', () => {
  it('explicit date replacement invalidates the obsolete window question without changing its historical evidence', async () => {
    const fixture = setup();
    const first = await fixture.submit(0);
    expect(first.result?.failure).toBeUndefined();
    expect(first.result?.state.lastQuestionContext?.targetSlot).toBe('stable_v5:missing_schedulable_work');
    const second = await fixture.submit(1);
    expect.soft(second.result?.failure).toBeUndefined();
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!);
    expect.soft(active.planningWindows.map(fact => fact.value)).toEqual(['today']);
    expect(active.uncertainties).toEqual([]);
    const historical = fixture.conversation.graph()!;
    expect(historical.uncertainties[0].targetFactId).toBe(historical.planningWindows[0].id);
  });

  it('implicit new-window supersession invalidates the obsolete window question', async () => {
    const fixture = setup({ correction: false });
    await fixture.submit(0);
    const second = await fixture.submit(1);
    expect(second.result?.failure).toBeUndefined();
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!);
    expect(active.planningWindows.map(fact => fact.value)).toEqual(['today']);
    expect(active.uncertainties).toEqual([]);
    const historical = fixture.conversation.graph()!;
    expect(historical.uncertainties[0].targetFactId).toBe(historical.planningWindows[0].id);
  });

  it.each([true, false])('five turns close the window invitation and deliver one handoff (registration act=%s)', async registrationAct => {
    const fixture = setup({ registrationAct });
    const turns = [];
    for (let index = 0; index < FIXED_EVENT_TURNS.length; index++) {
      const turn = await fixture.submit(index); turns.push(turn);
      expect.soft(turn.result?.failure, `turn${index + 1}`).toBeUndefined();
      expect.soft(turn.result?.state.shouldSavePlan).not.toBe(true);
      expect.soft(turn.result?.message).not.toMatch(/(?:登録|保存|追加)しました/u);
      expect.soft(turn.calls.length, `T${index + 1}: ${turn.calls.map(call => call.schemaName).join(', ')}`).toBeLessThanOrEqual([2, 2, 2, 2, 3][index]);
      if (index === 1) expect.soft(createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!).planningWindows.map(fact => fact.value)).toEqual(['today']);
      if (index === 2) {
        expect.soft(turn.result?.communicationFacts?.statusReason).toBe('fixed_event_manual_entry');
        expect.soft(turn.result?.message).toContain('予定を追加');
      }
    }
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!);
    expect.soft(active.planningWindows.map(fact => fact.value)).toEqual(['today']);
    expect.soft(active.uncertainties).toEqual([]);
    expect.soft(active.tasks.map(fact => fact.category)).toEqual(['non_study']);
    expect.soft(turns.slice(2, 4).filter(turn => turn.result?.communicationFacts?.statusReason === 'fixed_event_manual_entry')).toHaveLength(1);
    expect.soft(turns.slice(2).filter(turn => turn.result?.message.includes('予定を追加'))).toHaveLength(1);
    expect.soft(turns[4].result?.state.lastQuestionContext).toBeUndefined();
    expect.soft(turns[4].result?.message).not.toMatch(/[?？]/u);
    expect(fixture.conversation.getState().draftBlocks).toEqual([]);
    for (const turn of turns.slice(3)) {
      expect(turn.result?.state.lastQuestionContext).toBeUndefined();
      expect(turn.result?.message).not.toMatch(/[?？]|明日|予定を追加/u);
    }
  });
});

it('implicit event day replaces tomorrow when the correction turn is absent', async () => {
  const fixture = setup();
  await fixture.submit(0);
  const event = await fixture.submit(2);
  expect(event.result?.failure).toBeUndefined();
  expect(event.result?.communicationFacts?.statusReason).toBe('fixed_event_manual_entry');
  expect(event.result?.message).toContain('予定を追加');
  expect(event.calls.length).toBeLessThanOrEqual(2);
  expect(createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!).planningWindows[0].value).toBe('today');
  for (const phase of [3, 4]) {
    const turn = await fixture.submit(phase);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.result?.state.lastQuestionContext).toBeUndefined();
    expect(turn.result?.message).not.toMatch(/[?？]|明日|予定を追加|(?:登録|保存|追加)しました/u);
  }
});

const windowCases = [
  { name: 'identical relative day', old: { kind: 'relative_day', value: 'tomorrow', start: null, end: null }, next: { kind: 'relative_day', value: 'tomorrow', start: null, end: null }, keep: true },
  { name: 'changed relative day', old: { kind: 'relative_day', value: 'tomorrow', start: null, end: null }, next: { kind: 'relative_day', value: 'today', start: null, end: null }, keep: false },
  { name: 'changed relative week', old: { kind: 'relative_week', value: 'next_week', start: null, end: null }, next: { kind: 'relative_week', value: 'this_week', start: null, end: null }, keep: false },
  { name: 'changed absolute range', old: { kind: 'absolute', value: '2026-10-08/2026-10-08', start: '2026-10-08', end: '2026-10-08' }, next: { kind: 'absolute', value: '2026-10-09/2026-10-09', start: '2026-10-09', end: '2026-10-09' }, keep: false },
  { name: 'cross kind equivalent date', old: { kind: 'relative_day', value: 'tomorrow', start: null, end: null }, next: { kind: 'absolute', value: '2026-10-08/2026-10-08', start: '2026-10-08', end: '2026-10-08' }, keep: true },
  { name: 'reworded named period', old: { kind: 'named_period', value: '10月中旬', start: null, end: null }, next: { kind: 'named_period', value: '10月半ば', start: null, end: null }, keep: true },
];

describe.each([false, true])('typed window policy through the controller (explicit=%s)', explicit => {
  it.each(windowCases)('preserves only identical or unknown meaning: $name', async variant => {
    let conversation: ScriptedConversation;
    let phase = 0;
    const text = '明日の予定を立てたい。数学を20分勉強する。10月中旬、来週';
    provider = installScriptedWeeklyPlanningProvider(call => {
      if (call.kind === 'renderer') return eventRendererReply(call);
      if (call.kind === 'semantic_focused_authorization') return JSON.stringify({ decision: 'fallback' });
      if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
      const sourceText = phase === 0 ? text : '期間を確認する。10月半ば、今日、今週、2026-10-08、2026-10-09';
      return JSON.stringify(phase === 2 ? eventDocument({ planningWindow: { localId: 'answer', kind: 'relative_day', value: 'today', start: null, end: null, sourceText: '今日にします' }, conversationActs: [{ kind: 'answer_pending_question', targetPublicId: null }] }) : phase === 0 ? eventDocument({ planningIntent: 'create_plan',
        planningWindow: { localId: 'old', ...variant.old, sourceText }, tasks: [eventStudyTask()],
        uncertainties: [{ localId: 'need', targetLocalId: 'old', field: 'planningWindow', reason: '期間を確認', sourceText }], conversationActs: [] })
        : eventDocument({ planningWindow: { localId: 'replacement', ...variant.next, sourceText },
          ...(explicit ? { corrections: [{ localId: 'replace', target: { kind: 'planning_window', publicId: createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!).planningWindows[0].id, localId: null, mention: null }, operation: 'replace', replacementLocalId: 'replacement', sourceText }] } : {}), conversationActs: [] }));
    });
    conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', now: () => '2026-10-07T00:00:00.000Z' });
    const first = await conversation.submit(text);
    expect(first.result?.failure).toBeUndefined();
    const need = conversation.graph()!.uncertainties[0];
    expect(first.result?.state.lastQuestionContext?.topicId).toBe(need.id);
    phase = 1;
    const replacement = await conversation.submit('期間を確認する。10月半ば、今日、今週、2026-10-08、2026-10-09');
    expect(replacement.result?.failure).toBeUndefined();
    const graph = conversation.graph()!;
    expect(weeklyPlanningActiveFactReferenceErrorsV5(graph)).toEqual([]);
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(graph);
    expect(active.planningWindows).toHaveLength(1);
    if (variant.keep) {
      expect(active.uncertainties).toEqual([{ ...need, targetFactId: active.planningWindows[0].id }]);
      expect(replacement.result?.state.lastQuestionContext?.topicId).toBe(need.id);
      expect(replacement.result?.draftCandidates).toEqual([]);
      if (variant.name === 'identical relative day') {
        phase = 2;
        const answer = await conversation.submit('今日にします');
        expect(answer.result?.failure).toBeUndefined();
        expect(answer.calls.filter(call => call.kind === 'semantic_generic')).toHaveLength(1);
        expect(answer.calls.length).toBeLessThanOrEqual(2);
        expect(answer.result?.state.lastQuestionContext?.topicId).not.toBe(need.id);
        expect(answer.result?.draftCandidates.length).toBeGreaterThan(0);
        expect(conversation.graph()!.factLifecycles.find(entry => entry.factId === need.id)?.status).toBe('removed');
      }
    } else {
      expect(active.uncertainties).toEqual([]);
      expect(graph.factLifecycles.find(entry => entry.factId === need.id)?.status).toBe('removed');
      expect(replacement.result?.state.lastQuestionContext?.topicId).not.toBe(need.id);
    }
  });
});
