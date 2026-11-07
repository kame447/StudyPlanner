import { describe, expect, it, vi } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../../services/ai/openAiCompatibleClientTypes';
import type { CalibratedChoicePolicy, CandidateChoiceRequest } from '../../application/candidateSelection';
import type { WeeklyPlanningVNextInterpretation } from '../weeklyPlanningVNextInterpretationContract';
import type { VNextAddFact, VNextTurnDelta } from '../weeklyPlanningVNextTypes';
import { createWeeklyPlanningVNextOptionChoiceInterpreter } from './weeklyPlanningVNextOptionChoice';
import {
  submitWeeklyPlanningVNextExperimentalTurn,
  type WeeklyPlanningVNextExperimentalPorts,
  type WeeklyPlanningVNextExperimentalScope,
} from './weeklyPlanningVNextExperimentalSession';

const scope: WeeklyPlanningVNextExperimentalScope = {
  ownerId: 'remaining-inconsistent-owner', weekStartDate: '2026-11-02',
  conversationId: 'remaining-inconsistent-conversation', notBeforeTime: '09:00',
  clock: { currentDate: '2026-11-02', planningStartDate: '2026-11-02',
    planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' },
};
const empty: VNextTurnDelta = { add: [], patch: [], remove: [], relate: [], defer: [] };
const pages = (localId: string, quantityRole: 'scope_total' | 'completed' | 'remaining', amount: number): VNextAddFact => ({
  kind: 'workload', localId, taskRef: { localId: 'task' }, componentRef: null,
  quantityRole, amount, unitCode: 'page', unitLabel: '枚', rangeStart: null, rangeEnd: null,
  perOccurrence: false, periodExpression: null,
});
const reading = (delta: VNextTurnDelta): WeeklyPlanningVNextInterpretation => ({
  status: 'interpreted', planningIntent: 'discuss', delta, answer: null,
  metrics: { calls: 1, repairs: 0, latencyMs: 1 },
});
const optionIdOf = (option: CandidateChoiceRequest['menu']['options'][number]) =>
  option.kind === 'leaf' ? String(option.candidate.tuple.optionId) : option.id;
function selectedOption(request: CandidateChoiceRequest, selected: string) {
  const option = request.menu.options.find(item => optionIdOf(item) === selected)!;
  return { nodeId: request.menu.nodeId, requestId: request.requestId,
    selectionEpoch: request.selectionEpoch, candidateSetHash: request.candidateSetHash,
    semanticSufficiency: 'only_candidate_meaning', optionId: option.id,
    probabilities: request.menu.options.map(item => ({ optionId: item.id,
      probability: item.id === option.id ? 0.9 : 0.05 })) };
}

describe('Stage A P3: repeated remaining inconsistency (scripted, offline)', () => {
  it('changes the third presentation, then binds the shown choice without saving', async () => {
    const scripts = [reading({ ...empty, add: [
      { kind: 'task', localId: 'task', category: 'study', title: '数学プリント' },
      pages('total', 'scope_total', 20), pages('done', 'completed', 12), pages('left', 'remaining', 7),
    ] }), reading(empty), reading(empty), reading(empty)];
    let raw: string | null = null;
    let saveCalls = 0;
    const ports: WeeklyPlanningVNextExperimentalPorts = {
      client: {} as OpenAiCompatibleClient,
      interpret: async () => {
        const next = scripts.shift();
        if (!next) throw new Error('script exhausted');
        return next;
      },
      checkpoint: { read: () => raw, write: value => { raw = value; } },
      legacyV5Checkpoint: { read: () => null },
      approvalLedger: { read: () => null, write: () => { throw new Error('unexpected approval write'); } },
      plans: { findExistingPlanId: async () => undefined, saveBlock: async () => {
        saveCalls += 1;
        throw new Error('unexpected plan save');
      } },
      calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
      now: () => '2026-11-02T09:00:00.000Z',
      // Echo typed presentation decisions, excluding user text, turn ID and conversation history.
      createRenderer: () => ({ render: async input => ({ status: 'rendered', rawResponse: '',
        text: JSON.stringify({ goal: input.communication?.goal ?? null, actionKind: input.actionKind,
          questionCode: input.questionCode, questionIntent: input.questionIntent,
          requiredLabels: input.requiredLabels, previewCount: input.previewCount }) }) }),
    };
    let turnNumber = 0;
    const turn = (userText: string, selectedPorts = ports) => submitWeeklyPlanningVNextExperimentalTurn({
      scope, ports: selectedPorts, turnId: `turn-${++turnNumber}`, userText,
      shownRevision: raw === null ? null : (JSON.parse(raw).vnext.presentedQuestion?.graphRevision ?? null),
    });

    const asked = await turn('数学プリントは全体20枚、12枚終わって残り7枚');
    expect(asked.question).toMatchObject({ code: 'remaining_inconsistent',
      options: [{ optionId: 'remaining_follows_progress' }, { optionId: 'completed_follows_remaining' }] });
    const before = JSON.parse(raw!).vnext.state;
    const first = await turn('うーん');
    const second = await turn('まだ分からない');
    const third = await turn('そうですね');
    expect(JSON.parse(raw!).vnext.unansweredQuestionStreak).toMatchObject({
      questionKey: asked.question!.key, graphRevision: asked.graphRevision, count: 3,
    });
    expect(first.question?.key).toBe(asked.question!.key);
    expect(second.question?.key).toBe(asked.question!.key);
    expect(third.question?.key).toBe(asked.question!.key);
    expect(first.reply).toBe(second.reply);
    expect(third.question?.options.map(option => option.optionId)).toEqual([
      'remaining_follows_progress', 'completed_follows_remaining',
    ]);
    expect(third.preview).toBeNull();
    expect(JSON.parse(raw!).vnext.state).toEqual(before);
    expect(saveCalls).toBe(0);

    const fullReading = vi.fn(async () => reading(empty));
    let offered: CandidateChoiceRequest | null = null;
    const policy: CalibratedChoicePolicy = { id: 'scripted', calibrationEvidenceId: 'synthetic-test-only',
      rules: [{ menuKind: 'leaves', optionCount: 3, depth: 0, minimumTopProbability: 0.8, minimumMargin: 0.5 }] };
    const interpret = createWeeklyPlanningVNextOptionChoiceInterpreter({ fullReading,
      scope: { ownerId: scope.ownerId, conversationId: scope.conversationId },
      choice: { policy, choose: async (request, beforeDispatch) => {
        beforeDispatch();
        offered = request;
        return selectedOption(request, 'remaining_follows_progress');
      } } });
    const answer = await turn('残りを8枚にする', { ...ports, interpret });
    expect(offered).not.toBeNull();
    expect(new Set(offered!.menu.options.flatMap(option => option.kind === 'leaf' ? [option.candidate.label] : [])))
      .toEqual(new Set(['残りを8枚にする', '終わった量を13枚にする']));
    expect(fullReading).not.toHaveBeenCalled();
    expect(answer).toMatchObject({ outcome: 'applied',
      appliedDelta: { patch: [{ targetFactId: expect.any(String), changes: { amount: 8 } }] } });
    expect(answer.question?.code).not.toBe('remaining_inconsistent');
    const graph = JSON.parse(raw!).vnext.state.graph;
    const activeFactIds = new Set(graph.factLifecycles.filter((fact: { status: string }) =>
      fact.status === 'active').map((fact: { factId: string }) => fact.factId));
    expect(graph.workloads.find((workload: { id: string; quantityRole: string }) =>
      workload.quantityRole === 'remaining' && activeFactIds.has(workload.id))).toMatchObject({ amount: 8 });
    expect(saveCalls).toBe(0);

    // Existing options are actionable; repeating their unchanged presentation on turn three is not a new method.
    expect(third.reply).not.toBe(second.reply);
  });
});
