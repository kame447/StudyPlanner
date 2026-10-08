// Synthetic typed responses mirror only the reported semantic shape, never calendar data.
import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, describe, expect, it } from 'vitest';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime, type ScriptedConversation } from './testUtils/weeklyPlanningScriptedConversationHarness';
import { FIXED_EVENT_TURNS, eventDocument, eventRendererReply, eventStudyTask, fixedEventTask, type Json } from './testUtils/weeklyPlanningFixedEventOnlyFixture';
import { prepareWeeklyPlanningStableV5Checkpoint, largestWeeklyPlanningStableV5Checkpoint, parseWeeklyPlanningStableV5PersistedSession } from './application/weeklyPlanningStableV5SessionCodec';
import { hydrateWeeklyPlanningStableV5RuntimeSession } from './application/weeklyPlanningStableV5RuntimeSession';
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

describe('Sturdy live event window uncertainty review', () => {
  it('explicit date replacement invalidates only the prior window uncertainty', async () => {
    const fixture = setup();
    const first = await fixture.submit(0);
    expect(first.result?.failure).toBeUndefined();
    expect(createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!).uncertainties).toHaveLength(1);
    const second = await fixture.submit(1);
    expect.soft(second.result?.failure).toBeUndefined();
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!);
    expect.soft(active.planningWindows.map(fact => fact.value)).toEqual(['today']);
    expect(active.uncertainties).toEqual([]);
  });

  it('implicit changed-window supersession invalidates the old window uncertainty', async () => {
    const fixture = setup({ correction: false });
    await fixture.submit(0);
    const second = await fixture.submit(1);
    expect(second.result?.failure).toBeUndefined();
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!);
    expect(active.planningWindows.map(fact => fact.value)).toEqual(['today']);
    expect(active.uncertainties).toEqual([]);
  });

  it.each([true, false])('five turns close the window invitation and deliver one handoff (registration act=%s)', async registrationAct => {
    const fixture = setup({ registrationAct });
    const turns = [];
    for (let index = 0; index < FIXED_EVENT_TURNS.length; index++) {
      const turn = await fixture.submit(index); turns.push(turn);
      expect.soft(turn.result?.failure, `turn${index + 1}`).toBeUndefined();
      expect.soft(turn.result?.state.shouldSavePlan).not.toBe(true);
      expect.soft(turn.result?.message).not.toMatch(/(?:登録|保存|追加)しました/u);
      if (index === 1) expect.soft(createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!).planningWindows.map(fact => fact.value)).toEqual(['today']);
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
  });
});


describe('Sturdy event closure negative controls', () => {
  it.each(['task_need', 'incomplete_study', 'missing_event_date', 'new_window_need'] as const)('retains required resolution for %s', async shape => {
    let phase = 0;
    const event = fixedEventTask();
    if (shape === 'missing_event_date') event.temporalConstraints[0].dateExpression = null as unknown as string;
    const study = eventStudyTask('problem');
    const source = `${FIXED_EVENT_TURNS[2]}。数学の問題集を20問解く。来週`;
    const first = eventDocument({ planningIntent: 'create_plan', planningWindow: {
      localId: 'window', kind: shape === 'missing_event_date' ? 'relative_week' : 'relative_day', value: shape === 'missing_event_date' ? 'next_week' : 'today', start: null, end: null, sourceText: shape === 'missing_event_date' ? '来週' : '今日',
    }, tasks: [event, ...(['task_need', 'incomplete_study'].includes(shape) ? [study] : [])],
      uncertainties: shape === 'task_need' ? [{ localId: 'material-need', targetLocalId: 'study', field: 'material_identity', reason: '教材の特定が必要', sourceText: '数学の問題集' }]
        : shape === 'new_window_need' ? [{ localId: 'new-window-need', targetLocalId: 'window', field: 'tasks', reason: '内容を確認', sourceText: '今日' }] : [],
      conversationActs: [{ kind: 'request_event_registration', targetPublicId: null }],
    });
    provider = installScriptedWeeklyPlanningProvider(call => {
      if (call.kind === 'renderer') return eventRendererReply(call);
      if (call.kind === 'semantic_focused_authorization') return JSON.stringify({ decision: 'fallback' });
      if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
      return JSON.stringify(phase === 0 ? first : eventDocument({ conversationActs: [{ kind: 'decline_additional_work', targetPublicId: null }] }));
    });
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', now: () => '2026-10-07T00:00:00.000Z' });
    const initial = await conversation.submit(source);
    expect(initial.result?.failure).toBeUndefined();
    if (shape === 'new_window_need') {
      //3604: presentation suspends this need, but its lifecycle stays active.
      expect(initial.result?.communicationFacts?.statusReason).toBe('fixed_event_manual_entry');
      expect(initial.result?.state.lastQuestionContext).toBeUndefined();
      expect(createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!).uncertainties).toHaveLength(1);
      return;
    }
    expect(initial.result?.state.lastQuestionContext).toBeDefined();
    expect(initial.result?.communicationFacts?.statusReason).not.toBe('fixed_event_manual_entry');
    const before = createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!);
    phase = 1;
    const declined = await conversation.submit('特にない');
    expect(declined.result?.failure).toBeUndefined();
    expect(declined.result?.state.lastQuestionContext?.targetSlot).toBe(initial.result?.state.lastQuestionContext?.targetSlot);
    expect(declined.result?.communicationFacts?.statusReason).toBeNull();
    expect(declined.result?.state.shouldSavePlan).not.toBe(true);
    expect(createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!)).toEqual(before);
  });
});

it('retains a real window uncertainty across event handoff and blocks later study preview', async () => {
  let phase = 0;
  const texts = ['来週あたりに予定を立てたい', '10月17日10:30〜12:00は部活を入れておいて', '数学を20分勉強する'];
  const event = fixedEventTask('2026-10-17');
  event.sourceText = texts[1];
  event.temporalConstraints[0].sourceText = texts[1];
  provider = installScriptedWeeklyPlanningProvider(call => {
    if (call.kind === 'renderer') return eventRendererReply(call);
    if (call.kind === 'semantic_focused_authorization') return JSON.stringify({ decision: 'fallback' });
    if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    return JSON.stringify(phase === 0 ? eventDocument({ planningIntent: 'create_plan', planningWindow: {
      localId: 'window', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: texts[0],
    }, uncertainties: [{ localId: 'which-week', targetLocalId: 'window', field: 'date_scope', reason: '来週か再来週かを確認', sourceText: texts[0] }], conversationActs: [] })
      : phase === 1 ? eventDocument({ planningIntent: 'create_plan', tasks: [event], conversationActs: [{ kind: 'request_event_registration', targetPublicId: null }] })
        : eventDocument({ planningIntent: 'create_plan', tasks: [eventStudyTask()], conversationActs: [] }));
  });
  const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', now: () => '2026-10-07T00:00:00.000Z' });
  await conversation.submit(texts[0]);
  const need = createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!).uncertainties[0];
  expect(need).toBeDefined();
  phase = 1;
  const handoff = await conversation.submit(texts[1]);
  expect(handoff.result?.failure).toBeUndefined();
  expect.soft(handoff.result?.communicationFacts?.statusReason).toBe('fixed_event_manual_entry');
  expect.soft(createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!).uncertainties).toContainEqual(need);
  phase = 2;
  const study = await conversation.submit(texts[2]);
  expect(study.result?.failure).toBeUndefined();
  expect(study.result?.state.lastQuestionContext?.targetSlot).toBe('stable_v5:semantic_uncertainty');
  expect(study.result?.state.lastQuestionContext?.topicId).toBe(need.id);
  expect(study.result?.draftCandidates).toEqual([]);
  expect(study.result?.state.shouldSavePlan).not.toBe(true);
});

it.each(['same_value', 'active_study_decline'] as const)('preserves window uncertainty under %s', async shape => {
  let phase = 0;
  const window = { localId: 'window', kind: 'relative_day', value: 'tomorrow', start: null, end: null, sourceText: '明日' };
  const text = shape === 'same_value' ? '明日の予定を立てたい' : '明日の予定を立てたい。数学を20分勉強する';
  provider = installScriptedWeeklyPlanningProvider(call => {
    if (call.kind === 'renderer') return eventRendererReply(call);
    if (call.kind === 'semantic_focused_authorization') return JSON.stringify({ decision: 'fallback' });
    if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    return JSON.stringify(phase === 0 ? eventDocument({ planningIntent: 'create_plan', planningWindow: window,
      tasks: shape === 'active_study_decline' ? [eventStudyTask()] : [],
      uncertainties: [{ localId: 'scope', targetLocalId: 'window', field: 'scope_unknown', reason: '計画期間を確認', sourceText: '明日' }], conversationActs: [] })
      : eventDocument(shape === 'same_value' ? { planningWindow: { ...window, localId: 'same-window' }, conversationActs: [] }
        : { conversationActs: [{ kind: 'decline_additional_work', targetPublicId: null }] }));
  });
  const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', now: () => '2026-10-07T00:00:00.000Z' });
  const first = await conversation.submit(text);
  expect(first.result?.failure).toBeUndefined();
  const before = createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!);
  const need = before.uncertainties[0]; expect(need).toBeDefined();
  phase = 1;
  const next = await conversation.submit(shape === 'same_value' ? '明日のままで' : '特にない');
  expect(next.result?.failure).toBeUndefined();
  const after = createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!);
  expect(after.uncertainties).toHaveLength(1);
  expect(after.uncertainties[0]).toMatchObject({ id: need.id, field: need.field, source: need.source });
  expect(after.planningWindows.map(fact => fact.id)).toContain(after.uncertainties[0].targetFactId);
  if (shape === 'active_study_decline') {
    expect(after).toEqual(before);
    expect(next.result?.state.lastQuestionContext?.targetSlot).toBe('stable_v5:semantic_uncertainty');
    expect(next.result?.draftCandidates).toEqual([]);
  }
});

it.each([false, true])('movable non-study work respects a real window need (has need=%s)', async hasNeed => {
  const source = '来週あたりに散歩を20分したい';
  const task = { ...eventStudyTask(), category: 'non_study', title: '散歩', study: null, sourceText: source,
    workloads: [{ ...eventStudyTask().workloads[0], sourceText: source }] };
  provider = installScriptedWeeklyPlanningProvider(call => call.kind === 'renderer' ? eventRendererReply(call)
    : JSON.stringify(eventDocument({ planningIntent: 'create_plan', planningWindow: {
      localId: 'window', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: source,
    }, tasks: [task], uncertainties: hasNeed ? [{ localId: 'which-week', targetLocalId: 'window', field: 'date_scope', reason: '来週か再来週かを確認', sourceText: source }] : [], conversationActs: [] })));
  const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', now: () => '2026-10-07T00:00:00.000Z' });
  const turn = await conversation.submit(source);
  expect(turn.result?.failure).toBeUndefined();
  expect(createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!).tasks.map(fact => fact.category)).toEqual(['non_study']);
  if (hasNeed) {
    expect(turn.result?.state.lastQuestionContext?.targetSlot).toBe('stable_v5:semantic_uncertainty');
    expect(turn.result?.draftCandidates).toEqual([]);
  } else expect(turn.result?.draftCandidates.length).toBeGreaterThan(0);
});


it.each(['legacy_v5', 'interaction_v1'] as const)('loads a main-shaped dangling window session and accepts its next study turn in %s', async architecture => {
  const fixture = setup({ correction: false });
  const first = await fixture.submit(0);
  await fixture.submit(1);
  const graph = fixture.conversation.graph()!;
  const need = graph.uncertainties[0];
  // Freeze the old producer's shape even after the replacement fix: active need -> old superseded window.
  const oldWindow = graph.planningWindows.find(fact => fact.value === 'tomorrow')!;
  need.targetFactId = oldWindow.id;
  const lifecycle = graph.factLifecycles.find(fact => fact.factId === need.id)!;
  lifecycle.status = 'active'; lifecycle.terminalRevision = null; lifecycle.supersededByFactId = null;
  const scope = { ownerId: fixture.conversation.ownerId, weekStartDate: fixture.conversation.weekStartDate, conversationId: fixture.conversation.conversationId };
  // The pending question belongs inside intakeState, not the PlanningState envelope.
  const state = { ...fixture.conversation.getState(), conversationArchitecture: architecture,
    intakeState: { ...fixture.conversation.getState().intakeState!, lastQuestionContext: first.result!.state.lastQuestionContext } };
  const prepared = prepareWeeklyPlanningStableV5Checkpoint({ ...scope, graph, planningState: state });
  expect(prepared.status).toBe('ready'); if (prepared.status !== 'ready') return;
  const wire = largestWeeklyPlanningStableV5Checkpoint({ ...scope, graph, planningState: prepared.planningState, savedAt: '2026-10-07T00:00:00.000Z' });
  expect(wire).not.toBeNull();
  const parsed = parseWeeklyPlanningStableV5PersistedSession({ ...scope, raw: wire!.raw });
  expect(parsed).not.toBeNull();
  expect(parsed!.graph).toEqual(graph);
  expect.soft(createWeeklyPlanningActiveSchedulerGraphViewV5(parsed!.graph).uncertainties).toEqual([]);
  provider.restore(); resetScriptedConversationRuntime();
  provider = installScriptedWeeklyPlanningProvider(call => call.kind === 'renderer' ? eventRendererReply(call)
    : JSON.stringify(eventDocument({ planningIntent: 'create_plan', tasks: [eventStudyTask()], ...(architecture === 'interaction_v1' ? { conversationActs: [] } : {}) })));
  hydrateWeeklyPlanningStableV5RuntimeSession({ ...scope, graph: parsed!.graph });
  const resumed = createScriptedConversation({ ...scope, provider, initialState: parsed!.planningState, now: () => '2026-10-07T00:00:00.000Z' });
  const turn = await resumed.submit('数学を20分勉強する');
  expect(turn.result?.failure).toBeUndefined();
  expect(turn.result?.draftCandidates.length).toBeGreaterThan(0);
  expect(turn.result?.state.lastQuestionContext?.targetSlot).not.toBe('stable_v5:semantic_uncertainty');
  expect(prepareWeeklyPlanningStableV5Checkpoint({ ...scope, graph: resumed.graph()!, planningState: resumed.getState() }).status).toBe('ready');
});
