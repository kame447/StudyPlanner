import { describe, expect, it } from 'vitest';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from '../semantic/weeklyPlanningVNextTransaction';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import { decodeVNextProviderOutput } from '../semantic/weeklyPlanningVNextProviderSchema';
import { resolveWeeklyPlanningVNextTurnDelta } from './weeklyPlanningVNextAnswerBinding';
import type { VNextAddFact, VNextDefer, VNextTurnDelta, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';

// Stage B priority 6: "provisional for all of them" is expanded only when the user said so, only over the pending questions
// that allow a provisional timebox, and is stored as ordinary per-question deferrals.
const horizon = { startDate: '2026-11-02', endDate: '2026-11-08' };
const empty = (): VNextTurnDelta => ({ add: [], patch: [], remove: [], relate: [], defer: [] });
const task = (localId: string, title: string): VNextAddFact => ({ kind: 'task', localId, category: 'study', title });
const target = (localId: string, taskLocal: string, amount: number): VNextAddFact => ({ kind: 'workload', localId, taskRef: { localId: taskLocal },
  componentRef: null, quantityRole: 'target', amount, unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false,
  periodExpression: null });
const total = (localId: string, taskLocal: string, amount: number): VNextAddFact => ({ ...target(localId, taskLocal, amount), quantityRole: 'scope_total' } as VNextAddFact);
const turn = (state: WeeklyPlanningVNextState, delta: VNextTurnDelta) => applyWeeklyPlanningVNextTurn(state, delta, { expectedRevision: state.graph.revision,
  acceptedDate: '2026-11-02', weekStartsOn: 'monday', planningHorizon: horizon, defaultPlanningHorizon: horizon, conversationId: 'c',
  turnKey: `turn-${state.graph.revision}`, turnId: `turn-${state.graph.revision}`, sourceText: 'synthetic' });
function applied(state: WeeklyPlanningVNextState, delta: VNextTurnDelta): WeeklyPlanningVNextState {
  const result = turn(state, delta);
  if (result.status !== 'applied' && result.status !== 'noop') throw new Error(JSON.stringify(result));
  return result.state;
}
// Three works with an amount and no effort: three pending missing_effort_estimate questions. A learning-strategy-free setting.
const threeWorks = () => applied(createEmptyWeeklyPlanningVNextState(), { ...empty(),
  add: [task('t1', '数学'), target('w1', 't1', 20), task('t2', '英語'), target('w2', 't2', 15), task('t3', '物理'), target('w3', 't3', 10)] });
const resolve = (state: WeeklyPlanningVNextState, defer: VNextDefer[]) => {
  const projection = projectWeeklyPlanningVNext(state);
  const resolved = resolveWeeklyPlanningVNextTurnDelta({ presentationFresh: true, presented: { questionKey: projection.questions[0].key, graphRevision: state.graph.revision },
    projection, graph: state.graph, interpreted: { delta: { ...empty(), defer }, answer: null } });
  if (resolved.status !== 'delta') throw new Error(resolved.status);
  return { projection, delta: resolved.delta };
};
const keys = (projection: ReturnType<typeof projectWeeklyPlanningVNext>) => projection.questions.map(question => question.key);

describe('deferring the pending questions with a provisional timebox (Stage B priority 6)', () => {
  it('does not widen a deferral without the all_pending scope: one question, as before', () => {
    const state = threeWorks();
    const { projection, delta } = resolve(state, [{ questionKey: projectWeeklyPlanningVNext(state).questions[0].key, allocation: 'provisional_timebox', scope: 'presented' }]);
    expect(delta.defer.map(item => item.questionKey)).toEqual([keys(projection)[0]]);
    const unscoped = resolve(state, [{ questionKey: keys(projection)[0], allocation: 'provisional_timebox' }]);
    expect(unscoped.delta.defer).toHaveLength(1);
  });

  it('expands an explicit all_pending provisional timebox over every pending question that allows one, and the turn then makes the plan ready', () => {
    const state = threeWorks();
    const first = projectWeeklyPlanningVNext(state).questions[0].key;
    const { projection, delta } = resolve(state, [{ questionKey: first, allocation: 'provisional_timebox', scope: 'all_pending' }]);
    expect(delta.defer.map(item => item.questionKey).sort()).toEqual(keys(projection).sort());
    expect(delta.defer.every(item => item.allocation === 'provisional_timebox' && item.scope === 'presented')).toBe(true);
    const after = applied(state, delta);
    expect(projectWeeklyPlanningVNext(after).readiness).toBe('ready');
    // What is stored is the ordinary shape: no scope in the checkpoint's deferrals.
    expect(after.deferrals.every(item => Object.keys(item).sort().join() === 'allocation,createdRevision,questionKey')).toBe(true);
  });

  it('leaves pending questions that do not allow a provisional timebox asked', () => {
    // Two equal totals make a duplicate_quantity question for the first work; the other two works only lack an effort.
    const state = applied(createEmptyWeeklyPlanningVNextState(), { ...empty(), add: [task('t1', '数学'),
      total('a', 't1', 20), total('b', 't1', 20),
      task('t2', '英語'), target('w2', 't2', 15), task('t3', '物理'), target('w3', 't3', 10)] });
    const projection = projectWeeklyPlanningVNext(state);
    const effort = projection.questions.filter(question => question.code === 'missing_effort_estimate');
    expect(projection.questions.some(question => question.code === 'duplicate_quantity')).toBe(true);
    const { delta } = resolve(state, [{ questionKey: effort[0].key, allocation: 'provisional_timebox', scope: 'all_pending' }]);
    expect(delta.defer.map(item => item.questionKey).sort()).toEqual(effort.map(question => question.key).sort());
    const after = projectWeeklyPlanningVNext(applied(state, delta));
    expect(after.readiness).toBe('needs_resolution');
    expect(after.questions.map(question => question.code)).toEqual(['duplicate_quantity']);
  });

  it('rejects an all_pending scope on an ordinary deferral instead of widening it', () => {
    const state = threeWorks();
    const { delta } = resolve(state, [{ questionKey: projectWeeklyPlanningVNext(state).questions[0].key, allocation: 'none', scope: 'all_pending' }]);
    expect(delta.defer).toHaveLength(1);
    expect(turn(state, delta)).toMatchObject({ status: 'rejected', errors: [{ code: 'invalid_value', path: 'defer[0].scope' }] });
  });
});

describe('the wire form of a deferral scope', () => {
  const reading = (defer: Record<string, unknown>[]) => ({ planningIntent: 'create_plan', planningRequestEvidence: null, conversationActs: [],
    delta: { add: [], patch: [], remove: [], relate: [], defer }, studyRecords: [], studyRecordQuestion: null, studyRestDays: [], answer: null });
  it('reads a deferral without a scope (or with presented) as the plain form, and keeps an explicit all_pending', () => {
    const decoded = decodeVNextProviderOutput(reading([{ questionKey: 'Q1', allocation: 'none' }, { questionKey: 'Q3', allocation: 'none', scope: 'presented' }, { questionKey: 'Q2', allocation: 'provisional_timebox', scope: 'all_pending' }]));
    expect(decoded.status).toBe('decoded');
    if (decoded.status === 'decoded') expect(decoded.reading.delta.defer.map(item => item.scope)).toEqual([undefined, undefined, 'all_pending']);
  });
  it('rejects an unknown scope value', () => {
    expect(decodeVNextProviderOutput(reading([{ questionKey: 'Q1', allocation: 'none', scope: 'everything' }])).status).toBe('rejected');
  });
});
