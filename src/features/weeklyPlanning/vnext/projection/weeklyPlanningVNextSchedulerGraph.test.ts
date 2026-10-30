import { describe, expect, it } from 'vitest';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { compileGenericSchedulerInput } from '../../semantic/weeklyPlanningGenericSchedulerInput';
import {
  applyWeeklyPlanningVNextTurn,
  createEmptyWeeklyPlanningVNextState,
} from '../semantic/weeklyPlanningVNextTransaction';
import type { VNextAddFact, VNextAddWorkload, VNextTurnDelta, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';
import { projectWeeklyPlanningVNext } from './weeklyPlanningVNextProjection';
import { WEEKLY_PLANNING_NAMED_TIME_PERIODS_V5 } from '../../semantic/weeklyPlanningResolvedTemporalConstraintsV5';
import { compileWeeklyPlanningVNextSchedulerInput, createWeeklyPlanningVNextSchedulerContext } from './weeklyPlanningVNextSchedulerGraph';

const context = { ownerId: 'owner', currentDate: '2026-11-02', planningStartDate: '2026-11-02', planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo' };
let counter = 0;
function turn(state: WeeklyPlanningVNextState, partial: Partial<VNextTurnDelta>): WeeklyPlanningVNextState {
  counter += 1;
  const result = applyWeeklyPlanningVNextTurn(state, { add: [], patch: [], remove: [], relate: [], defer: [], ...partial }, {
    acceptedDate: '2026-11-02', weekStartsOn: 'monday', planningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' },
    defaultPlanningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' }, turnKey: `t${counter}`, expectedRevision: state.graph.revision, conversationId: 'c', turnId: `t${counter}`, sourceText: 'fixture',
  });
  if (result.status !== 'applied') throw new Error(JSON.stringify('errors' in result ? result.errors : result.status));
  return result.state;
}
const task = (localId: string, title: string): VNextAddFact => ({ kind: 'task', localId, category: 'study', title });
const minutesWork = (localId: string, taskLocalId: string, amount: number): VNextAddWorkload => ({
  kind: 'workload', localId, taskRef: { localId: taskLocalId }, componentRef: null, quantityRole: 'remaining', amount,
  unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
});
const effort = (localId: string, taskLocalId: string, kind: 'session_duration' | 'total_duration', minutes: number): VNextAddFact => ({
  kind: 'effort_estimate', localId, taskRef: { localId: taskLocalId }, targetRef: { localId: taskLocalId },
  effortKind: kind, minutes, unitCode: null, unitLabel: null, precision: 'exact',
});
function compile(state: WeeklyPlanningVNextState) {
  const result = compileWeeklyPlanningVNextSchedulerInput({ state, projection: projectWeeklyPlanningVNext(state), context });
  if (result.status !== 'compiled') throw new Error('not ready');
  return result;
}

describe('VNext → Stable V5 scheduler bridge', () => {
  it('S02 keeps a stated session length: the same slices as V5 on the same graph', () => {
    const state = turn(createEmptyWeeklyPlanningVNextState(), { add: [task('t', '数学'), minutesWork('w', 't', 120), effort('s', 't', 'session_duration', 30)] });
    const v5 = compileGenericSchedulerInput({ graph: createWeeklyPlanningActiveSchedulerGraphViewV5(state.graph), context });
    const vnext = compile(state).compilation;
    const slices = (items: NonNullable<typeof vnext.input>['movableWorkItems']) => items.map((item) => item.estimatedMinutes);
    expect(slices(v5.input!.movableWorkItems)).toEqual([30, 30, 30, 30]);
    expect(slices(vnext.input!.movableWorkItems)).toEqual(slices(v5.input!.movableWorkItems));
  });

  it('S03 schedules ready work while a deferred task stays unplaced instead of blocking', () => {
    let state = turn(createEmptyWeeklyPlanningVNextState(), { add: [
      task('math', '数学'), minutesWork('m', 'math', 30),
      task('other', '英語'), { ...minutesWork('o', 'other', 5), unitCode: 'page', unitLabel: 'ページ' },
    ] });
    const [question] = projectWeeklyPlanningVNext(state).questions;
    state = turn(state, { defer: [{ questionKey: question.key }] });
    const result = compile(state);
    expect(result.compilation.status).toBe('ready');
    expect(result.compilation.input!.movableWorkItems.map((item) => item.baseEstimatedMinutes)).toEqual([30]);
    expect(result.unplacedOwnerKeys).toEqual([question.ownerKey]);
  });

  it('S04 names the stated task total, not a scheduling-only id, as the source of task-total work', () => {
    const state = turn(createEmptyWeeklyPlanningVNextState(), { add: [task('t', '読書'), effort('budget', 't', 'total_duration', 90)] });
    const [item] = compile(state).compilation.input!.movableWorkItems;
    const taskId = state.graph.tasks[0].id;
    const budgetId = state.graph.effortEstimates[0].id;
    expect(item.baseEstimatedMinutes).toBe(90);
    expect(item.estimateSourceFactIds).toEqual([budgetId]);
    expect([...item.sourceFactRefs].sort()).toEqual([budgetId, taskId].sort());
    expect(compile(state).compilation.input!.sourceFactRefs).toEqual(expect.arrayContaining([taskId, budgetId]));
    // workloadFactId is the scheduling-view lookup key by the V5 contract; provenance fields are canonical.
    const provenance = compile(state).compilation.input!.movableWorkItems
      .flatMap((work) => [...work.sourceFactRefs, ...work.estimateSourceFactIds, ...work.estimateSourceWorkloadFactIds]);
    expect(provenance.filter((id) => id.startsWith('vnext-'))).toEqual([]);
  });

  it('uses the renamed task in the scheduling view without losing its work', () => {
    let state = turn(createEmptyWeeklyPlanningVNextState(), { add: [task('t', '数学'), minutesWork('w', 't', 45)] });
    state = turn(state, { patch: [{ kind: 'task', localId: 'rename', targetFactId: state.graph.tasks[0].id, changes: { category: null, title: '数学II' } }] });
    const [item] = compile(state).compilation.input!.movableWorkItems;
    expect(item).toMatchObject({ taskId: state.graph.tasks[1].id, baseEstimatedMinutes: 45 });
  });

  it('derives the scheduling context from the state by V5 resolvers: a stated planning window is the horizon, else the selected week', () => {
    const requestContext = { startedAtIso: '2026-11-02T00:00:00.000Z', timeZone: 'Asia/Tokyo', currentDate: '2026-11-02', currentTime: '09:00',
      notBeforeDate: '2026-11-02', notBeforeTime: '09:00', weekStartsOn: 'monday' as const };
    const state = turn(createEmptyWeeklyPlanningVNextState(), { add: [task('t', '数学'), minutesWork('w', 't', 60)] });
    const week = createWeeklyPlanningVNextSchedulerContext({ state, ownerId: 'owner', selectedDate: '2026-11-02', requestContext });
    expect(week).toMatchObject({ planningStartDate: '2026-11-02', planningEndDate: '2026-11-08', weekStartsOn: 'monday',
      namedTimePeriods: WEEKLY_PLANNING_NAMED_TIME_PERIODS_V5 });
    // A planning window as VNext stores it (absolute at acceptance), placed directly until the typed delta can state it.
    const window = { id: 'pw', kind: 'absolute' as const, value: '2026-11-09/2026-11-15', start: '2026-11-09', end: '2026-11-15',
      source: state.graph.tasks[0].source, createdRevision: state.graph.revision };
    const windowed: WeeklyPlanningVNextState = { ...state, graph: { ...state.graph, planningWindows: [window],
      factLifecycles: [...state.graph.factLifecycles, { factId: 'pw', status: 'active', createdRevision: state.graph.revision,
        terminalRevision: null, supersededByFactId: null }] } };
    const next = createWeeklyPlanningVNextSchedulerContext({ state: windowed, ownerId: 'owner', selectedDate: '2026-11-02', requestContext });
    expect(next).toMatchObject({ planningStartDate: '2026-11-09', planningEndDate: '2026-11-15' });
    const compiled = compileWeeklyPlanningVNextSchedulerInput({ state: windowed, projection: projectWeeklyPlanningVNext(windowed), context: next });
    expect(compiled.status === 'compiled' && compiled.compilation.input?.horizon).toMatchObject({ startDate: '2026-11-09', endDate: '2026-11-15' });
  });
});
