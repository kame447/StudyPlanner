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
    turnKey: key, conversationId: 'c', turnId: key, sourceText: 'user evidence' });
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
function amountPatch(state: WeeklyPlanningVNextState, amount: number): VNextPatch {
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
    const malformed = { ...amountPatch(state, 8), changes: { ...workloadChanges(8), taskId: 'foreign' } } as VNextPatch;
    const result = turn(state, delta({ patch: [malformed], add: [{ ...task, localId: 'other' }] }));
    expect(result.status).toBe('rejected');
    expect(result.state).toBe(state);
    if (result.status === 'rejected') expect(result.errors).toContainEqual(expect.objectContaining({ path: 'patch[0].changes.taskId' }));
  });

  it('rejects stale revision, terminal target and unknown target', () => {
    const state = setup(false);
    const changes = delta({ patch: [amountPatch(state, 8)] });
    const stale = applyWeeklyPlanningVNextTurn(state, changes, { expectedRevision: 0, turnKey: 'stale', conversationId: 'c', turnId: 't', sourceText: 'evidence' });
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
      turnKey: 'replay', conversationId: 'c', turnId: 'replay', sourceText: 'evidence' });
    expect(replay.status).toBe('duplicate');
    expect(replay.state).toBe(result.state);
  });

  it('no-op patch preserves revision and graph identity', () => {
    const state = setup();
    const result = turn(state, delta({ patch: [amountPatch(state, 7)] }));
    expect(result.status).toBe('noop');
    expect(result.state).toBe(state);
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
