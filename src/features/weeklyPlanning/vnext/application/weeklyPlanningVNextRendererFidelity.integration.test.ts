import { describe, expect, it, vi } from 'vitest';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from '../semantic/weeklyPlanningVNextTransaction';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import { createWeeklyPlanningStableV5DialogueRendererCore } from '../weeklyPlanningVNextV5Boundary';
import type { VNextAddFact, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';
import { createWeeklyPlanningVNextRenderInput } from './weeklyPlanningVNextDialogue';

// Independent fixture truth from Issue #915. Never use a renderer's declared quantities as its oracle.
const GOLD = { 数学: 90, 英語: 45 };
const GOOD_TEXT = '数学は90分、英語は45分ですね。';
const WRONG_TEXT = '英語は90分ですね。';
const SWAPPED = { 数学: 45, 英語: 90 };
const SWAPPED_TEXT = '数学は45分、英語は90分ですね。';

function seed(add: VNextAddFact[]): WeeklyPlanningVNextState {
  const state = createEmptyWeeklyPlanningVNextState();
  const result = applyWeeklyPlanningVNextTurn(state, { add, patch: [], remove: [], relate: [], defer: [] }, {
    expectedRevision: 0, conversationId: 'renderer-fidelity', turnId: 'seed', turnKey: 'seed',
    acceptedDate: '2026-11-02', weekStartsOn: 'monday',
    planningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' },
    defaultPlanningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' },
    sourceText: '数学90分と英語45分をやりたい',
  });
  if (result.status !== 'applied') throw new Error(JSON.stringify(result));
  return result.state;
}

function durations(minutes = GOLD) {
  return seed(Object.entries(minutes).flatMap(([title, amount], index): VNextAddFact[] => [
    { kind: 'task', localId: `task-${index}`, category: 'non_study', title },
    { kind: 'effort_estimate', localId: `effort-${index}`, taskRef: { localId: `task-${index}` },
      targetRef: { localId: `task-${index}` }, effortKind: 'total_duration', minutes: amount,
      unitCode: null, unitLabel: null, precision: 'exact' },
  ]));
}

const renderInput = (state: WeeklyPlanningVNextState, question = false) => createWeeklyPlanningVNextRenderInput({
  state, question: question ? projectWeeklyPlanningVNext(state).questions[0] : null, preview: null,
  actionId: 'fidelity-review', turnId: 'review', previousQuestionCode: null,
  userText: '内容を確認してください', recentConversation: [],
});
type RenderResult = Awaited<ReturnType<ReturnType<typeof createWeeklyPlanningStableV5DialogueRendererCore>['render']>>;

async function render(state: WeeklyPlanningVNextState, text: string, question = false) {
  const input = renderInput(state, question);
  const request = vi.fn(async () => JSON.stringify({ actionId: input.actionId, actionKind: input.actionKind,
    questionCode: input.questionCode, groundingAcknowledgement: null, text }));
  const result = await createWeeklyPlanningStableV5DialogueRendererCore({ createChatCompletion: request }).render(input);
  return { result, input, request };
}

function statedDurations(state: WeeklyPlanningVNextState) {
  const active = new Set(state.graph.factLifecycles.filter(fact => fact.status === 'active').map(fact => fact.factId));
  return Object.fromEntries(state.graph.effortEstimates.filter(fact => active.has(fact.id)).map(fact => [
    state.graph.tasks.find(task => task.id === fact.taskId)!.title, fact.minutes,
  ]));
}

/**
 * A finite, independently specified evaluation oracle, outside production. Its review is bound to
 * BOTH the actual typed input and the actual reply string. These synthetic control verdicts do not
 * classify arbitrary Japanese or establish a human-reviewed real-model benchmark. An unseen reply
 * is unreviewed, not silently counted as correct. No additional model/verifier request is made.
 */
const reviews = [
  { given: GOLD, text: GOOD_TEXT, verdict: 'faithful' },
  { given: GOLD, text: WRONG_TEXT, verdict: 'unfaithful' },
  { given: SWAPPED, text: SWAPPED_TEXT, verdict: 'faithful' },
] as const;
function evaluate(state: WeeklyPlanningVNextState, result: RenderResult) {
  const actual = statedDurations(state);
  const stateCorrect = JSON.stringify(actual) === JSON.stringify(GOLD);
  const review = result.status === 'rendered' ? reviews.find(item =>
    JSON.stringify(item.given) === JSON.stringify(actual) && item.text === result.text) : undefined;
  const textFidelity = result.status === 'rendered' ? review?.verdict ?? 'unreviewed' : 'unavailable';
  return { stateCorrect, textFidelity, passed: stateCorrect && textFidelity === 'faithful' };
}

describe('#915 VNext state correctness and renderer text fidelity are independent observations', () => {
  it('has a positive control: the correct state and its faithful natural reply both pass', async () => {
    const state = durations();
    const before = structuredClone(state);
    const { result, input, request } = await render(state, GOOD_TEXT);
    expect(input.currentTurnGrounding?.mode).toBe('none');
    expect(result).toMatchObject({ status: 'rendered', text: GOOD_TEXT });
    expect(evaluate(state, result)).toEqual({ stateCorrect: true, textFidelity: 'faithful', passed: true });
    expect(request).toHaveBeenCalledTimes(1);
    expect(state).toEqual(before);
  });

  it('detects the known wrong-task duration in the reply even though the real renderer structurally accepts it', async () => {
    const state = durations();
    const before = structuredClone(state);
    const { result, input, request } = await render(state, WRONG_TEXT);
    expect(result).toMatchObject({ status: 'rendered', text: WRONG_TEXT });
    expect(input.planningInformation?.effortEstimates).toMatchObject([{ minutes: 90 }, { minutes: 45 }]);
    // A state-only oracle would pass this known bad reply. The independent finite text oracle must fail it.
    expect(evaluate(state, result)).toEqual({ stateCorrect: true, textFidelity: 'unfaithful', passed: false });
    expect(request).toHaveBeenCalledTimes(1);
    expect(state).toEqual(before);
  });

  it('does not let a fluent reply faithful to the wrong state certify semantic state correctness', async () => {
    const state = durations(SWAPPED);
    const before = structuredClone(state);
    const { result } = await render(state, SWAPPED_TEXT);
    expect(result).toMatchObject({ status: 'rendered', text: SWAPPED_TEXT });
    expect(evaluate(state, result)).toEqual({ stateCorrect: false, textFidelity: 'faithful', passed: false });
    expect(state).toEqual(before);
  });

  it('does not reuse a text verdict against different typed ownership', async () => {
    const state = durations(SWAPPED);
    const { result } = await render(state, GOOD_TEXT);
    expect(result.status).toBe('rendered');
    expect(evaluate(state, result)).toEqual({ stateCorrect: false, textFidelity: 'unreviewed', passed: false });
  });

  it('does not count an unreviewed natural paraphrase as measured fidelity or reject it in production', async () => {
    const state = durations();
    const { result } = await render(state, 'ご希望の内容を整理しました。');
    expect(result.status).toBe('rendered');
    expect(evaluate(state, result)).toEqual({ stateCorrect: true, textFidelity: 'unreviewed', passed: false });
  });

  it('keeps a real question about quantity and time separate from a factual duration assertion', async () => {
    const state = seed([
      { kind: 'task', localId: 'english', category: 'non_study', title: '英語' },
      { kind: 'workload', localId: 'pages', taskRef: { localId: 'english' }, componentRef: null,
        quantityRole: 'remaining', amount: 45, unitCode: 'page', unitLabel: 'ページ', rangeStart: null,
        rangeEnd: null, perOccurrence: false, periodExpression: null },
    ]);
    const before = structuredClone(state);
    const text = '英語の残り45ページには、何分くらいかかりますか？';
    const { result, input, request } = await render(state, text, true);
    expect(input).toMatchObject({ actionKind: 'question', questionCode: 'missing_effort_estimate',
      questionIntent: { kind: 'effort_measurement', amount: 45, unitLabel: 'ページ' } });
    expect(result).toMatchObject({ status: 'rendered', text });
    expect(state.graph.effortEstimates).toEqual([]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(state).toEqual(before);
  });

  it('reports renderer failure as unavailable fidelity, not a successful empty or faithful reply', async () => {
    const state = durations();
    const before = structuredClone(state);
    const request = vi.fn(async (): Promise<string> => { throw new Error('synthetic provider failure'); });
    const result = await createWeeklyPlanningStableV5DialogueRendererCore({ createChatCompletion: request }).render(renderInput(state));
    expect(result).toMatchObject({ status: 'fallback', reason: 'provider_error' });
    expect(evaluate(state, result)).toEqual({ stateCorrect: true, textFidelity: 'unavailable', passed: false });
    expect(request).toHaveBeenCalledTimes(1);
    expect(state).toEqual(before);
  });
});
