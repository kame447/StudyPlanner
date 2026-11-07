import { describe, expect, it } from 'vitest';
import { filterActiveWeeklyPlanningFactsV5 } from '../../semantic/weeklyPlanningFactLifecycleV5';
import {
  applyWeeklyPlanningVNextTurn,
  createEmptyWeeklyPlanningVNextState,
} from '../semantic/weeklyPlanningVNextTransaction';
import type { VNextAddWorkload, VNextTurnDelta, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';
import { projectWeeklyPlanningVNext } from './weeklyPlanningVNextProjection';

let sequence = 0;
function apply(state: WeeklyPlanningVNextState, partial: Partial<VNextTurnDelta>, sourceText: string) {
  const turnKey = `progress-scope-${++sequence}`;
  const result = applyWeeklyPlanningVNextTurn(state, { add: [], patch: [], remove: [], relate: [], defer: [], ...partial }, {
    acceptedDate: '2026-11-02', weekStartsOn: 'monday',
    planningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' },
    defaultPlanningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' },
    turnKey, expectedRevision: state.graph.revision,
    conversationId: 'progress-scope', turnId: turnKey, sourceText,
  });
  if (result.status !== 'applied') throw new Error(JSON.stringify(result));
  return result.state;
}

type Scope = Pick<VNextAddWorkload, 'unitCode' | 'unitLabel' | 'rangeStart' | 'rangeEnd' | 'perOccurrence' | 'periodExpression'>;
function workload(localId: string, quantityRole: VNextAddWorkload['quantityRole'], amount: number,
  scope: Partial<Scope> = {}): VNextAddWorkload {
  return { kind: 'workload', localId, taskRef: { localId: 'task' }, componentRef: null,
    quantityRole, amount, unitCode: 'custom', unitLabel: '枚', rangeStart: null, rangeEnd: null,
    perOccurrence: false, periodExpression: null, ...scope };
}

function initial(workloads: VNextAddWorkload[], unitCode: VNextAddWorkload['unitCode'] = 'custom', unitLabel = '枚') {
  return apply(createEmptyWeeklyPlanningVNextState(), { add: [
    { kind: 'task', localId: 'task', category: 'non_study', title: '資料' }, ...workloads,
    { kind: 'effort_estimate', localId: 'rate', taskRef: { localId: 'task' }, targetRef: { localId: 'task' },
      effortKind: 'duration_per_unit', minutes: 1, unitCode, unitLabel, precision: 'exact' },
  ] }, 'typed progress fixture');
}

function fact(state: WeeklyPlanningVNextState, localId: string) {
  const found = state.graph.workloads.find(item => item.source.semanticLocalId === localId);
  if (!found) throw new Error(`missing fixture ${localId}`);
  return found;
}

const noChanges = { quantityRole: null, amount: null, unitCode: null, unitLabel: null,
  rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null };

describe('#913 progress scope through the production VNext transaction and projection', () => {
  it('distinguishes a cumulative snapshot from an increment without storing a derived remainder', () => {
    let state = initial([workload('total', 'scope_total', 20), workload('completed10', 'completed', 10)]);
    state = apply(state, { patch: [{ kind: 'workload', localId: 'completed12',
      targetFactId: fact(state, 'completed10').id, amountDelta: null, changes: { ...noChanges, amount: 12 } }] }, '今12枚です');
    expect(projectWeeklyPlanningVNext(state).owners[0].work).toMatchObject([{ amount: 8, minutes: 8 }]);
    state = apply(state, { patch: [{ kind: 'workload', localId: 'completed14',
      targetFactId: fact(state, 'completed12').id, amountDelta: 2, changes: noChanges }] }, 'さらに2枚終わりました');

    expect(fact(state, 'completed14').amount).toBe(14);
    expect(projectWeeklyPlanningVNext(state).owners[0].work).toMatchObject([{ amount: 6, minutes: 6 }]);
    expect(state.graph.workloads.filter(item => item.quantityRole === 'remaining')).toEqual([]);
    expect(fact(state, 'completed10').amount).toBe(10);
    expect(fact(state, 'completed12').amount).toBe(12);
  });

  it('retains a past observation without replacing the current snapshot or planning both as current', () => {
    const percent = { unitCode: 'custom' as const, unitLabel: '%' };
    let state = initial([workload('current70', 'completed', 70, percent)], 'custom', '%');
    const current = fact(state, 'current70');
    // Observation time belongs to source evidence, not the workload measurement period.
    state = apply(state, { add: [{ ...workload('past60', 'completed', 60, percent),
      taskRef: { factId: current.taskId } }] }, '昨日の時点では60%でした');
    const past = fact(state, 'past60');
    const beforeProjection = structuredClone(state);
    const unresolved = projectWeeklyPlanningVNext(state);

    expect(unresolved.readiness).toBe('needs_resolution');
    expect(unresolved.questions[0].code).toBe('duplicate_quantity');
    expect(unresolved.owners[0].work).toEqual([]);
    expect(filterActiveWeeklyPlanningFactsV5(state.graph, state.graph.workloads).map(item => item.amount)).toEqual([70, 60]);
    expect(state).toEqual(beforeProjection);

    // The interpreter explicitly resolves which observation is current; history remains in the graph.
    state = apply(state, { remove: [{ targetFactId: past.id }] }, '今の累計は70%で、60%は昨日の記録です');
    expect(projectWeeklyPlanningVNext(state).owners[0].work).toMatchObject([{ amount: 30, minutes: 30 }]);
    expect(fact(state, 'past60')).toEqual(past);
    expect(state.graph.factLifecycles.find(item => item.factId === past.id)?.status).toBe('removed');
    expect(fact(state, 'current70')).toEqual(current);
  });

  it.each([
    { name: 'page ranges', total: { rangeStart: '1', rangeEnd: '20' }, completed: { rangeStart: '21', rangeEnd: '40' } },
    { name: 'measurement periods', total: { periodExpression: 'week-A' }, completed: { periodExpression: 'week-B' } },
  ])('does not subtract progress from a different scope: $name', ({ total, completed }) => {
    const state = initial([workload('total', 'scope_total', 20, total), workload('other12', 'completed', 12, completed)]);
    const before = structuredClone(state);
    const projection = projectWeeklyPlanningVNext(state);

    expect(projection.questions).toEqual([]);
    expect(projection.owners[0].work).toMatchObject([{ amount: 20, minutes: 20, ...total }]);
    expect(projection.owners[0].work).toHaveLength(1);
    expect(state).toEqual(before);
  });

  it('keeps independently stated percentage scopes unresolved instead of overwriting either', () => {
    const percent = { unitCode: 'custom' as const, unitLabel: '%' };
    const state = initial([workload('whole70', 'completed', 70, percent),
      workload('weekly60', 'completed', 60, { ...percent, periodExpression: 'weekly' })], 'custom', '%');
    const before = structuredClone(state);
    const projection = projectWeeklyPlanningVNext(state);

    expect(projection.readiness).toBe('needs_resolution');
    expect(projection.questions[0].code).toBe('same_or_distinct_work');
    expect(projection.owners[0].work).toEqual([]);
    expect(state).toEqual(before);
    expect(fact(state, 'whole70')).toMatchObject({ amount: 70, periodExpression: null });
    expect(fact(state, 'weekly60')).toMatchObject({ amount: 60, periodExpression: 'weekly' });
  });
});
