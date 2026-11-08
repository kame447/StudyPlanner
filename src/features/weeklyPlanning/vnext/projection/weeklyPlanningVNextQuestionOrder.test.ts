import { describe, expect, it } from 'vitest';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from '../semantic/weeklyPlanningVNextTransaction';
import type { VNextAddFact, VNextTurnDelta, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';
import { projectWeeklyPlanningVNext } from './weeklyPlanningVNextProjection';

// Stage B priority 4 ("do not ask what does not need confirming now"; "one question at a time"): with several works that
// each need an answer, one question is asked at a time, in the order the works were stated, an answered question never
// returns, and a deferred one is skipped without losing the others. Per-code behaviour lives in the code-specific tests.
let counter = 0;
function turn(state: WeeklyPlanningVNextState, partial: Partial<VNextTurnDelta>): WeeklyPlanningVNextState {
  counter += 1;
  const result = applyWeeklyPlanningVNextTurn(state, { add: [], patch: [], remove: [], relate: [], defer: [], ...partial }, {
    acceptedDate: '2026-11-02', weekStartsOn: 'monday', planningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' },
    defaultPlanningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' }, turnKey: `order-${counter}`,
    expectedRevision: state.graph.revision, conversationId: 'order', turnId: `order-${counter}`, sourceText: 'test utterance',
  });
  if (result.status !== 'applied') throw new Error(`${result.status}: ${JSON.stringify('errors' in result ? result.errors : [])}`);
  return result.state;
}

const TITLES = ['数学', '英語', '国語'] as const;
/** Three tasks stated in this order, each with a remaining amount and no time: each needs its own estimate. */
function threeWorksNeedingEstimates(): WeeklyPlanningVNextState {
  const add: VNextAddFact[] = TITLES.flatMap((title, index) => [
    { kind: 'task', localId: `task-${index}`, category: 'study', title } as const,
    { kind: 'workload', localId: `work-${index}`, taskRef: { localId: `task-${index}` }, componentRef: null, quantityRole: 'remaining',
      amount: 10 + index, unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null } as const,
  ]);
  return turn(createEmptyWeeklyPlanningVNextState(), { add });
}
const titleOf = (state: WeeklyPlanningVNextState, taskId: string | null) => state.graph.tasks.find(task => task.id === taskId)?.title;
/** The answer the question would take: the total time of that work, as an ordinary typed delta. */
function answerTotal(state: WeeklyPlanningVNextState, taskId: string, workloadId: string, minutes: number) {
  return turn(state, { add: [{ kind: 'effort_estimate', localId: `answer-${taskId}`, taskRef: { factId: taskId }, targetRef: { factId: workloadId },
    effortKind: 'total_duration', minutes, unitCode: null, unitLabel: null, precision: 'exact' }] });
}
const workloadOf = (state: WeeklyPlanningVNextState, taskId: string) => state.graph.workloads.find(workload => workload.taskId === taskId)!.id;

describe('several works that each need an answer', () => {
  it('lists one question per work, in the order the works were stated, with distinct keys', () => {
    const state = threeWorksNeedingEstimates();
    const projection = projectWeeklyPlanningVNext(state);
    expect(projection.readiness).toBe('needs_resolution');
    expect(projection.questions.map(question => question.code)).toEqual(['missing_effort_estimate', 'missing_effort_estimate', 'missing_effort_estimate']);
    expect(projection.questions.map(question => titleOf(state, question.taskId))).toEqual([...TITLES]);
    expect(new Set(projection.questions.map(question => question.key)).size).toBe(3);
  });

  it('asks the next work only after the current one is answered, and never asks an answered work again', () => {
    let state = threeWorksNeedingEstimates();
    const asked: string[] = [];
    for (const [index, title] of TITLES.entries()) {
      const projection = projectWeeklyPlanningVNext(state);
      expect(projection.questions).toHaveLength(TITLES.length - index);
      const current = projection.questions[0];
      expect(titleOf(state, current.taskId)).toBe(title);
      expect(asked).not.toContain(current.key);
      asked.push(current.key);
      state = answerTotal(state, current.taskId!, workloadOf(state, current.taskId!), 30 + index);
    }
    const done = projectWeeklyPlanningVNext(state);
    expect(done.questions).toEqual([]);
    expect(done.readiness).toBe('ready');
    expect(done.owners.map(owner => owner.work.map(item => item.minutes))).toEqual([[30], [31], [32]]);
  });

  it('answering a later work first leaves the earlier ones asked, in the same order', () => {
    let state = threeWorksNeedingEstimates();
    const [first, second, third] = projectWeeklyPlanningVNext(state).questions;
    state = answerTotal(state, second.taskId!, workloadOf(state, second.taskId!), 45);
    expect(projectWeeklyPlanningVNext(state).questions.map(question => question.key)).toEqual([first.key, third.key]);
  });

  it('skips a deferred question without dropping the others, and the deferred one is not asked again', () => {
    let state = threeWorksNeedingEstimates();
    const [first, second, third] = projectWeeklyPlanningVNext(state).questions;
    state = turn(state, { defer: [{ questionKey: first.key, allocation: 'none' }] });
    const projection = projectWeeklyPlanningVNext(state);
    expect(projection.questions.map(question => question.key)).toEqual([second.key, third.key]);
    expect(projection.deferredQuestions.map(question => question.key)).toEqual([first.key]);
    expect(projection.readiness).toBe('needs_resolution');
  });
});
