import { describe, expect, it } from 'vitest';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from './weeklyPlanningVNextTransaction';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import { computeVNextWorkUnits } from '../weeklyPlanningVNextWorkIdentity';
import type { VNextAddFact, VNextTurnDelta, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';

// Stage B SB2: the same quantity stated twice is one quantity only when the user said "same". Equal amounts alone are
// never folded (two works can have the same size), and a different amount still asks.
const horizon = { startDate: '2026-11-02', endDate: '2026-11-08' };
const empty = (): VNextTurnDelta => ({ add: [], patch: [], remove: [], relate: [], defer: [] });
const quantity = (localId: string, amount: number, role: 'scope_total' | 'completed' | 'remaining' | 'target',
  taskRef: { localId: string } | { factId: string } = { localId: 'task' }): VNextAddFact => ({
  kind: 'workload', localId, taskRef, componentRef: null, quantityRole: role, amount, unitCode: 'page', unitLabel: 'ページ',
  rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null });
const task: VNextAddFact = { kind: 'task', localId: 'task', category: 'study', title: '数学' };
function apply(delta: VNextTurnDelta, state = createEmptyWeeklyPlanningVNextState()): WeeklyPlanningVNextState {
  const result = applyWeeklyPlanningVNextTurn(state, delta, { expectedRevision: state.graph.revision, acceptedDate: '2026-11-02', weekStartsOn: 'monday',
    planningHorizon: horizon, defaultPlanningHorizon: horizon, conversationId: 'c', turnKey: `turn-${state.graph.revision}`,
    turnId: `turn-${state.graph.revision}`, sourceText: 'synthetic explicit work' });
  if (result.status !== 'applied' && result.status !== 'noop') throw new Error(JSON.stringify(result));
  return result.state;
}
const owner = (state: WeeklyPlanningVNextState) => computeVNextWorkUnits(state.graph, state.workRelations)[0];
const same = (state: WeeklyPlanningVNextState) => apply({ ...empty(), relate: [{ kind: 'same', a: { factId: state.graph.workloads[0].id },
  b: { factId: state.graph.workloads[1].id } }] }, state);

describe('the same quantity stated twice (Stage B SB2)', () => {
  it.each(['scope_total', 'completed', 'remaining', 'target'] as const)('keeps asking for two equal %s amounts until the user says they are the same', role => {
    const state = apply({ ...empty(), add: [task, quantity('a', 20, 'scope_total'), ...(role === 'scope_total' ? [] : [quantity('c', role === 'completed' ? 5 : 20, role)]),
      quantity('b', role === 'scope_total' ? 20 : role === 'completed' ? 5 : 20, role)] });
    expect(owner(state).issue?.code).toBe('duplicate_quantity');
  });

  it('settles two equal totals once the user says they are the same work: one quantity, no duplicate question', () => {
    const state = same(apply({ ...empty(), add: [task, quantity('a', 20, 'scope_total'), quantity('b', 20, 'scope_total')] }));
    expect(owner(state).issue).toBeNull();
    expect(owner(state).units.map(unit => [unit.role, unit.amount])).toEqual([['remaining', 20]]);
    expect(projectWeeklyPlanningVNext(state).questions?.map(question => question.code)).not.toContain('duplicate_quantity');
  });

  it('settles a total restated in a later turn once the user says it is the same work', () => {
    const first = apply({ ...empty(), add: [task, quantity('a', 20, 'scope_total')] });
    const restated = apply({ ...empty(), add: [quantity('b', 20, 'scope_total', { factId: first.graph.tasks[0].id })] }, first);
    expect(owner(restated).issue?.code).toBe('duplicate_quantity');
    expect(owner(same(restated)).issue).toBeNull();
  });

  it('settles two equal targets and equal completed amounts the same way', () => {
    const targets = same(apply({ ...empty(), add: [task, quantity('a', 20, 'target'), quantity('b', 20, 'target')] }));
    expect(owner(targets).units.map(unit => [unit.role, unit.amount])).toEqual([['target', 20]]);
    const completed = apply({ ...empty(), add: [task, quantity('t', 50, 'scope_total'), quantity('a', 5, 'completed'), quantity('b', 5, 'completed')] });
    const folded = apply({ ...empty(), relate: [{ kind: 'same', a: { factId: completed.graph.workloads[1].id }, b: { factId: completed.graph.workloads[2].id } }] }, completed);
    expect(owner(folded).units.map(unit => [unit.role, unit.amount])).toEqual([['remaining', 45]]);
  });

  it('still asks when the user says same but the amounts differ: which amount is the question', () => {
    const state = same(apply({ ...empty(), add: [task, quantity('a', 20, 'scope_total'), quantity('b', 30, 'scope_total')] }));
    expect(owner(state).issue?.code).toBe('duplicate_quantity');
  });

  it('folds a chain of explicit same relations (a~b, b~c) into one quantity', () => {
    const state = apply({ ...empty(), add: [task, quantity('a', 20, 'scope_total'), quantity('b', 20, 'scope_total'), quantity('c', 20, 'scope_total')] });
    const [a, b, c] = state.graph.workloads;
    const chained = apply({ ...empty(), relate: [{ kind: 'same', a: { factId: a.id }, b: { factId: b.id } }, { kind: 'same', a: { factId: b.id }, b: { factId: c.id } }] }, state);
    expect(owner(chained).issue).toBeNull();
    expect(owner(chained).units.map(unit => [unit.role, unit.amount])).toEqual([['remaining', 20]]);
  });

  it('does not let a same relation fold an unrelated third amount', () => {
    const state = apply({ ...empty(), add: [task, quantity('a', 20, 'scope_total'), quantity('b', 20, 'scope_total'), quantity('c', 20, 'scope_total')] });
    const partly = apply({ ...empty(), relate: [{ kind: 'same', a: { factId: state.graph.workloads[0].id }, b: { factId: state.graph.workloads[1].id } }] }, state);
    expect(owner(partly).issue?.code).toBe('duplicate_quantity');
  });
});
