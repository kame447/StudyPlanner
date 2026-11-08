import { describe, expect, it } from 'vitest';
import type { VNextAddFact, VNextTurnDelta, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';
import { vnextRangeFixedAmount } from '../weeklyPlanningVNextWorkIdentity';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from './weeklyPlanningVNextTransaction';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';

// A stated range fixes its own amount: real model output for 「30ページから50ページまで」 had the right ends but an amount of
// 40, 30 and 50 (21 in no run). The ends are typed and exact, so the amount follows them; an explicit later amount does not.
const horizon = { startDate: '2026-11-02', endDate: '2026-11-08' };
const empty = (): VNextTurnDelta => ({ add: [], patch: [], remove: [], relate: [], defer: [] });
const task: VNextAddFact = { kind: 'task', localId: 'task', category: 'study', title: '数学' };
const ranged = (amount: number, start: string | null, end: string | null, unitCode: 'page' | 'chapter' | 'minute' | 'custom' = 'page', unitLabel = 'ページ'): VNextAddFact => ({
  kind: 'workload', localId: 'w', taskRef: { localId: 'task' }, componentRef: null, quantityRole: 'target', amount, unitCode, unitLabel,
  rangeStart: start, rangeEnd: end, perOccurrence: false, periodExpression: null });
function apply(delta: VNextTurnDelta, state = createEmptyWeeklyPlanningVNextState()) {
  return applyWeeklyPlanningVNextTurn(state, delta, { expectedRevision: state.graph.revision, acceptedDate: '2026-11-02', weekStartsOn: 'monday',
    planningHorizon: horizon, defaultPlanningHorizon: horizon, conversationId: 'c', turnKey: `t${state.graph.revision}`, turnId: `t${state.graph.revision}`, sourceText: 'synthetic' });
}
function applied(delta: VNextTurnDelta, state?: WeeklyPlanningVNextState): WeeklyPlanningVNextState {
  const result = apply(delta, state);
  if (result.status !== 'applied') throw new Error(JSON.stringify(result));
  return result.state;
}
const stored = (state: WeeklyPlanningVNextState) => {
  const live = new Set(state.graph.factLifecycles.filter(entry => entry.status === 'active').map(entry => entry.factId));
  return state.graph.workloads.filter(workload => live.has(workload.id)).map(workload => workload.amount);
};
const patched = (state: WeeklyPlanningVNextState, changes: Partial<Record<string, unknown>>, amountDelta: number | null = null) => applied({ ...empty(), patch: [{
  kind: 'workload', localId: 'p', targetFactId: state.graph.workloads[0].id, amountDelta,
  changes: { amount: null, unitCode: null, unitLabel: null, quantityRole: null, rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null, ...changes } as never }] }, state);

describe('a stated range fixes its own amount', () => {
  it.each([40, 30, 50, 21])('stores 21 pages for 30〜50 whatever amount the model gave (%s)', amount => {
    const state = applied({ ...empty(), add: [task, ranged(amount, '30', '50')] });
    expect(stored(state)).toEqual([21]);
    // The question that asks how long it takes names the real count.
    expect(projectWeeklyPlanningVNext(state).questions[0]).toMatchObject({ code: 'missing_effort_estimate', forWork: { amount: 21 } });
  });

  it('counts a range starting at 1 the same way (1〜20 is 20)', () => {
    expect(stored(applied({ ...empty(), add: [task, ranged(7, '1', '20')] }))).toEqual([20]);
  });

  it('counts a single-item range as one', () => {
    expect(stored(applied({ ...empty(), add: [task, ranged(5, '12', '12')] }))).toEqual([1]);
  });

  it('keeps the stated amount when the range does not fix one', () => {
    expect(stored(applied({ ...empty(), add: [task, ranged(7, null, null)] }))).toEqual([7]);
    expect(stored(applied({ ...empty(), add: [task, ranged(7, '第3章', '第5章', 'chapter', '章')] }))).toEqual([7]);
    expect(stored(applied({ ...empty(), add: [task, ranged(7, '50', '30')] }))).toEqual([7]);
    expect(stored(applied({ ...empty(), add: [task, ranged(7, '30', '50', 'minute', '分')] }))).toEqual([7]);
    expect(stored(applied({ ...empty(), add: [task, ranged(7, '20', '50', 'custom', '%')] }))).toEqual([7]);
  });

  it('still rejects a range with only one end', () => {
    expect(apply({ ...empty(), add: [task, ranged(7, '30', null)] }).status).toBe('rejected');
  });
});

describe('a range stated in a later turn', () => {
  const base = () => applied({ ...empty(), add: [task, ranged(10, null, null)] });

  it('fixes the amount when the patch states the range', () => {
    expect(stored(patched(base(), { rangeStart: '31', rangeEnd: '50' }))).toEqual([20]);
  });

  it('keeps an explicit amount stated in the same patch', () => {
    expect(stored(patched(base(), { rangeStart: '31', rangeEnd: '50', amount: 15 }))).toEqual([15]);
  });

  it('never overrides a later explicit amount correction on an existing range', () => {
    const withRange = applied({ ...empty(), add: [task, ranged(40, '30', '50')] });
    expect(stored(withRange)).toEqual([21]);
    expect(stored(patched(withRange, { amount: 15 }))).toEqual([15]);
    expect(stored(patched(withRange, {}, -6))).toEqual([15]);
  });
});

describe('vnextRangeFixedAmount', () => {
  it('reads full-width digits and rejects anything that is not a plain integer', () => {
    expect(vnextRangeFixedAmount({ unitCode: 'page', rangeStart: '３０', rangeEnd: '５０' })).toBe(21);
    expect(vnextRangeFixedAmount({ unitCode: 'problem', rangeStart: '10', rangeEnd: '20' })).toBe(11);
    expect(vnextRangeFixedAmount({ unitCode: 'page', rangeStart: 'p30', rangeEnd: 'p50' })).toBeNull();
    expect(vnextRangeFixedAmount({ unitCode: 'page', rangeStart: '30.5', rangeEnd: '50' })).toBeNull();
    expect(vnextRangeFixedAmount({ unitCode: 'page', rangeStart: '30', rangeEnd: null })).toBeNull();
    expect(vnextRangeFixedAmount({ unitCode: 'hour', rangeStart: '1', rangeEnd: '3' })).toBeNull();
  });
});
