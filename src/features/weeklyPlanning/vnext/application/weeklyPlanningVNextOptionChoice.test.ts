import { describe, expect, it, vi } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../../services/ai/openAiCompatibleClientTypes';
import type { CalibratedChoicePolicy, CandidateChoiceRequest } from '../../application/candidateSelection';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from '../semantic/weeklyPlanningVNextTransaction';
import type {
  WeeklyPlanningVNextInterpretation,
  WeeklyPlanningVNextInterpretationInput,
} from '../weeklyPlanningVNextInterpretationContract';
import type { VNextAddFact, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';
import { createWeeklyPlanningVNextOptionChoiceInterpreter } from './weeklyPlanningVNextOptionChoice';

const pages = (localId: string, role: 'scope_total' | 'completed' | 'remaining', amount: number): VNextAddFact => ({
  kind: 'workload', localId, taskRef: { localId: 't' }, componentRef: null, quantityRole: role, amount,
  unitCode: 'page', unitLabel: '枚', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
});
function stateWith(adds: VNextAddFact[]): WeeklyPlanningVNextState {
  const result = applyWeeklyPlanningVNextTurn(createEmptyWeeklyPlanningVNextState(), { add: [
    { kind: 'task', localId: 't', category: 'study', title: '数学プリント' }, ...adds,
  ], patch: [], remove: [], relate: [], defer: [] }, {
    acceptedDate: '2026-11-02', turnKey: 'seed', expectedRevision: 0, conversationId: 'c', turnId: 'seed', sourceText: 'seed',
  });
  if (result.status !== 'applied') throw new Error(JSON.stringify(result));
  return result.state;
}
function input(state: WeeklyPlanningVNextState, userText: string): WeeklyPlanningVNextInterpretationInput {
  const projection = projectWeeklyPlanningVNext(state);
  return { client: {} as OpenAiCompatibleClient, state, projection, presentedQuestion: projection.questions[0] ?? null, userText,
    clock: { currentDate: '2026-11-02', planningStartDate: '2026-11-02', planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo' } };
}
const fullReadingResult: WeeklyPlanningVNextInterpretation = { status: 'interpreted',
  delta: { add: [], patch: [], remove: [], relate: [], defer: [] }, answer: null, metrics: { calls: 1, repairs: 0, latencyMs: 1 } };
const policy = (optionCount: number): CalibratedChoicePolicy => ({ id: 'test', calibrationEvidenceId: 'synthetic-test-only',
  rules: [{ menuKind: 'leaves', optionCount, depth: 0, minimumTopProbability: 0.8, minimumMargin: 0.5 }] });
/** The client-shaped response the gate reads (the production client maps the Worker evaluation to this). */
const menuId = (request: CandidateChoiceRequest, candidateId: string) => request.menu.options.find((option) =>
  (option.kind === 'leaf' ? option.candidate.id : option.id) === candidateId)!.id;
const response = (request: CandidateChoiceRequest, candidateId: string, sufficiency = 'only_candidate_meaning') => ({
  nodeId: request.menu.nodeId, requestId: request.requestId, selectionEpoch: request.selectionEpoch,
  candidateSetHash: request.candidateSetHash, semanticSufficiency: sufficiency, optionId: menuId(request, candidateId),
  probabilities: request.menu.options.map((option) => ({ optionId: option.id,
    probability: option.id === menuId(request, candidateId) ? 0.9 : 0.1 / (request.menu.options.length - 1) })),
});

// Stated remaining 7 against total 20 − completed 12 = 8: remaining_inconsistent with two options.
const inconsistent = () => stateWith([pages('total', 'scope_total', 20), pages('done', 'completed', 12), pages('left', 'remaining', 7)]);

describe('VNext closed-set option choice before the full reading', () => {
  it('selects one of the presented options as an option answer, without the full reading', async () => {
    const state = inconsistent();
    const fullReading = vi.fn(async () => fullReadingResult);
    let menu: string[] = [];
    const choose = vi.fn(async (request: CandidateChoiceRequest, beforeDispatch: () => void) => {
      beforeDispatch();
      menu = request.menu.options.map((option) => (option.kind === 'leaf' ? option.candidate.id : option.id));
      return response(request, 'remaining_follows_progress');
    });
    const outcomes: unknown[] = [];
    const interpret = createWeeklyPlanningVNextOptionChoiceInterpreter({ fullReading, choice: { policy: policy(3), choose },
      scope: { ownerId: 'o', conversationId: 'c' }, onOutcome: (outcome) => outcomes.push(outcome) });
    const result = await interpret(input(state, '計算どおり8枚でいいです'));
    expect(new Set(menu)).toEqual(new Set(['none', 'remaining_follows_progress', 'completed_follows_remaining']));
    expect(outcomes).toEqual([{ route: 'option_choice', optionId: 'remaining_follows_progress' }]);
    expect(input(state, '').presentedQuestion?.code).toBe('remaining_inconsistent');
    expect(result).toMatchObject({ status: 'interpreted', answer: { kind: 'option', optionId: 'remaining_follows_progress' },
      delta: { add: [], patch: [], remove: [] }, metrics: { calls: 1 } });
    expect(fullReading).not.toHaveBeenCalled();
  });

  it.each([
    ['none', (request: CandidateChoiceRequest) => response(request, 'none')],
    ['extra_meaning', (request: CandidateChoiceRequest) => response(request, 'remaining_follows_progress', 'extra_or_uncertain_meaning')],
    ['provider_error', () => { throw new Error('timeout'); }],
  ])('sends the whole utterance to the full reading on %s', async (reason, reply) => {
    const state = inconsistent();
    const fullReading = vi.fn(async () => fullReadingResult);
    const outcomes: unknown[] = [];
    const interpret = createWeeklyPlanningVNextOptionChoiceInterpreter({ fullReading, scope: { ownerId: 'o', conversationId: 'c' },
      onOutcome: (outcome) => outcomes.push(outcome),
      choice: { policy: policy(3), choose: async (request, beforeDispatch) => { beforeDispatch(); return reply(request); } } });
    const utterance = '8枚でいいです。あと英語の音読も30分やりたい';
    const result = await interpret(input(state, utterance));
    expect(fullReading).toHaveBeenCalledWith(expect.objectContaining({ userText: utterance }));
    expect(result).toMatchObject({ answer: null, metrics: { calls: 2 } });
    expect(outcomes).toEqual([{ route: 'full_reading', reason }]);
  });

  it('never dispatches for an uncalibrated menu or an open-value question', async () => {
    const choose = vi.fn();
    const fullReading = vi.fn(async () => fullReadingResult);
    const uncalibrated = createWeeklyPlanningVNextOptionChoiceInterpreter({ fullReading, choice: { policy: policy(5), choose },
      scope: { ownerId: 'o', conversationId: 'c' } });
    await uncalibrated(input(inconsistent(), '8枚で'));
    // missing_effort_estimate asks for an open value: always the full reading.
    const open = stateWith([pages('left', 'remaining', 8)]);
    expect(input(open, '').presentedQuestion?.code).toBe('missing_effort_estimate');
    await uncalibrated(input(open, '40分'));
    expect(choose).not.toHaveBeenCalled();
    expect(fullReading).toHaveBeenCalledTimes(2);
  });
});
