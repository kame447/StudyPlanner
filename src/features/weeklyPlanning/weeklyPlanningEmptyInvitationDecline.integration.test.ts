// R12: follow-up scope after EV v1 audit, separate from wording.
import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, expect, it } from 'vitest';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime } from './testUtils/weeklyPlanningScriptedConversationHarness';
import { eventDocument, eventRendererReply, eventStudyTask } from './testUtils/weeklyPlanningFixedEventOnlyFixture';

let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
afterEach(() => { provider?.restore(); resetScriptedConversationRuntime(); });
it.each([false, true])('R12 empty invitation declines close only optional questions (required=%s)', async required => {
  let phase = 0;
  const text = required ? '期間はまだ決めていない' : '今日の予定を立てたい';
  provider = installScriptedWeeklyPlanningProvider(call => {
    if (call.kind === 'renderer') return eventRendererReply(call);
    if (call.kind === 'semantic_focused_authorization') return JSON.stringify({ decision: 'fallback' });
    if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    return JSON.stringify(phase === 0 ? eventDocument({ planningIntent: 'create_plan', planningWindow: {
      localId: 'window', kind: required ? 'named_period' : 'relative_day', value: required ? '指定未確定の期間' : 'today', start: null, end: null, sourceText: text,
    }, uncertainties: required ? [{ localId: 'required-period', targetLocalId: 'window', field: 'unknown_period', reason: '期間を確認', sourceText: text }] : [], conversationActs: [] })
      : eventDocument({ conversationActs: [{ kind: 'decline_additional_work', targetPublicId: null }] }));
  });
  const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', now: () => '2026-10-07T00:00:00.000Z' });
  const first = await conversation.submit(text);
  expect(first.result?.failure).toBeUndefined();
  expect(first.result?.state.lastQuestionContext).toBeDefined();
  const target = first.result?.state.lastQuestionContext?.topicId;
  const before = conversation.graph()!;
  expect(before.tasks).toEqual([]);
  expect(before.availabilityDeclarations).toEqual([]);
  phase = 1;
  for (const decline of ['特にない', 'ない']) {
    const turn = await conversation.submit(decline);
    expect.soft(turn.result?.failure).toBeUndefined();
    expect.soft(turn.result?.draftCandidates).toEqual([]);
    expect.soft(turn.result?.state.shouldSavePlan).not.toBe(true);
    expect.soft(turn.result?.message).not.toContain('予定を追加');
    if (required) {
      expect.soft(turn.result?.state.lastQuestionContext?.topicId).toBe(target);
      expect.soft(turn.result?.state.lastQuestionContext?.targetSlot).toBe('stable_v5:semantic_uncertainty');
    } else {
      expect.soft(turn.result?.state.lastQuestionContext).toBeUndefined();
      expect.soft(turn.result?.communicationFacts?.statusReason).toBe('no_additional_work');
      expect.soft(turn.result?.message).not.toMatch(/[?？]|教えてください/u);
    }
  }
});

it('an optional decline ends the invitation and later study still creates a normal preview', async () => {
  let phase = 0;
  provider = installScriptedWeeklyPlanningProvider(call => {
    if (call.kind === 'renderer') return eventRendererReply(call);
    return JSON.stringify(phase === 0 ? eventDocument({ planningIntent: 'create_plan', planningWindow: {
      localId: 'today', kind: 'relative_day', value: 'today', start: null, end: null, sourceText: '今日',
    }, conversationActs: [] }) : phase === 1 ? eventDocument({ conversationActs: [{ kind: 'decline_additional_work', targetPublicId: null }] })
      : eventDocument({ planningIntent: 'create_plan', tasks: [eventStudyTask()], conversationActs: [] }));
  });
  const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', now: () => '2026-10-07T00:00:00.000Z' });
  await conversation.submit('今日の予定を立てたい');
  phase = 1;
  const decline = await conversation.submit('ない');
  expect(decline.result?.failure).toBeUndefined();
  expect(decline.result?.state.lastQuestionContext).toBeUndefined();
  phase = 2;
  const study = await conversation.submit('数学を20分勉強する');
  expect(study.result?.failure).toBeUndefined();
  expect(study.result?.draftCandidates).toHaveLength(1);
  expect(study.result?.state.shouldSavePlan).not.toBe(true);
  expect(study.calls.map(call => call.kind)).toEqual(['semantic_generic', 'renderer']);
});

it.each(['no_act', 'no_previous_invitation', 'legacy_v5'] as const)('does not close an invitation outside the typed interaction boundary (%s)', async shape => {
  let phase = 0;
  const architecture = shape === 'legacy_v5' ? 'legacy_v5' : 'interaction_v1';
  provider = installScriptedWeeklyPlanningProvider(call => {
    if (call.kind === 'renderer') return eventRendererReply(call);
    return JSON.stringify(eventDocument({
      ...(phase === 0 ? { planningIntent: 'create_plan', planningWindow: { localId: 'today', kind: 'relative_day', value: 'today', start: null, end: null, sourceText: '今日' } } : {}),
      ...(architecture === 'interaction_v1' ? { conversationActs: phase && shape !== 'no_act' ? [{ kind: 'decline_additional_work', targetPublicId: null }] : [] } : {}),
    }));
  });
  const conversation = createScriptedConversation({ provider, architecture, now: () => '2026-10-07T00:00:00.000Z' });
  if (shape !== 'no_previous_invitation') await conversation.submit('今日の予定を立てたい');
  phase = 1;
  const next = await conversation.submit('ない');
  expect(next.result?.failure).toBeUndefined();
  expect(next.result?.state.lastQuestionContext?.targetSlot).toBe('stable_v5:missing_schedulable_work');
  expect(next.result?.communicationFacts?.statusReason).not.toBe('no_additional_work');
  expect(next.result?.state.shouldSavePlan).not.toBe(true);
});
