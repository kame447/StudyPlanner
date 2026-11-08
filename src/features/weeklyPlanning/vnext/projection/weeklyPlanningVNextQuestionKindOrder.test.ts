import { describe, expect, it } from 'vitest';
import type { VNextAddFact, VNextAddWorkload, VNextTurnDelta, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from '../semantic/weeklyPlanningVNextTransaction';
import { projectWeeklyPlanningVNext } from './weeklyPlanningVNextProjection';

// Priority 5 (whole picture first): the question asked first is about what work there is and how much, before how long one
// piece takes. Only the order changes: the same questions, task order within each kind, nothing added or removed.
const horizon = { startDate: '2026-11-02', endDate: '2026-11-08' };
const empty = (): VNextTurnDelta => ({ add: [], patch: [], remove: [], relate: [], defer: [] });
const task = (localId: string, title: string): VNextAddFact => ({ kind: 'task', localId, category: 'study', title });
const remaining = (localId: string, taskLocalId: string, amount: number, quantityRole: VNextAddWorkload['quantityRole'] = 'remaining'): VNextAddWorkload => ({ kind: 'workload',
  localId, taskRef: { localId: taskLocalId }, componentRef: null, quantityRole, amount, unitCode: 'custom', unitLabel: 'ページ', rangeStart: null, rangeEnd: null,
  perOccurrence: false, periodExpression: null });
function apply(delta: VNextTurnDelta, state = createEmptyWeeklyPlanningVNextState()): WeeklyPlanningVNextState {
  const result = applyWeeklyPlanningVNextTurn(state, delta, { expectedRevision: state.graph.revision, acceptedDate: '2026-11-02', weekStartsOn: 'monday',
    planningHorizon: horizon, defaultPlanningHorizon: horizon, conversationId: 'c', turnKey: `t${state.graph.revision}`, turnId: `t${state.graph.revision}`, sourceText: 'synthetic' });
  if (result.status !== 'applied' && result.status !== 'noop') throw new Error(JSON.stringify(result));
  return result.state;
}
const asked = (state: WeeklyPlanningVNextState) => {
  const projection = projectWeeklyPlanningVNext(state);
  return projection.questions.map(question => [question.code, state.graph.tasks.find(item => item.id === question.taskId)?.title]);
};

describe('the question asked first grasps the whole picture before a detail (Stage B priority 5)', () => {
  it('asks how much of a task with no quantity before the minutes of an earlier task', () => {
    const state = apply({ ...empty(), add: [task('a', '数学'), remaining('wa', 'a', 8), task('b', '英語'), task('c', '物理'), remaining('wc', 'c', 5)] });
    expect(asked(state)).toEqual([['missing_schedulable_work', '英語'], ['missing_effort_estimate', '数学'], ['missing_effort_estimate', '物理']]);
  });

  it('keeps the same order when the task with no quantity was stated first', () => {
    const state = apply({ ...empty(), add: [task('b', '英語'), task('a', '数学'), remaining('wa', 'a', 8)] });
    expect(asked(state)).toEqual([['missing_schedulable_work', '英語'], ['missing_effort_estimate', '数学']]);
  });

  it('keeps task order among questions of the same kind', () => {
    const state = apply({ ...empty(), add: [task('a', '数学'), remaining('wa', 'a', 8), task('c', '物理'), remaining('wc', 'c', 5)] });
    expect(asked(state)).toEqual([['missing_effort_estimate', '数学'], ['missing_effort_estimate', '物理']]);
  });

  it('keeps a structural question about a stated quantity ahead of a detail, whatever the task order', () => {
    const state = apply({ ...empty(), add: [task('a', '数学'), remaining('wa', 'a', 8), task('b', '英語'),
      remaining('x', 'b', 20, 'scope_total'), remaining('y', 'b', 20, 'scope_total')] });
    expect(asked(state)[0]).toEqual(['duplicate_quantity', '英語']);
    expect(asked(state).map(([code]) => code)).toEqual(['duplicate_quantity', 'missing_effort_estimate']);
  });

  it('asks the same set of questions as before: only the order differs', () => {
    const state = apply({ ...empty(), add: [task('a', '数学'), remaining('wa', 'a', 8), task('b', '英語'), task('c', '物理'), remaining('wc', 'c', 5)] });
    const projection = projectWeeklyPlanningVNext(state);
    expect([...projection.questions.map(question => question.key)].sort()).toEqual(
      [...projection.owners.flatMap(owner => owner.question ? [owner.question.key] : [])].sort());
  });
});
