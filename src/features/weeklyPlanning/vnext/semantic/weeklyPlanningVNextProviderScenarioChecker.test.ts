import { describe, expect, it } from 'vitest';
import type { VNextAddFact, VNextTurnDelta, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from './weeklyPlanningVNextTransaction';
import { checkVNextProviderScenario, VNEXT_PROVIDER_SCENARIOS } from './weeklyPlanningVNextProviderScenarios';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';

const empty = (): VNextTurnDelta => ({ add: [], patch: [], remove: [], relate: [], defer: [] });
const context = { expectedRevision: 0, turnKey: 'seed', conversationId: 'oracle-control', turnId: 'turn', sourceText: 'Synthetic control', weekStartsOn: 'monday' as const, planningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' }, acceptedDate: '2026-10-30' };
function apply(state: WeeklyPlanningVNextState, delta: VNextTurnDelta): WeeklyPlanningVNextState {
  const result = applyWeeklyPlanningVNextTurn(state, delta, { ...context, expectedRevision: state.graph.revision, turnKey: `turn:${state.graph.revision}` });
  if (result.status !== 'applied') throw new Error(JSON.stringify(result));
  return result.state;
}
function seed(id: string) {
  const scenario = VNEXT_PROVIDER_SCENARIOS.find(candidate => candidate.id === id)!;
  return { scenario, state: apply(createEmptyWeeklyPlanningVNextState(), { ...empty(), add: scenario.seed }) };
}
const work = (localId: string, taskRef: { localId: string } | { factId: string }, amount: number,
  quantityRole: 'remaining' | 'completed' | 'target' = 'remaining'): Extract<VNextAddFact, { kind: 'workload' }> => ({
  kind: 'workload', localId, taskRef, componentRef: null, amount, quantityRole, unitCode: 'custom', unitLabel: '枚',
  rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
});
const effort = (localId: string, taskId: string, target: { localId: string } | { factId: string }, minutes: number): VNextAddFact => ({
  kind: 'effort_estimate', localId, taskRef: { factId: taskId }, targetRef: target, effortKind: 'total_duration', minutes,
  unitCode: null, unitLabel: null, precision: 'exact',
});
const reading = (delta: VNextTurnDelta) => ({ status: 'interpreted' as const, delta, answer: null, metrics: { calls: 1, repairs: 0, latencyMs: 0 } });

describe('controlled provider-oracle corruption probes', () => {
  it('requires the explicit date to be a hard deadline, not just any constraint on that date', () => {
    const { scenario, state } = seed('explicit-date');
    const taskId = state.graph.tasks[0].id;
    for (const [constraintKind, constraintLevel] of [
      ['deadline', 'hard'], ['deadline', 'soft'], ['deadline', 'unknown'], ['preferred_window', 'soft'],
    ] as const) {
      const delta: VNextTurnDelta = { ...empty(), add: [{ kind: 'temporal_constraint', localId: 'bound',
        taskRef: { factId: taskId }, targetRef: { factId: taskId }, constraintKind, constraintLevel,
        dateExpression: '2026-11-03', namedTimePeriod: null, startTime: null, endTime: null, precision: 'exact' }] };
      const failures = checkVNextProviderScenario(scenario.turns[0].expected, state, apply(state, delta), reading(delta));
      if (constraintKind === 'deadline' && constraintLevel === 'hard') expect(failures).toEqual([]);
      else expect(failures).toContainEqual(expect.stringContaining('missing temporal bound'));
    }
  });

  it('rejects swapped owner/work associations even when global minute totals agree', () => {
    const { scenario, state } = seed('independent-scope');
    const taskId = state.graph.tasks[0].id;
    const delta: VNextTurnDelta = { ...empty(), remove: [{ targetFactId: state.graph.workloads[0].id }], add: [
      { kind: 'task', localId: 'english', category: 'study', title: 'English' },
      { ...work('wrong-owner-pages', { localId: 'english' }, 7) },
      { ...work('wrong-owner-time', { factId: taskId }, 45, 'target'), unitCode: 'minute', unitLabel: '分' },
      { ...effort('moved-total', taskId, { localId: 'wrong-owner-pages' }, 45), taskRef: { localId: 'english' } } as VNextAddFact,
    ] };
    const after = apply(state, delta);
    expect(checkVNextProviderScenario(scenario.turns[0].expected, state, after, reading(delta))).not.toEqual([]);
  });

  it('rejects an extra completed fact that adds no schedulable work', () => {
    const { scenario, state } = seed('observed-pace');
    const taskId = state.graph.tasks[0].id;
    const delta: VNextTurnDelta = { ...empty(), add: [work('completed', { factId: taskId }, 12, 'completed'),
      effort('pace', taskId, { localId: 'completed' }, 60),
      { ...work('unstated', { factId: taskId }, 1, 'completed'), unitCode: 'word', unitLabel: '語' }] };
    expect(checkVNextProviderScenario(scenario.turns[0].expected, state, apply(state, delta), reading(delta))).not.toEqual([]);
  });

  it('rejects duplicate agreeing estimates instead of merely finding one matching estimate', () => {
    const { scenario, state } = seed('observed-pace');
    const taskId = state.graph.tasks[0].id;
    const delta: VNextTurnDelta = { ...empty(), add: [work('completed', { factId: taskId }, 12, 'completed'),
      effort('pace1', taskId, { localId: 'completed' }, 60), effort('pace2', taskId, { localId: 'completed' }, 60)] };
    expect(checkVNextProviderScenario(scenario.turns[0].expected, state, apply(state, delta), reading(delta))).not.toEqual([]);
  });

  it('rejects an unbound owner total that coincides with the requested current workload total', () => {
    const { scenario, state } = seed('compound-r8-e60-1');
    const taskId = state.graph.tasks[0].id;
    const delta: VNextTurnDelta = { ...empty(), remove: [{ targetFactId: state.graph.effortEstimates[0].id }],
      patch: [{ kind: 'workload', localId: 'r8', targetFactId: state.graph.workloads[0].id, amountDelta: null,
        changes: { amount: 8, unitCode: null, unitLabel: null, quantityRole: null, rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null } }],
      add: [effort('wrong-owner-total', taskId, { factId: taskId }, 60)] };
    expect(checkVNextProviderScenario(scenario.turns[0].expected, state, apply(state, delta), reading(delta))).not.toEqual([]);
  });

  it('accepts one completed-work pace with its exact binding and independent future result', () => {
    const { scenario, state } = seed('observed-pace');
    const taskId = state.graph.tasks[0].id;
    const delta: VNextTurnDelta = { ...empty(), add: [work('completed', { factId: taskId }, 12, 'completed'), effort('pace', taskId, { localId: 'completed' }, 60)] };
    expect(checkVNextProviderScenario(scenario.turns[0].expected, state, apply(state, delta), reading(delta))).toEqual([]);
  });

  it('accepts a rebound future total rather than requiring the old physical estimate ID', () => {
    const { scenario, state } = seed('compound-r8-e60-1');
    const delta: VNextTurnDelta = { ...empty(), patch: [
      { kind: 'workload', localId: 'r8', targetFactId: state.graph.workloads[0].id, amountDelta: null,
        changes: { amount: 8, unitCode: null, unitLabel: null, quantityRole: null, rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null } },
      { kind: 'effort_estimate', localId: 'e60', targetFactId: state.graph.effortEstimates[0].id,
        changes: { minutes: 60, effortKind: null, unitCode: null, unitLabel: null, precision: null } },
    ] };
    expect(checkVNextProviderScenario(scenario.turns[0].expected, state, apply(state, delta), reading(delta))).toEqual([]);
  });

  it('accepts separate duration work in hours with correct owner association', () => {
    const { scenario, state } = seed('independent-scope');
    const delta: VNextTurnDelta = { ...empty(), add: [
      { kind: 'task', localId: 'english', category: 'study', title: 'English aloud' },
      { ...work('english-time', { localId: 'english' }, 0.75, 'target'), unitCode: 'hour', unitLabel: '時間' },
    ] };
    expect(checkVNextProviderScenario(scenario.turns[0].expected, state, apply(state, delta), reading(delta))).toEqual([]);
  });

  it('checks option effects, rejecting the other choice without comparing generated option IDs', () => {
    const { scenario, state } = seed('option-answer');
    const question = projectWeeklyPlanningVNext(state).questions[0];
    for (const [index, option] of question.options.entries()) {
      const interpreted = { ...reading(option.delta), answer: { kind: 'option' as const, optionId: option.optionId } };
      const errors = checkVNextProviderScenario(scenario.turns[0].expected, state, apply(state, option.delta), interpreted);
      if (index === 0) expect(errors).toEqual([]);
      else expect(errors).not.toEqual([]);
    }
  });

  it('checks the named workload role label independently of array ordering', () => {
    const scenario = VNEXT_PROVIDER_SCENARIOS.find(candidate => candidate.id === 'custom-page-preservation')!;
    const state = apply(createEmptyWeeklyPlanningVNextState(), { ...empty(), add: [...scenario.seed,
      { ...work('old-other-progress', { localId: 'task' }, 1, 'completed'), unitCode: 'word', unitLabel: '語' }] });
    const correction: VNextTurnDelta = { ...empty(), patch: [{ kind: 'workload', localId: 'r8', targetFactId: state.graph.workloads[0].id,
      amountDelta: null, changes: { amount: 8, unitCode: null, unitLabel: null, quantityRole: null, rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null } }] };
    const after = apply(state, correction);
    after.graph.workloads.reverse();
    const expected = { ...scenario.turns[0].expected, roles: [{ role: 'remaining', amount: 8 }, { role: 'completed', amount: 1 }] };
    expect(checkVNextProviderScenario(expected, state, after, reading(correction))).toEqual([]);
    const current = after.graph.workloads.find(fact => fact.quantityRole === 'remaining'
      && after.graph.factLifecycles.some(entry => entry.factId === fact.id && entry.status === 'active'))!;
    const wrong: VNextTurnDelta = { ...empty(), patch: [{ kind: 'workload', localId: 'wrong-label', targetFactId: current.id,
      amountDelta: null, changes: { amount: null, unitCode: null, unitLabel: 'セット', quantityRole: null, rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null } }] };
    const errors = checkVNextProviderScenario(expected, state, apply(after, wrong), reading(wrong));
    expect(errors.some(error => error.startsWith('workload label'))).toBe(true);
  });
});
