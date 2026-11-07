import { describe, expect, it, vi } from 'vitest';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from '../semantic/weeklyPlanningVNextTransaction';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import { createWeeklyPlanningStableV5DialogueRendererCore } from '../weeklyPlanningVNextV5Boundary';
import type { VNextAddFact, VNextTurnDelta, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';
import { deriveVNextAcceptedCorrections } from './weeklyPlanningVNextCorrections';
import { createWeeklyPlanningVNextRenderInput } from './weeklyPlanningVNextDialogue';

const horizon = { startDate: '2026-11-02', endDate: '2026-11-08' };
function turn(state: WeeklyPlanningVNextState, delta: Partial<VNextTurnDelta>, id: string) {
  const result = applyWeeklyPlanningVNextTurn(state, { add: [], patch: [], remove: [], relate: [], defer: [], ...delta }, {
    expectedRevision: state.graph.revision, conversationId: 'corrections', turnId: id, turnKey: id,
    acceptedDate: '2026-11-02', weekStartsOn: 'monday', planningHorizon: horizon, defaultPlanningHorizon: horizon, sourceText: id,
  });
  if (result.status !== 'applied') throw new Error(JSON.stringify(result));
  return result;
}
const seedFacts: VNextAddFact[] = [
  { kind: 'task', localId: 'task', category: 'unknown', title: '資料' },
  { kind: 'workload', localId: 'workload', taskRef: { localId: 'task' }, componentRef: null, quantityRole: 'remaining', amount: 12,
    unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null },
  { kind: 'effort_estimate', localId: 'effort', taskRef: { localId: 'task' }, targetRef: { localId: 'workload' },
    effortKind: 'duration_per_unit', minutes: 5, unitCode: 'page', unitLabel: 'ページ', precision: 'exact' },
];
function seeded() {
  const result = turn(createEmptyWeeklyPlanningVNextState(), { add: seedFacts }, 'seed');
  const active = (kind: 'workloads' | 'effortEstimates') => result.state.graph[kind][0].id;
  return { state: result.state, workloadId: active('workloads'), effortId: active('effortEstimates') };
}
const patchWorkload = (targetFactId: string, amount: number): Partial<VNextTurnDelta> => ({
  patch: [{ kind: 'workload', targetFactId, localId: 'w2', changes: { amount, unitCode: null, unitLabel: null, quantityRole: null,
    rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null } }] } as Partial<VNextTurnDelta>);
const derive = (before: WeeklyPlanningVNextState, result: ReturnType<typeof turn>) =>
  deriveVNextAcceptedCorrections({ before: before.graph, after: result.state.graph, superseded: result.diff.superseded });

describe('#958 accepted corrections come from the revision diff', () => {
  it('reports the old and new value of a workload patched in this turn', () => {
    const { state, workloadId } = seeded();
    const result = turn(state, patchWorkload(workloadId, 8), 'correct');
    expect(derive(state, result)).toEqual([{ kind: 'workload', targetTitle: '資料', quantityRole: 'remaining',
      before: { amount: 12, unitLabel: 'ページ' }, after: { amount: 8, unitLabel: 'ページ' } }]);
  });

  it('reports the old and new minutes of an effort estimate patched in this turn', () => {
    const { state, effortId } = seeded();
    const result = turn(state, { patch: [{ kind: 'effort_estimate', targetFactId: effortId, localId: 'e2', changes: { minutes: 7,
      effortKind: null, unitCode: null, unitLabel: null, precision: null } }] } as Partial<VNextTurnDelta>, 'correct');
    expect(derive(state, result)).toEqual([{ kind: 'effort_estimate', targetTitle: '資料', effortKind: 'duration_per_unit',
      before: { minutes: 5, unitLabel: null }, after: { minutes: 7, unitLabel: null } }]);
  });

  it('reports nothing for a no-op or a turn that only adds a fact', () => {
    const { state } = seeded();
    // An unchanged restatement is a no-op: nothing is superseded, so nothing is reported.
    expect(deriveVNextAcceptedCorrections({ before: state.graph, after: state.graph, superseded: [] })).toEqual([]);
    const added = turn(state, { add: [{ kind: 'task', localId: 'other', category: 'unknown', title: '別作業' }] }, 'add');
    expect(derive(state, added)).toEqual([]);
  });

  it('does not carry an earlier correction into the next turn', () => {
    const { state, workloadId } = seeded();
    const first = turn(state, patchWorkload(workloadId, 8), 'correct');
    const added = turn(first.state, { add: [{ kind: 'task', localId: 'other', category: 'unknown', title: '別作業' }] }, 'add');
    expect(derive(first.state, added)).toEqual([]);
  });

  it('does not count one corrected fact twice', () => {
    const { state, workloadId } = seeded();
    const result = turn(state, patchWorkload(workloadId, 8), 'correct');
    const duplicated = [...result.diff.superseded, ...result.diff.superseded];
    expect(deriveVNextAcceptedCorrections({ before: state.graph, after: result.state.graph, superseded: duplicated })).toHaveLength(1);
  });

  it('reaches the renderer as typed communication, and a reply that states both values is accepted', async () => {
    const { state, workloadId } = seeded();
    const result = turn(state, patchWorkload(workloadId, 8), 'correct');
    const corrections = derive(state, result);
    const input = createWeeklyPlanningVNextRenderInput({ state: result.state, question: null, preview: null, actionId: 'a', turnId: 'correct',
      previousQuestionCode: null, userText: '残りは8ページです', recentConversation: [
        { role: 'user', content: '資料は残り12ページ、1ページ5分です' }], corrections });
    expect(input.communication.corrections).toEqual(corrections);
    const text = '資料の残りを12ページから8ページに訂正しました。';
    const request = vi.fn(async (..._args: unknown[]) => JSON.stringify({ actionId: input.actionId, actionKind: input.actionKind,
      questionCode: input.questionCode, groundingAcknowledgement: null, text }));
    const rendered = await createWeeklyPlanningStableV5DialogueRendererCore({ createChatCompletion: request }).render(input);
    expect(rendered).toMatchObject({ status: 'rendered', text });
    expect(JSON.stringify(request.mock.calls)).toContain('communication.corrections');
    const plain = createWeeklyPlanningVNextRenderInput({ state: result.state, question: null, preview: null, actionId: 'a', turnId: 'next',
      previousQuestionCode: null, userText: 'ok', recentConversation: [] });
    expect(plain.communication).not.toHaveProperty('corrections');
  });

  describe('a correction that keeps the same question open', () => {
    const asked = '資料は全体でどのくらい時間がかかりそうですか？';
    async function renderQuestion(reply: (factId: string) => { text: string; groundingAcknowledgement: unknown }) {
      const seed = turn(createEmptyWeeklyPlanningVNextState(), { add: seedFacts.slice(0, 2) }, 'seed');
      const workloadId = seed.state.graph.workloads[0].id;
      const result = turn(seed.state, patchWorkload(workloadId, 8), 'correct');
      const input = createWeeklyPlanningVNextRenderInput({ state: result.state,
        question: projectWeeklyPlanningVNext(result.state).questions[0], preview: null, actionId: 'a', turnId: 'correct',
        previousQuestionCode: 'missing_effort_estimate', userText: '残りは8ページです',
        recentConversation: [{ role: 'assistant', content: asked }], corrections: derive(seed.state, result) });
      const factId = input.currentTurnGrounding!.acceptedFacts[0].factId;
      const request = vi.fn(async (..._args: unknown[]) => JSON.stringify({ actionId: input.actionId, actionKind: input.actionKind,
        questionCode: input.questionCode, ...reply(factId) }));
      return createWeeklyPlanningStableV5DialogueRendererCore({ createChatCompletion: request }).render(input);
    }

    it('still rejects a body that repeats the previous question when the correction is only in the acknowledgement', async () => {
      const rendered = await renderQuestion(factId => ({ text: asked,
        groundingAcknowledgement: { factIds: [factId], text: '資料の残りは12ページから8ページに変更ですね。' } }));
      expect(rendered).toMatchObject({ status: 'fallback', reason: 'repeated_question_text' });
    });

    it('accepts a body that states the correction and asks the question', async () => {
      const text = '資料の残りを12ページから8ページに訂正しました。全体ではどのくらい時間がかかりそうですか？';
      const rendered = await renderQuestion(() => ({ text, groundingAcknowledgement: null }));
      expect(rendered).toMatchObject({ status: 'rendered', text });
    });
  });
});
