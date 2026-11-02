import { describe, expect, it } from 'vitest';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from '../semantic/weeklyPlanningVNextTransaction';
import { createVNextLineageResolver, withCurrentVNextReferences } from '../weeklyPlanningVNextWorkIdentity';
import type { VNextAddFact, VNextTurnContext, VNextTurnDelta, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';

const selectedWeek = { startDate: '2026-11-02', endDate: '2026-11-08' };
const emptyDelta = (): VNextTurnDelta => ({ add: [], patch: [], remove: [], relate: [], defer: [] });

function context(state: WeeklyPlanningVNextState, turnKey = `turn-${state.graph.revision}`,
  changes: Partial<VNextTurnContext> = {}): VNextTurnContext {
  return {
    turnKey,
    turnId: turnKey,
    conversationId: 'vnext-generalization',
    sourceText: 'synthetic planning test',
    acceptedDate: '2026-11-02',
    weekStartsOn: 'monday',
    planningHorizon: selectedWeek,
    defaultPlanningHorizon: selectedWeek,
    expectedRevision: state.graph.revision,
    ...changes,
  };
}

function task(localId: string, amount = 30): VNextAddFact[] {
  return [
    { kind: 'task', localId, category: 'study', title: `科目 ${localId}` },
    { kind: 'workload', localId: `${localId}-work`, taskRef: { localId }, componentRef: null,
      quantityRole: 'target', amount, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null,
      perOccurrence: false, periodExpression: null },
  ];
}

function apply(state: WeeklyPlanningVNextState, delta: Partial<VNextTurnDelta>, turnKey: string): WeeklyPlanningVNextState {
  const result = applyWeeklyPlanningVNextTurn(state, { ...emptyDelta(), ...delta }, context(state, turnKey));
  if (result.status !== 'applied') throw new Error(`Expected applied turn, received ${JSON.stringify(result)}`);
  return result.state;
}

function summary(state: WeeklyPlanningVNextState) {
  return projectWeeklyPlanningVNext(state).owners
    .map(owner => ({ task: owner.taskId, work: owner.work.map(work => [work.amount, work.minutes, work.unitCode]), status: owner.status }))
    .sort((left, right) => left.task.localeCompare(right.task));
}

describe('VNext generalization: meaning-preserving properties', () => {
  it('independent task additions produce the same projection in any input order', () => {
    const facts = [...task('a'), ...task('b', 40), ...task('c', 50)];
    const forward = apply(createEmptyWeeklyPlanningVNextState(), { add: facts }, 'order-independent');
    const reverse = apply(createEmptyWeeklyPlanningVNextState(), { add: [...facts].reverse() }, 'order-independent');

    expect(summary(forward)).toEqual(summary(reverse));
  });

  it('unrelated work leaves the existing owner and its open question unchanged', () => {
    const initial = createEmptyWeeklyPlanningVNextState();
    const withFirstTask = apply(initial, { add: task('first', 8).map((fact) =>
      fact.kind === 'workload' ? { ...fact, unitCode: 'custom', unitLabel: 'ページ' } : fact) }, 'first');
    const firstTaskId = withFirstTask.graph.tasks[0].id;
    const before = projectWeeklyPlanningVNext(withFirstTask);
    const beforeOwner = summary(withFirstTask).find(owner => owner.task === firstTaskId);
    const beforeQuestions = before.questions.filter(question => question.taskId === firstTaskId);
    expect(beforeQuestions).not.toHaveLength(0);

    const withUnrelatedTask = apply(withFirstTask, { add: task('second', 3).map((fact) =>
      fact.kind === 'workload' ? { ...fact, unitCode: 'custom', unitLabel: 'ページ' } : fact) }, 'second');
    const after = projectWeeklyPlanningVNext(withUnrelatedTask);

    expect(summary(withUnrelatedTask).find(owner => owner.task === firstTaskId)).toEqual(beforeOwner);
    expect(after.questions.filter(question => question.taskId === firstTaskId)).toEqual(beforeQuestions);
  });

  it('replay is idempotent and a rejected change returns the original state unchanged', () => {
    const initial = createEmptyWeeklyPlanningVNextState();
    const firstDelta = { ...emptyDelta(), add: task('first') };
    const first = applyWeeklyPlanningVNextTurn(initial, firstDelta, context(initial, 'first'));
    if (first.status !== 'applied') throw new Error(`Initial turn failed: ${JSON.stringify(first)}`);
    const originalJson = JSON.stringify(first.state);

    expect(applyWeeklyPlanningVNextTurn(first.state, firstDelta, context(first.state, 'first')))
      .toEqual({ status: 'duplicate', state: first.state });

    const rejected = applyWeeklyPlanningVNextTurn(first.state, { ...emptyDelta(), add: task('invalid', -1) },
      context(first.state, 'invalid'));
    expect(rejected.status).toBe('rejected');
    expect(rejected.state).toBe(first.state);
    expect(JSON.stringify(first.state)).toBe(originalJson);
  });

  it('the shared reference view is pure, idempotent, and follows a renamed task owner', () => {
    const beforeRename = apply(createEmptyWeeklyPlanningVNextState(), { add: task('first') }, 'first');
    const taskId = beforeRename.graph.tasks[0].id;
    const renamed = apply(beforeRename, { patch: [{ kind: 'task', localId: 'rename', targetFactId: taskId,
      changes: { category: null, title: '別の表示名' } }] }, 'rename');
    const storedJson = JSON.stringify(renamed);
    const resolver = createVNextLineageResolver(renamed.graph);
    const view = withCurrentVNextReferences(renamed.graph, id => resolver.leafOf(id) ?? id);

    expect(view.workloads[0].taskId).toBe(renamed.graph.tasks[1].id);
    expect(withCurrentVNextReferences(view, id => resolver.leafOf(id) ?? id)).toEqual(view);
    expect(JSON.stringify(renamed)).toBe(storedJson);
  });

  it('window patch and remove/add resolve the same Friday deadline in the final window', () => {
    const initial = apply(createEmptyWeeklyPlanningVNextState(), { add: [
      ...task('first'),
      { kind: 'planning_window', localId: 'old-window', windowKind: 'absolute',
        value: '2026-11-09/2026-11-15', start: '2026-11-09', end: '2026-11-15' },
    ] }, 'initial');
    const taskId = initial.graph.tasks[0].id;
    const oldWindowId = initial.graph.planningWindows[0].id;
    const deadline: VNextAddFact = { kind: 'temporal_constraint', localId: 'deadline',
      taskRef: { factId: taskId }, targetRef: { factId: taskId }, constraintKind: 'deadline',
      constraintLevel: 'hard', dateExpression: 'weekday:friday', namedTimePeriod: null,
      startTime: null, endTime: '13:00', precision: 'exact' };
    const oldHorizon = { planningHorizon: { startDate: '2026-11-09', endDate: '2026-11-15' } };
    const replacementWindow: VNextAddFact = { kind: 'planning_window', localId: 'new-window',
      windowKind: 'absolute', value: '2026-11-16/2026-11-22', start: '2026-11-16', end: '2026-11-22' };

    const patched = applyWeeklyPlanningVNextTurn(initial, { ...emptyDelta(), add: [deadline], patch: [
      { kind: 'planning_window', localId: 'patch-window', targetFactId: oldWindowId,
        changes: { windowKind: null, value: '2026-11-16/2026-11-22', start: '2026-11-16', end: '2026-11-22' } },
    ] }, context(initial, 'patch-window', oldHorizon));
    if (patched.status !== 'applied') throw new Error(`Window patch failed: ${JSON.stringify(patched)}`);

    const replaced = applyWeeklyPlanningVNextTurn(initial, { ...emptyDelta(), add: [deadline, replacementWindow],
      remove: [{ targetFactId: oldWindowId }] }, context(initial, 'replace-window', oldHorizon));
    if (replaced.status !== 'applied') throw new Error(`Window replacement failed: ${JSON.stringify(replaced)}`);

    expect(patched.state.graph.temporalConstraints[0].dateExpression).toBe('2026-11-20');
    expect(replaced.state.graph.temporalConstraints[0].dateExpression).toBe('2026-11-20');
  });
});
