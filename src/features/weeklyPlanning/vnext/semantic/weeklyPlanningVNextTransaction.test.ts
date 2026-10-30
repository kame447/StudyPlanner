import { describe, expect, it } from 'vitest';
import type { VNextAddFact, VNextPatch, VNextTurnDelta, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';
import { vnextLineageIdByFactId } from '../weeklyPlanningVNextWorkIdentity';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from './weeklyPlanningVNextTransaction';

const delta = (parts: Partial<VNextTurnDelta> = {}): VNextTurnDelta => ({ add: [], patch: [], remove: [], relate: [], defer: [], ...parts });
const task: VNextAddFact = { kind: 'task', localId: 't', category: 'study', title: 'Math' };
const workload = (localId: string, amount: number, role: 'scope_total' | 'completed' | 'remaining' | 'target' = 'remaining'): VNextAddFact => ({
  kind: 'workload', localId, taskRef: { localId: 't' }, componentRef: null,
  quantityRole: role, amount, unitCode: 'custom', unitLabel: '枚',
  rangeStart: '1', rangeEnd: '20', perOccurrence: true, periodExpression: 'this_week',
});
const effort = (target: string, minutes: number): VNextAddFact => ({ kind: 'effort_estimate', localId: 'e',
  taskRef: { localId: 't' }, targetRef: { localId: target }, effortKind: 'total_duration',
  minutes, unitCode: null, unitLabel: null, precision: 'exact' });
const workloadChanges = (amount: number | null) => ({ amount, unitCode: null, unitLabel: null,
  quantityRole: null, rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null });
function turn(state: WeeklyPlanningVNextState, changes: VNextTurnDelta, key = `turn-${state.graph.revision}`) {
  return applyWeeklyPlanningVNextTurn(state, changes, { expectedRevision: state.graph.revision,
    acceptedDate: '2026-11-02', turnKey: key, conversationId: 'c', turnId: key, sourceText: 'user evidence' });
}
function applied(state: WeeklyPlanningVNextState, changes: VNextTurnDelta): WeeklyPlanningVNextState {
  const result = turn(state, changes);
  expect(result.status, JSON.stringify(result)).toBe('applied');
  if (result.status !== 'applied') throw new Error(JSON.stringify(result));
  return result.state;
}
function setup(withEffort = true): WeeklyPlanningVNextState {
  return applied(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, workload('r', 7), ...(withEffort ? [effort('r', 45)] : [])] }));
}
function amountPatch(state: WeeklyPlanningVNextState, amount: number): Extract<VNextPatch, { kind: 'workload' }> {
  return { kind: 'workload', localId: 'fix-r', targetFactId: state.graph.workloads[0].id,
    changes: workloadChanges(amount), amountDelta: null };
}
const activeWorkloads = (state: WeeklyPlanningVNextState) => state.graph.workloads.filter(fact =>
  state.graph.factLifecycles.some(entry => entry.factId === fact.id && entry.status === 'active'));
const activeEfforts = (state: WeeklyPlanningVNextState) => state.graph.effortEstimates.filter(fact =>
  state.graph.factLifecycles.some(entry => entry.factId === fact.id && entry.status === 'active'));

describe('experimental VNext typed transaction', () => {
  it('value-only R7→R8 keeps custom unit, range, recurrence period and original state', () => {
    const original = setup();
    const snapshot = structuredClone(original);
    const next = applied(original, delta({ patch: [amountPatch(original, 8)] }));
    expect(original).toEqual(snapshot);
    expect(activeWorkloads(next)[0]).toMatchObject({ amount: 8, unitCode: 'custom', unitLabel: '枚',
      rangeStart: '1', rangeEnd: '20', perOccurrence: true, periodExpression: 'this_week' });
    const roots = vnextLineageIdByFactId(next.graph);
    expect(roots.get(activeWorkloads(next)[0].id)).toBe(original.graph.workloads[0].id);
    expect(activeEfforts(next)[0].workBinding?.boundAmount).toBe(7);
  });

  it('C12 and explicit R8 remain independent stated facts, without persisting derived remaining', () => {
    const state = applied(createEmptyWeeklyPlanningVNextState(), delta({ add: [task,
      workload('total', 20, 'scope_total'), workload('c', 10, 'completed'), workload('r', 8)] }));
    const completed = state.graph.workloads.find(fact => fact.quantityRole === 'completed')!;
    const next = applied(state, delta({ patch: [{ ...amountPatch(state, 12), targetFactId: completed.id }] }));
    expect(activeWorkloads(next).map(fact => [fact.quantityRole, fact.amount])).toEqual([
      ['scope_total', 20], ['remaining', 8], ['completed', 12],
    ]);
  });

  it.each([false, true])('binds same-turn R8+E60 to final quantity regardless of patch order (%s)', reverse => {
    const state = setup();
    const patches: VNextPatch[] = [amountPatch(state, 8), { kind: 'effort_estimate', localId: 'fix-e',
      targetFactId: state.graph.effortEstimates[0].id,
      changes: { minutes: 60, effortKind: null, unitCode: null, unitLabel: null, precision: null } }];
    const next = applied(state, delta({ patch: reverse ? patches.reverse() : patches }));
    expect(activeWorkloads(next)[0].amount).toBe(8);
    expect(activeEfforts(next)[0]).toMatchObject({ minutes: 60,
      workBinding: { workLineageId: state.graph.workloads[0].id, boundAmount: 8 } });
  });

  it('binds a new estimate to final derived remaining after C12 correction', () => {
    const state = applied(createEmptyWeeklyPlanningVNextState(), delta({ add: [task,
      workload('total', 20, 'scope_total'), workload('c', 10, 'completed')] }));
    const next = applied(state, delta({ add: [{ ...effort('total', 60), taskRef: { factId: state.graph.tasks[0].id },
      targetRef: { factId: state.graph.workloads[0].id } } as VNextAddFact],
    patch: [{ ...amountPatch(state, 12), targetFactId: state.graph.workloads[1].id }] }));
    expect(activeEfforts(next)[0].workBinding?.boundAmount).toBe(8);
    expect(activeWorkloads(next)).toHaveLength(2);
  });

  it('adds amountDelta mathematically and rejects absolute amount combined with increment', () => {
    const state = setup(false);
    const patch = { ...amountPatch(state, 8), changes: workloadChanges(null), amountDelta: 3 };
    const next = applied(state, delta({ patch: [patch] }));
    expect(activeWorkloads(next)[0].amount).toBe(10);
    expect(turn(state, delta({ patch: [{ ...patch, changes: workloadChanges(8) }] })).status).toBe('rejected');
  });

  it('preserves independent clauses in a correction turn', () => {
    const state = setup(false);
    const next = applied(state, delta({ patch: [amountPatch(state, 8)],
      add: [{ ...task, localId: 'independent', title: 'English' }] }));
    expect(next.graph.tasks.map(fact => fact.title)).toEqual(['Math', 'English']);
    expect(activeWorkloads(next)[0].amount).toBe(8);
  });

  it('permits explicit custom-unit change without rewriting period or range', () => {
    const state = setup(false);
    const next = applied(state, delta({ patch: [{ ...amountPatch(state, 8), changes: {
      ...workloadChanges(null), unitLabel: 'セット',
    } }] }));
    expect(activeWorkloads(next)[0]).toMatchObject({ amount: 7, unitLabel: 'セット', periodExpression: 'this_week', rangeEnd: '20' });
  });

  it('rejects an ownership field and returns an addressable error without committing any clause', () => {
    const state = setup(false);
    const malformed = { ...amountPatch(state, 8), changes: { ...workloadChanges(8), taskId: 'foreign' } } as unknown as VNextPatch;
    const result = turn(state, delta({ patch: [malformed], add: [{ ...task, localId: 'other' }] }));
    expect(result.status).toBe('rejected');
    expect(result.state).toBe(state);
    if (result.status === 'rejected') expect(result.errors).toContainEqual(expect.objectContaining({ path: 'patch[0].changes.taskId' }));
  });

  it('rejects stale revision, terminal target and unknown target', () => {
    const state = setup(false);
    const changes = delta({ patch: [amountPatch(state, 8)] });
    const stale = applyWeeklyPlanningVNextTurn(state, changes, { expectedRevision: 0, acceptedDate: '2026-11-02', turnKey: 'stale', conversationId: 'c', turnId: 't', sourceText: 'evidence' });
    expect(stale.status).toBe('rejected');
    const next = applied(state, changes);
    expect(turn(next, changes).status).toBe('rejected');
    expect(turn(state, delta({ patch: [{ ...amountPatch(state, 8), targetFactId: 'missing' }] })).state).toBe(state);
  });

  it('replaying an applied key is duplicate even with its old expected revision', () => {
    const state = setup(false);
    const changes = delta({ patch: [amountPatch(state, 8)] });
    const result = turn(state, changes, 'replay');
    expect(result.status).toBe('applied');
    const replay = applyWeeklyPlanningVNextTurn(result.state, changes, { expectedRevision: state.graph.revision,
      acceptedDate: '2026-11-02', turnKey: 'replay', conversationId: 'c', turnId: 'replay', sourceText: 'evidence' });
    expect(replay.status).toBe('duplicate');
    expect(replay.state).toBe(result.state);
  });

  it('no-op patch preserves revision and graph identity', () => {
    const state = setup();
    const result = turn(state, delta({ patch: [amountPatch(state, 7)] }));
    expect(result.status).toBe('noop');
    expect(result.state).toBe(state);
  });

  it('no-op total estimate is unchanged, but restated minutes bind to a same-turn new quantity', () => {
    const state = setup();
    const patch: VNextPatch = { kind: 'effort_estimate', localId: 'restated', targetFactId: state.graph.effortEstimates[0].id,
      changes: { minutes: 45, effortKind: null, unitCode: null, unitLabel: null, precision: null } };
    const noop = turn(state, delta({ patch: [patch] }));
    expect(noop.status).toBe('noop');
    expect(noop.state).toBe(state);
    const next = applied(state, delta({ patch: [patch, amountPatch(state, 8)] }));
    expect(activeEfforts(next)[0]).toMatchObject({ minutes: 45, workBinding: { boundAmount: 8 } });
  });

  it('rejects missing effort or temporal values with the exact semantic field and local ID', () => {
    const state = setup();
    const bad = { kind: 'effort_estimate', localId: 'bad-e', targetFactId: state.graph.effortEstimates[0].id,
      changes: { minutes: 60, effortKind: 'invented', unitCode: null, unitLabel: null, precision: null } } as unknown as VNextPatch;
    const result = turn(state, delta({ patch: [bad] }));
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.errors).toContainEqual(expect.objectContaining({
      path: 'patch[0].changes.effortKind', localId: 'bad-e',
    }));
  });

  it('patches task category/title and component label while preserving dependent identity references', () => {
    const state = applied(createEmptyWeeklyPlanningVNextState(), delta({ add: [task,
      { kind: 'component', localId: 'book', taskRef: { localId: 't' }, parentComponentRef: null, role: 'material', label: 'Book' },
      { ...workload('r', 8), componentRef: { localId: 'book' } } as VNextAddFact] }));
    const taskId = state.graph.tasks[0].id, componentId = state.graph.components[0].id;
    const next = applied(state, delta({ patch: [
      { kind: 'task', localId: 'task-correction', targetFactId: taskId, changes: { category: 'non_study', title: 'Errand' } },
      { kind: 'component', localId: 'component-correction', targetFactId: componentId, changes: { role: null, label: 'New book' } },
    ] }));
    expect(activeWorkloads(next)[0]).toMatchObject({ taskId, componentId });
    expect(next.graph.tasks[next.graph.tasks.length - 1]).toMatchObject({ category: 'non_study', title: 'Errand' });
    expect(next.graph.components[next.graph.components.length - 1]).toMatchObject({ label: 'New book' });
    expect(vnextLineageIdByFactId(next.graph).get(next.graph.tasks[next.graph.tasks.length - 1].id)).toBe(taskId);
  });

  it('places a deadline time as its end: 13:00 as endTime is kept, as startTime it is rejected naming both clock fields (#881 B)', () => {
    const deadline = (startTime: string | null, endTime: string | null) => ({ kind: 'temporal_constraint' as const, localId: 'due',
      taskRef: { localId: 't' }, targetRef: { localId: 't' }, constraintKind: 'deadline' as const, constraintLevel: 'hard' as const,
      dateExpression: '2026-08-27', namedTimePeriod: null, startTime, endTime, precision: 'exact' as const });
    const kept = applied(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, deadline(null, '13:00')] }));
    expect(kept.graph.temporalConstraints[0]).toMatchObject({ kind: 'deadline', startTime: null, endTime: '13:00' });
    const misplaced = turn(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, deadline('13:00', null)] }));
    // Both clock fields are addressed: moving 13:00 changes both, so a repair cannot drop the stated time.
    expect(misplaced).toMatchObject({ status: 'rejected', errors: [
      expect.objectContaining({ path: 'add[1].startTime', localId: 'due' }),
      expect.objectContaining({ path: 'add[1].endTime', localId: 'due' }),
    ] });
    // A patch that moves an end time into the start of a stated deadline is rejected the same way.
    const moved = turn(kept, delta({ patch: [{ kind: 'temporal_constraint', localId: 'move', targetFactId: kept.graph.temporalConstraints[0].id,
      changes: { constraintKind: null, constraintLevel: null, dateExpression: null, namedTimePeriod: null, startTime: '13:00', endTime: null, precision: null } }] }));
    expect(moved).toMatchObject({ status: 'rejected', errors: [
      expect.objectContaining({ path: 'patch[0].changes.startTime', localId: 'move' }),
      expect.objectContaining({ path: 'patch[0].changes.endTime', localId: 'move' }),
    ] });
  });

  it('fixes a relative date to the accepting turn, so it does not move on a later day (#918)', () => {
    const due = (dateExpression: string) => ({ kind: 'temporal_constraint' as const, localId: 'due', taskRef: { localId: 't' },
      targetRef: { localId: 't' }, constraintKind: 'deadline' as const, constraintLevel: 'hard' as const, dateExpression,
      namedTimePeriod: null, startTime: null, endTime: '13:00', precision: 'exact' as const });
    const context = (acceptedDate: string) => ({ acceptedDate, turnKey: acceptedDate, expectedRevision: 0,
      conversationId: 'c', turnId: 't', sourceText: '締切は明日の13時' });
    const accepted = applyWeeklyPlanningVNextTurn(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, due('tomorrow')] }), context('2026-08-26'));
    expect(accepted.status === 'applied' && accepted.state.graph.temporalConstraints[0].dateExpression).toBe('2026-08-27');
    const week = applyWeeklyPlanningVNextTurn(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, due('this_week')] }), context('2026-08-26'));
    expect(week.status === 'applied' && week.state.graph.temporalConstraints[0].dateExpression).toBe('2026-08-24/2026-08-30');
    // Absolute dates are kept as stated; an unresolvable expression is rejected at that field, not guessed.
    const absolute = applyWeeklyPlanningVNextTurn(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, due('2026-09-07')] }), context('2026-08-26'));
    expect(absolute.status === 'applied' && absolute.state.graph.temporalConstraints[0].dateExpression).toBe('2026-09-07');
    expect(applyWeeklyPlanningVNextTurn(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, due('someday')] }), context('2026-08-26')))
      .toMatchObject({ status: 'rejected', errors: [expect.objectContaining({ path: 'add[1].dateExpression', localId: 'due' })] });
  });

  it('requires a rate stated about one workload to be in that work\'s unit (run 41004723952 native-multiturn-rate)', () => {
    const work = { ...workload('w', 7), unitCode: 'page' as const, unitLabel: '枚' };
    const rate = (unitCode: 'page' | 'custom') => ({ kind: 'effort_estimate' as const, localId: 'rate', taskRef: { localId: 't' },
      targetRef: { localId: 'w' }, effortKind: 'duration_per_unit' as const, minutes: 5, unitCode, unitLabel: '枚', precision: 'exact' as const });
    expect(turn(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, work, rate('page')] })).status).toBe('applied');
    expect(turn(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, work, rate('custom')] }))).toMatchObject({ status: 'rejected', errors: [
      expect.objectContaining({ path: 'add[2].unitCode', localId: 'rate' }), expect.objectContaining({ path: 'add[2].unitLabel', localId: 'rate' })] });
    // An owner-wide rate (about the task) is not tied to one work's unit.
    expect(turn(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, work, { ...rate('custom'), targetRef: { localId: 't' } }] })).status).toBe('applied');
  });

  it('corrects quantity and deadline independently in the same turn', () => {
    const state = applied(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, workload('r', 7),
      { kind: 'temporal_constraint', localId: 'deadline', taskRef: { localId: 't' }, targetRef: { localId: 't' },
        constraintKind: 'deadline', constraintLevel: 'hard', dateExpression: '2026-11-01', namedTimePeriod: null,
        startTime: null, endTime: null, precision: 'exact' }] }));
    const next = applied(state, delta({ patch: [amountPatch(state, 8), { kind: 'temporal_constraint', localId: 'deadline-fix',
      targetFactId: state.graph.temporalConstraints[0].id, changes: { constraintKind: null, constraintLevel: null,
        dateExpression: '2026-11-02', namedTimePeriod: null, startTime: null, endTime: null, precision: null } }] }));
    expect(activeWorkloads(next)[0].amount).toBe(8);
    expect(next.graph.temporalConstraints[next.graph.temporalConstraints.length - 1].dateExpression).toBe('2026-11-02');
  });

  it('ends estimates that measure only the removed work in the same visible diff, and keeps owner-wide ones', () => {
    const state = applied(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, workload('r', 7),
      { ...effort('r', 3), localId: 'rate-on-work', effortKind: 'duration_per_unit', unitCode: 'custom', unitLabel: '枚' } as VNextAddFact,
      { ...effort('r', 4), localId: 'rate-on-task', targetRef: { localId: 't' }, effortKind: 'duration_per_unit', unitCode: 'custom', unitLabel: '枚' } as VNextAddFact] }));
    const [onWork, onTask] = state.graph.effortEstimates;
    const result = turn(state, delta({ remove: [{ targetFactId: state.graph.workloads[0].id }] }));
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.diff.removed.map(entry => entry.id)).toEqual([state.graph.workloads[0].id, onWork.id]);
    const active = new Set(result.state.graph.factLifecycles.filter(entry => entry.status === 'active').map(entry => entry.factId));
    expect(active.has(onTask.id)).toBe(true);
  });

  it('keeps the dependency guard addressable when a carried uncertainty targets a cascaded total', () => {
    const state = setup();
    state.graph.uncertainties.push({ id: 'uncertainty', targetFactId: state.graph.effortEstimates[0].id,
      field: 'precision', reason: 'unspecified', source: state.graph.tasks[0].source, createdRevision: 1 });
    state.graph.factLifecycles.push({ factId: 'uncertainty', status: 'active', createdRevision: 1,
      terminalRevision: null, supersededByFactId: null });
    const result = turn(state, delta({ remove: [{ targetFactId: state.graph.workloads[0].id }] }));
    expect(result.status).toBe('rejected');
    expect(result.state).toBe(state);
    if (result.status === 'rejected') expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'active_dependents', path: 'remove[0].targetFactId', factId: state.graph.effortEstimates[0].id,
    }));
  });

  it.each([false, true])('explicitly removing a bound total with its workload has one diff per fact (%s)', reverse => {
    const state = setup();
    const remove = [{ targetFactId: state.graph.workloads[0].id }, { targetFactId: state.graph.effortEstimates[0].id }];
    const result = turn(state, delta({ remove: reverse ? remove.reverse() : remove }));
    expect(result.status).toBe('applied');
    if (result.status === 'applied') expect(new Set(result.diff.removed.map(fact => fact.id)).size).toBe(result.diff.removed.length);
  });

  it('rejects cross-task refs with input paths instead of graph implementation paths', () => {
    const result = turn(createEmptyWeeklyPlanningVNextState(), delta({ add: [task,
      { ...task, localId: 'other' },
      { kind: 'component', localId: 'component', taskRef: { localId: 'other' }, parentComponentRef: null, role: 'material', label: 'Other task book' },
      { ...workload('r', 8), componentRef: { localId: 'component' } } as VNextAddFact] }));
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.errors).toContainEqual(expect.objectContaining({
      path: 'add[3].componentRef:task-mismatch', localId: 'r',
    }));
  });

  it.each([NaN, Infinity, -1])('rejects invalid amount %s atomically after merging changes', amount => {
    const state = setup();
    const result = turn(state, delta({ patch: [amountPatch(state, amount)] }));
    expect(result.status).toBe('rejected');
    expect(result.state).toBe(state);
    if (result.status === 'rejected') expect(result.errors).toContainEqual(expect.objectContaining({
      path: 'patch[0].changes.amount', localId: 'fix-r',
    }));
  });

  it('removes only bound workload totals, preserving task totals and separate workloads', () => {
    const state = setup();
    const taskId = state.graph.tasks[0].id;
    const withIndependent = applied(state, delta({ add: [
      { ...workload('other', 9), taskRef: { factId: taskId } } as VNextAddFact,
      { ...effort('unused', 90), localId: 'taskTotal', taskRef: { factId: taskId }, targetRef: { factId: taskId } } as VNextAddFact,
    ] }));
    const next = applied(withIndependent, delta({ remove: [{ targetFactId: state.graph.workloads[0].id }] }));
    expect(activeWorkloads(next)).toHaveLength(1);
    expect(activeEfforts(next).map(fact => fact.minutes)).toEqual([90]);
  });

  it('delete and readd creates a new lineage and cannot inherit an old total', () => {
    const state = setup();
    const next = applied(state, delta({ remove: [{ targetFactId: state.graph.workloads[0].id }],
      add: [{ ...workload('readded', 7), taskRef: { factId: state.graph.tasks[0].id } } as VNextAddFact] }));
    const root = vnextLineageIdByFactId(next.graph).get(activeWorkloads(next)[0].id);
    expect(root).toBe(activeWorkloads(next)[0].id);
    expect(root).not.toBe(state.graph.workloads[0].id);
    expect(activeEfforts(next)).toEqual([]);
  });

  it('rejects the entire compound turn when its newly stated effort target was removed', () => {
    const state = setup(false);
    const result = turn(state, delta({ remove: [{ targetFactId: state.graph.workloads[0].id }],
      add: [{ ...effort('unused', 60), taskRef: { factId: state.graph.tasks[0].id },
        targetRef: { factId: state.graph.workloads[0].id } } as VNextAddFact] }));
    expect(result.status).toBe('rejected');
    expect(result.state).toBe(state);
  });

  it('stores same/distinct sorted lineage pairs and keeps them through value corrections', () => {
    const state = applied(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, workload('a', 8),
      { ...workload('b', 45, 'target'), unitCode: 'minute', unitLabel: '分' } as VNextAddFact],
    relate: [{ kind: 'distinct', a: { localId: 'b' }, b: { localId: 'a' } }] }));
    const next = applied(state, delta({ patch: [amountPatch(state, 9)] }));
    expect(next.workRelations).toEqual(state.workRelations);
    expect(next.workRelations[0].lineageIds).toEqual(state.graph.workloads.map(fact => fact.id).sort());
  });
});
