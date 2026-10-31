import { describe, expect, it } from 'vitest';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from './weeklyPlanningVNextTransaction';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import { compileWeeklyPlanningVNextSchedulerInput } from '../projection/weeklyPlanningVNextSchedulerGraph';
import { compileGenericSchedulerInput } from '../../semantic/weeklyPlanningGenericSchedulerInput';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { computeVNextWorkUnits } from '../weeklyPlanningVNextWorkIdentity';
import type { VNextAddFact, VNextTurnDelta, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';
import { createWeeklyPlanningVNextFocusedInterpreter } from '../application/weeklyPlanningVNextFocusedInterpreter';
import { presentWeeklyPlanningVNextQuestion } from '../application/weeklyPlanningVNextQuestionText';

const context = { ownerId: 'owner', currentDate: '2026-11-02', timeZone: 'Asia/Tokyo',
  planningStartDate: '2026-11-02', planningEndDate: '2026-11-08' };
const horizon = { startDate: context.planningStartDate, endDate: context.planningEndDate };
const empty = (): VNextTurnDelta => ({ add: [], patch: [], remove: [], relate: [], defer: [] });
const target = (localId: string, amount: number, role: 'target' | 'scope_total' | 'completed' | 'remaining' = 'target'): VNextAddFact => ({
  kind: 'workload', localId, taskRef: { localId: 'task' }, componentRef: null, quantityRole: role,
  amount, unitCode: 'word', unitLabel: '語', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null });
const effort = (localId: string, targetId: string, total = false): VNextAddFact => ({
  kind: 'effort_estimate', localId, taskRef: { localId: 'task' }, targetRef: { localId: targetId },
  effortKind: total ? 'total_duration' : 'duration_per_unit', minutes: total ? targetId === 'a' ? 100 : 200 : 1,
  unitCode: total ? null : 'word', unitLabel: total ? null : '語', precision: 'exact' });
function apply(delta: VNextTurnDelta, state = createEmptyWeeklyPlanningVNextState()): WeeklyPlanningVNextState {
  const result = applyWeeklyPlanningVNextTurn(state, delta, { expectedRevision: state.graph.revision, acceptedDate: context.currentDate,
    weekStartsOn: 'monday', planningHorizon: horizon, defaultPlanningHorizon: horizon, conversationId: 'c',
    turnKey: `turn-${state.graph.revision}`, turnId: `turn-${state.graph.revision}`, sourceText: 'synthetic explicit work' });
  if (result.status !== 'applied' && result.status !== 'noop') throw new Error(JSON.stringify(result));
  return result.state;
}
const task: VNextAddFact = { kind: 'task', localId: 'task', category: 'study', title: '単語練習' };
const distinct = { kind: 'distinct' as const, a: { localId: 'a' }, b: { localId: 'b' } };
const seed = (total = false) => apply({ ...empty(), add: [task, target('a', 100), target('b', 200), effort('ea', 'a', total), effort('eb', 'b', total)], relate: [distinct] });

describe('explicit distinct targets in one quantity basis (Astra P03)', () => {
  it.each([false, true])('keeps both works like V5, binding after same-turn relations (total=%s)', total => {
    const state = seed(total);
    const projection = projectWeeklyPlanningVNext(state);
    expect(projection.readiness).toBe('ready');
    expect(projection.owners[0].work.map(item => item.amount)).toEqual([100, 200]);
    const result = compileWeeklyPlanningVNextSchedulerInput({ state, projection, context });
    if (result.status !== 'compiled') throw new Error(result.status);
    const v5 = compileGenericSchedulerInput({ graph: createWeeklyPlanningActiveSchedulerGraphViewV5(state.graph), context });
    const semantics = (compiled: typeof v5) => compiled.input!.movableWorkItems.map(item => ({
      workloadFactId: item.workloadFactId, quantity: item.quantity, baseEstimatedMinutes: item.baseEstimatedMinutes,
      estimatedMinutes: item.estimatedMinutes }));
    expect(semantics(result.compilation)).toEqual(semantics(v5));
    expect(result.compilation.input!.movableWorkItems.map(item => item.estimatedMinutes)).toEqual([120, 225]);
    if (total) expect(state.graph.effortEstimates.map(fact => fact.workBinding?.boundAmount)).toEqual([100, 200]);
  });

  it('does not settle an unrelated pair, or let a partial distinct graph imply all targets are distinct', () => {
    const state = apply({ ...empty(), add: [task, target('a', 100), target('b', 200), target('c', 300)], relate: [distinct] });
    expect(computeVNextWorkUnits(state.graph, state.workRelations)[0].issue?.code).toBe('duplicate_quantity');
    expect(projectWeeklyPlanningVNext(state).readiness).toBe('needs_resolution');
    const complete = apply({ ...empty(), relate: [
      { kind: 'distinct', a: { factId: state.graph.workloads[0].id }, b: { factId: state.graph.workloads[2].id } },
      { kind: 'distinct', a: { factId: state.graph.workloads[1].id }, b: { factId: state.graph.workloads[2].id } },
    ] }, state);
    expect(computeVNextWorkUnits(complete.graph, complete.workRelations)[0].units.map(unit => unit.amount)).toEqual([100, 200, 300]);
    const unrelated = apply({ ...empty(), add: [task, target('x', 100), target('y', 200)] });
    expect(computeVNextWorkUnits(unrelated.graph, state.workRelations)[0].issue?.code).toBe('duplicate_quantity');
  });

  it('keeps separate stated rates attached to their explicitly distinct targets', () => {
    const second = effort('eb', 'b');
    if (second.kind !== 'effort_estimate') throw new Error('test fixture kind');
    const state = apply({ ...empty(), add: [task, target('a', 100), target('b', 200), effort('ea', 'a'),
      { ...second, minutes: 2 }], relate: [distinct] });
    const v5 = compileGenericSchedulerInput({ graph: createWeeklyPlanningActiveSchedulerGraphViewV5(state.graph), context });
    expect(v5.status).toBe('ready');
    expect(v5.input!.movableWorkItems.map(item => item.baseEstimatedMinutes)).toEqual([100, 400]);
    const projection = projectWeeklyPlanningVNext(state);
    expect(projection.readiness).toBe('ready');
    const result = compileWeeklyPlanningVNextSchedulerInput({ state, projection, context });
    if (result.status !== 'compiled') throw new Error(result.status);
    expect(Object.fromEntries(result.compilation.input!.movableWorkItems.map(item => [item.workloadFactId, item.estimatedMinutes])))
      .toEqual(Object.fromEntries(v5.input!.movableWorkItems.map(item => [item.workloadFactId, item.estimatedMinutes])));
  });

  it('preserves total/progress/target behavior and refuses to guess their relation to several targets', () => {
    const single = apply({ ...empty(), add: [task, target('a', 100), target('total', 300, 'scope_total'), target('done', 50, 'completed')] });
    expect(computeVNextWorkUnits(single.graph, single.workRelations)[0].units.map(unit => unit.amount)).toEqual([100]);
    const mixed = apply({ ...empty(), add: [task, target('a', 100), target('b', 200), target('total', 300, 'scope_total')], relate: [distinct] });
    expect(computeVNextWorkUnits(mixed.graph, mixed.workRelations)[0].issue?.code).toBe('duplicate_quantity');
  });

  it('keeps an explicitly task-scoped rate applicable to both distinct works', () => {
    const scoped = effort('task-rate', 'a');
    if (scoped.kind !== 'effort_estimate') throw new Error('test fixture kind');
    const state = apply({ ...empty(), add: [task, target('a', 100), target('b', 200),
      { ...scoped, targetRef: { localId: 'task' } }], relate: [distinct] });
    expect(projectWeeklyPlanningVNext(state).owners[0].work.map(item => ({ amount: item.amount, minutes: item.minutes })))
      .toEqual([{ amount: 100, minutes: 100 }, { amount: 200, minutes: 200 }]);
  });

  it.each([
    { relation: 'same', secondRate: 1 }, { relation: 'unknown', secondRate: 1 },
    { relation: 'same', secondRate: 2 }, { relation: 'unknown', secondRate: 2 },
  ])('retains $relation rate sharing and genuine conflicts (second rate $secondRate)', ({ relation, secondRate }) => {
    const second = effort('eb', 'b');
    if (second.kind !== 'effort_estimate') throw new Error('test fixture kind');
    const state = apply({ ...empty(), add: [task, target('a', 300, 'scope_total'), target('done', 100, 'completed'),
      target('b', 200, 'remaining'), effort('ea', 'a'), { ...second, minutes: secondRate }],
      relate: relation === 'same' ? [{ kind: 'same', a: { localId: 'a' }, b: { localId: 'b' } }] : [] });
    const projection = projectWeeklyPlanningVNext(state);
    if (secondRate === 1) {
      expect(projection.owners[0].work.map(item => ({ amount: item.amount, minutes: item.minutes })))
        .toEqual([{ amount: 200, minutes: 200 }]);
    } else expect(projection.questions[0].code).toBe('effort_inconsistent');
  });

  it('uses the relation-aware pre-turn view for an existing work reference after a quantity correction', () => {
    const before = seed(); const work = before.graph.workloads[0];
    const state = apply({ ...empty(), patch: [{ kind: 'workload', localId: 'corrected', targetFactId: work.id, amountDelta: null,
      changes: { amount: 90, quantityRole: null, unitCode: null, unitLabel: null, rangeStart: null, rangeEnd: null,
        perOccurrence: null, periodExpression: null } }], add: [{ kind: 'effort_estimate', localId: 'new-total',
      taskRef: { factId: before.graph.tasks[0].id }, targetRef: { workLineageId: work.id }, effortKind: 'total_duration',
      minutes: 90, unitCode: null, unitLabel: null, precision: 'exact' }] }, before);
    expect(state.graph.effortEstimates.find(fact => fact.source.semanticLocalId === 'new-total')?.workBinding)
      .toMatchObject({ kind: 'future_work', workLineageId: work.id, boundAmount: 90 });
    expect(Object.fromEntries(projectWeeklyPlanningVNext(state).owners[0].work.map(item => [item.workLineageId, item.amount])))
      .toEqual({ [before.graph.workloads[0].id]: 90, [before.graph.workloads[1].id]: 200 });
  });

  it('lets the existing focused binder answer the second distinct work rather than falling back for a missing unit', async () => {
    const state = apply({ ...empty(), add: [task, target('a', 100), target('b', 200), effort('ea', 'a', true)], relate: [distinct] });
    const projection = projectWeeklyPlanningVNext(state); const question = projection.questions[0];
    expect(question).toMatchObject({ code: 'missing_effort_estimate', forWork: { amount: 200 } });
    const reading = await createWeeklyPlanningVNextFocusedInterpreter({ fullReading: async () => { throw new Error('missing relation-aware unit'); } })({
      state, projection, presentedQuestion: question, presentedText: presentWeeklyPlanningVNextQuestion(state, question).text,
      userText: '200分です', clock: { ...context, weekStartsOn: 'monday', defaultPlanningHorizon: horizon },
      client: { createChatCompletion: async () => JSON.stringify({ decision: 'effort_answer', effortTarget: 'question_target',
        effortMeasurement: 'total_duration', minutes: 200, precision: 'exact', quantityRole: null }) },
    });
    if (reading.status !== 'interpreted') throw new Error(reading.status);
    expect(projectWeeklyPlanningVNext(apply(reading.delta, state)).owners[0].work.map(item => item.minutes)).toEqual([100, 200]);
  });
});
