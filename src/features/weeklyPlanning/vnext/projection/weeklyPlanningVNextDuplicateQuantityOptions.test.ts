import { describe, expect, it } from 'vitest';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from '../semantic/weeklyPlanningVNextTransaction';
import { projectWeeklyPlanningVNext } from './weeklyPlanningVNextProjection';
import { computeVNextWorkUnits } from '../weeklyPlanningVNextWorkIdentity';
import { presentWeeklyPlanningVNextQuestion } from '../application/weeklyPlanningVNextQuestionText';
import type { VNextAddFact, VNextTurnDelta, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';

// Stage B SB8: a duplicate-quantity question offers the choices the user can actually make, each one an ordinary typed delta.
const horizon = { startDate: '2026-11-02', endDate: '2026-11-08' };
const empty = (): VNextTurnDelta => ({ add: [], patch: [], remove: [], relate: [], defer: [] });
const task: VNextAddFact = { kind: 'task', localId: 'task', category: 'study', title: '数学プリント' };
const quantity = (localId: string, amount: number, role: 'scope_total' | 'target'): VNextAddFact => ({ kind: 'workload', localId, taskRef: { localId: 'task' },
  componentRef: null, quantityRole: role, amount, unitCode: 'page', unitLabel: '枚', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null });
function apply(state: WeeklyPlanningVNextState, delta: VNextTurnDelta): WeeklyPlanningVNextState {
  const result = applyWeeklyPlanningVNextTurn(state, delta, { expectedRevision: state.graph.revision, acceptedDate: '2026-11-02', weekStartsOn: 'monday',
    planningHorizon: horizon, defaultPlanningHorizon: horizon, conversationId: 'c', turnKey: `t${state.graph.revision}`, turnId: `t${state.graph.revision}`, sourceText: 'synthetic' });
  if (result.status !== 'applied' && result.status !== 'noop') throw new Error(JSON.stringify(result));
  return result.state;
}
const seed = (...facts: VNextAddFact[]) => apply(createEmptyWeeklyPlanningVNextState(), { ...empty(), add: [task, ...facts] });
const asked = (state: WeeklyPlanningVNextState) => projectWeeklyPlanningVNext(state).questions[0];
const optionIds = (state: WeeklyPlanningVNextState) => asked(state).options.map(option => option.optionId.split(':')[0]);
const choose = (state: WeeklyPlanningVNextState, id: string) => apply(state, asked(state).options.find(option => option.optionId.split(':')[0] === id)!.delta);

describe('duplicate_quantity choices (Stage B SB8)', () => {
  it('offers "same" for two equal totals, and choosing it settles the question', () => {
    const state = seed(quantity('a', 20, 'scope_total'), quantity('b', 20, 'scope_total'));
    expect(asked(state)).toMatchObject({ code: 'duplicate_quantity' });
    expect(optionIds(state)).toEqual(['same']);
    expect(asked(choose(state, 'same'))).not.toMatchObject({ code: 'duplicate_quantity' });
  });

  it('offers to keep either amount for two different totals, and choosing one removes the other', () => {
    const state = seed(quantity('a', 20, 'scope_total'), quantity('b', 30, 'scope_total'));
    expect(optionIds(state)).toEqual(['keep', 'keep']);
    expect(asked(state).options.map(option => option.value)).toEqual([20, 30]);
    const kept = choose(state, 'keep');
    const live = new Set(kept.graph.factLifecycles.filter(entry => entry.status === 'active').map(entry => entry.factId));
    expect(kept.graph.workloads.filter(workload => live.has(workload.id)).map(workload => workload.amount)).toEqual([20]);
    expect(asked(kept)).not.toMatchObject({ code: 'duplicate_quantity' });
  });

  it('also offers separate works for targets, and choosing it keeps both', () => {
    const equal = seed(quantity('a', 20, 'target'), quantity('b', 20, 'target'));
    expect(optionIds(equal)).toEqual(['same', 'distinct']);
    const different = seed(quantity('a', 20, 'target'), quantity('b', 30, 'target'));
    expect(optionIds(different)).toEqual(['keep', 'keep', 'distinct']);
    const separate = choose(different, 'distinct');
    expect(asked(separate)).not.toMatchObject({ code: 'duplicate_quantity' });
    expect(computeVNextWorkUnits(separate.graph, separate.workRelations)[0].units.map(unit => unit.amount)).toEqual([20, 30]);
  });

  it('never offers separate works for totals (they cannot be expressed), and keeps the plain question for three or more', () => {
    expect(optionIds(seed(quantity('a', 20, 'scope_total'), quantity('b', 30, 'scope_total')))).not.toContain('distinct');
    const three = seed(quantity('a', 20, 'scope_total'), quantity('b', 20, 'scope_total'), quantity('c', 20, 'scope_total'));
    expect(asked(three)).toMatchObject({ code: 'duplicate_quantity', options: [] });
  });

  it('never mixes units in one question: an hour and sixty minutes are two works to tell apart, not a duplicate', () => {
    const time = (localId: string, amount: number, unit: 'hour' | 'minute'): VNextAddFact => ({ ...quantity(localId, amount, 'scope_total'),
      unitCode: unit, unitLabel: unit === 'hour' ? '時間' : '分' }) as VNextAddFact;
    for (const [hours, minutes] of [[1, 60], [4.1, 246]] as const) {
      expect(asked(seed(time('a', hours, 'hour'), time('b', minutes, 'minute')))).toMatchObject({ code: 'same_or_distinct_work' });
    }
    // The same unit stated twice with the same amount is a duplicate, including a decimal time.
    expect(optionIds(seed(time('a', 4.1, 'hour'), time('b', 4.1, 'hour')))).toEqual(['same']);
  });

  it('names the stated quantities in the question and in every choice', () => {
    const state = seed(quantity('a', 20, 'target'), quantity('b', 30, 'target'));
    const presentation = presentWeeklyPlanningVNextQuestion(state, asked(state));
    expect(presentation.text).toContain('20枚と30枚');
    expect(Object.values(presentation.optionLabels).sort()).toEqual(['20枚の方だけにする', '30枚の方だけにする', '別々の作業として両方やる'].sort());
    const equal = seed(quantity('a', 20, 'scope_total'), quantity('b', 20, 'scope_total'));
    expect(Object.values(presentWeeklyPlanningVNextQuestion(equal, asked(equal)).optionLabels)).toEqual(['同じ作業としてまとめる']);
  });
});
