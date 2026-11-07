import { describe, expect, it, vi } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../../services/ai/openAiCompatibleClientTypes';
import type { CalibratedChoicePolicy, CandidateChoiceRequest } from '../../application/candidateSelection';
import type { WeeklyPlanningVNextInterpretation } from '../weeklyPlanningVNextInterpretationContract';
import type { VNextAddWorkload, VNextTurnDelta } from '../weeklyPlanningVNextTypes';
import { createWeeklyPlanningVNextOptionChoiceInterpreter } from './weeklyPlanningVNextOptionChoice';
import {
  submitWeeklyPlanningVNextExperimentalTurn,
  type WeeklyPlanningVNextExperimentalPorts,
  type WeeklyPlanningVNextExperimentalScope,
} from './weeklyPlanningVNextExperimentalSession';

const scope: WeeklyPlanningVNextExperimentalScope = {
  ownerId: 'same-or-distinct-owner', weekStartDate: '2026-11-02',
  conversationId: 'same-or-distinct-conversation', notBeforeTime: '09:00',
  clock: { currentDate: '2026-11-02', planningStartDate: '2026-11-02',
    planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' },
};
const empty: VNextTurnDelta = { add: [], patch: [], remove: [], relate: [], defer: [] };
const workload = (localId: string, quantityRole: VNextAddWorkload['quantityRole'], amount: number,
  unitCode: VNextAddWorkload['unitCode'], unitLabel: string): VNextAddWorkload => ({
  kind: 'workload', localId, taskRef: { localId: 'task' }, componentRef: null,
  quantityRole, amount, unitCode, unitLabel, rangeStart: null, rangeEnd: null,
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
      probability: item.id === option.id ? 0.9 : 0.1 / (request.menu.options.length - 1) })) };
}

describe('Stage A P3: repeated work identity question (scripted, offline)', () => {
  it('changes the third presentation and binds every shown option without saving', async () => {
    for (const pageRole of ['target', 'remaining'] as const) {
      const scripts = [reading({ ...empty, add: [
        { kind: 'task', localId: 'task', category: 'study', title: '数学プリント' },
        workload('pages', pageRole, 10, 'page', '枚'), workload('minutes', 'remaining', 45, 'minute', '分'),
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
        // Observe typed presentation decisions; user text, turn IDs and history cannot change the reply.
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

      const asked = await turn(pageRole === 'target'
        ? '数学プリントを10枚やりたい。残り45分です' : '数学プリントは残り10枚、残り45分です');
      expect(asked.question?.code).toBe('same_or_distinct_work');
      expect(asked.question?.options.map(option => option.optionId)).toEqual(pageRole === 'target'
        ? ['distinct', 'same'] : ['distinct', expect.stringMatching(/^keep:/), expect.stringMatching(/^keep:/)]);
      const before = JSON.parse(raw!).vnext.state;
      const first = await turn('うーん');
      const second = await turn('まだ分からない');
      const third = await turn('そうですね');
      const presentedCheckpoint = raw!;
      expect(JSON.parse(presentedCheckpoint).vnext.unansweredQuestionStreak).toMatchObject({
        questionKey: asked.question!.key, graphRevision: asked.graphRevision, count: 3,
      });
      for (const result of [first, second, third]) {
        expect(result).toMatchObject({ outcome: 'noop', graphRevision: asked.graphRevision, preview: null });
        expect(result.question).toEqual(asked.question);
      }
      expect(first.reply).toBe(second.reply);
      expect(JSON.parse(presentedCheckpoint).vnext.state).toEqual(before);
      expect(saveCalls).toBe(0);
      const shownLabels: string[] = JSON.parse(third.reply).requiredLabels;
      const expectedLabels = pageRole === 'target'
        ? ['別々の作業として両方やる', '同じ作業としてまとめる']
        : ['別々の作業として両方やる', '10枚の方だけにする', '45分の方だけにする'];
      expect(shownLabels).toEqual(expect.arrayContaining(expectedLabels));

      // Each choice starts from the actual third presentation, without a preceding choice changing it.
      for (const option of third.question!.options) {
        raw = presentedCheckpoint;
        const fullReading = vi.fn(async () => reading(empty));
        let offered: CandidateChoiceRequest | null = null;
        const policy: CalibratedChoicePolicy = { id: 'scripted', calibrationEvidenceId: 'synthetic-test-only',
          rules: [{ menuKind: 'leaves', optionCount: third.question!.options.length + 1, depth: 0,
            minimumTopProbability: 0.8, minimumMargin: 0.5 }] };
        const interpret = createWeeklyPlanningVNextOptionChoiceInterpreter({ fullReading,
          scope: { ownerId: scope.ownerId, conversationId: scope.conversationId },
          choice: { policy, choose: async (request, beforeDispatch) => {
            beforeDispatch();
            offered = request;
            return selectedOption(request, option.optionId);
          } } });
        const answer = await turn(expectedLabels[third.question!.options.indexOf(option)], { ...ports, interpret });
        expect(offered).not.toBeNull();
        expect(new Set(offered!.menu.options.flatMap(item => item.kind === 'leaf' ? [item.candidate.label] : [])))
          .toEqual(new Set(expectedLabels));
        expect(fullReading).not.toHaveBeenCalled();
        expect(answer.outcome).toBe('applied');
        expect(answer.appliedDelta).toEqual(option.delta);
        expect(answer.question?.code).not.toBe('same_or_distinct_work');
        expect(answer.preview).toBeNull();
        const state = JSON.parse(raw!).vnext.state;
        if (option.optionId === 'distinct' || option.optionId === 'same') {
          expect(state.workRelations).toMatchObject([{ kind: option.optionId }]);
        } else {
          const activeFactIds = new Set(state.graph.factLifecycles.filter((fact: { status: string }) =>
            fact.status === 'active').map((fact: { factId: string }) => fact.factId));
          expect(state.graph.workloads.filter((fact: { id: string }) => activeFactIds.has(fact.id)))
            .toEqual(before.graph.workloads.filter((fact: { id: string }) =>
              fact.id !== option.delta.remove[0].targetFactId));
        }
        expect(saveCalls).toBe(0);
      }

      // Existing selectable options alone do not constitute a method change on the third non-answer.
      expect.soft(third.reply).not.toBe(second.reply);
    }
  });
});
