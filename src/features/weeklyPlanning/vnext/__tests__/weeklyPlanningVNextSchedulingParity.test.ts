import { describe, expect, it } from 'vitest';
import type { MonthEvent } from '../../../../types/domain';
import { createWeeklyPlanningTurnRequestContext } from '../../application/weeklyPlanningTemporalContext';
import {
  projectWeeklyPlanningProvisionalTimeboxGraphV5,
  resolveWeeklyPlanningProvisionalTimeboxV5,
} from '../../application/weeklyPlanningStableV5ProvisionalTimebox';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { compileGenericSchedulerInput } from '../../semantic/weeklyPlanningGenericSchedulerInput';
import { createWeeklyPlanningPlacementGraphViewV5 } from '../../semantic/weeklyPlanningPlacementGraphViewV5';
import { scheduleWeeklyPlanningStableV5Preview } from '../../semantic/weeklyPlanningStableV5PreviewScheduler';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from '../semantic/weeklyPlanningVNextTransaction';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import { compileWeeklyPlanningVNextSchedulerInput } from '../projection/weeklyPlanningVNextSchedulerGraph';
import type { VNextAddEffort, VNextAddFact, VNextAddWorkload, VNextTurnDelta, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';

const START = '2026-11-02';
const OWNER = 'owner';
const TIME_ZONE = 'UTC';

type SchedulerContext = Parameters<typeof compileGenericSchedulerInput>[0]['context'];
type PlacementOptions = Parameters<typeof scheduleWeeklyPlanningStableV5Preview>[0];

const emptyDelta = (): VNextTurnDelta => ({ add: [], patch: [], remove: [], relate: [], defer: [] });

function context(startDate = START, endDate = START): SchedulerContext {
  return {
    ownerId: OWNER,
    currentDate: startDate,
    planningStartDate: startDate,
    planningEndDate: endDate,
    timeZone: TIME_ZONE,
    weekStartsOn: 'monday',
  };
}

function apply(state: WeeklyPlanningVNextState, delta: VNextTurnDelta): WeeklyPlanningVNextState {
  const result = applyWeeklyPlanningVNextTurn(state, delta, {
    expectedRevision: state.graph.revision,
    acceptedDate: START,
    planningHorizon: { startDate: START, endDate: '2026-11-08' },
    defaultPlanningHorizon: { startDate: START, endDate: '2026-11-08' },
    weekStartsOn: 'monday',
    conversationId: 'scheduler-parity',
    turnId: `turn-${state.graph.revision + 1}`,
    turnKey: `turn-${state.graph.revision + 1}`,
    sourceText: 'same typed scheduling meaning',
  });
  if (result.status !== 'applied') throw new Error(JSON.stringify(result));
  return result.state;
}

const task = (localId: string, title: string): VNextAddFact => ({ kind: 'task', localId, category: 'study', title });

const work = (
  localId: string,
  taskLocalId: string,
  amount: number,
  unitCode: 'minute' | 'hour' | 'page' | 'problem' = 'minute',
): VNextAddWorkload => ({
  kind: 'workload', localId, taskRef: { localId: taskLocalId }, componentRef: null,
  quantityRole: 'target', amount, unitCode,
  unitLabel: unitCode === 'minute' ? '分' : unitCode === 'hour' ? '時間' : unitCode === 'page' ? 'ページ' : '問',
  rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
});

const estimate = (
  localId: string,
  taskLocalId: string,
  targetLocalId: string,
  effortKind: 'duration_per_unit' | 'session_duration',
  minutes: number,
  unitCode: 'page' | 'problem' | null,
): VNextAddEffort => ({
  kind: 'effort_estimate', localId, taskRef: { localId: taskLocalId }, targetRef: { localId: targetLocalId },
  effortKind, minutes, unitCode, unitLabel: null, precision: 'exact',
});

const earliestStart = (localId: string, taskLocalId: string, date: string): VNextAddFact => ({
  kind: 'temporal_constraint', localId, taskRef: { localId: taskLocalId }, targetRef: { localId: taskLocalId },
  constraintKind: 'earliest_start', constraintLevel: 'hard', dateExpression: date,
  namedTimePeriod: null, startTime: null, endTime: null, precision: 'exact',
});

const dailyCapacity = (localId: string, date: string, minutes: number): VNextAddFact => ({
  kind: 'availability_declaration', localId, availabilityKind: 'capacity', dateExpression: date,
  namedTimePeriod: null, startTime: null, endTime: null, recurrenceKind: null, days: [],
  capacityMinutes: minutes, constraintLevel: 'hard',
});

function compileVNext(state: WeeklyPlanningVNextState, schedulerContext: SchedulerContext) {
  const result = compileWeeklyPlanningVNextSchedulerInput({ state, projection: projectWeeklyPlanningVNext(state), context: schedulerContext });
  if (result.status !== 'compiled' || result.compilation.status !== 'ready' || !result.compilation.input) {
    throw new Error(`VNext compiler was not ready: ${JSON.stringify(result)}`);
  }
  return { input: result.compilation.input, placementGraph: result.placementGraph };
}

function compileV5(state: WeeklyPlanningVNextState, schedulerContext: SchedulerContext, provisionalTimebox = false) {
  const activeGraph = createWeeklyPlanningActiveSchedulerGraphViewV5(state.graph);
  let schedulerGraph = activeGraph;
  let compilation = compileGenericSchedulerInput({ graph: schedulerGraph, context: schedulerContext });
  if (provisionalTimebox) {
    const resolution = resolveWeeklyPlanningProvisionalTimeboxV5({
      directive: { kind: 'provisional_timebox', scope: 'current_missing_effort' },
      previousState: null,
      currentCompilation: compilation,
      graph: activeGraph,
      graphRevision: state.graph.revision,
      turnId: 'turn-provisional-timebox',
    });
    const timeboxedGraph = projectWeeklyPlanningProvisionalTimeboxGraphV5({ graph: activeGraph, resolution });
    schedulerGraph = { ...activeGraph, workloads: timeboxedGraph.workloads, uncertainties: timeboxedGraph.uncertainties };
    compilation = compileGenericSchedulerInput({ graph: schedulerGraph, context: schedulerContext });
  }
  if (compilation.status !== 'ready' || !compilation.input) {
    throw new Error(`Stable V5 compiler was not ready: ${JSON.stringify(compilation)}`);
  }
  return {
    input: compilation.input,
    placementGraph: createWeeklyPlanningPlacementGraphViewV5({ ...activeGraph, workloads: schedulerGraph.workloads }),
  };
}

function compiledWorkSummary(input: ReturnType<typeof compileV5>['input']) {
  return input.movableWorkItems.map((item) => ({
    amount: item.quantity.amount,
    unitCode: item.quantity.unitCode,
    baseEstimatedMinutes: item.baseEstimatedMinutes,
    estimatedMinutes: item.estimatedMinutes,
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function candidateSummary(result: ReturnType<typeof scheduleWeeklyPlanningStableV5Preview>) {
  return result.candidates.map(({ date, startTime, endTime, durationMinutes, title }) => ({
    date, startTime, endTime, durationMinutes, title,
  }));
}

function comparePaths(
  state: WeeklyPlanningVNextState,
  schedulerContext: SchedulerContext,
  options: Omit<PlacementOptions, 'input' | 'graph'> = {},
  provisionalTimebox = false,
) {
  const next = compileVNext(state, schedulerContext);
  const stable = compileV5(state, schedulerContext, provisionalTimebox);
  const nextResult = scheduleWeeklyPlanningStableV5Preview({ input: next.input, graph: next.placementGraph, ...options });
  const stableResult = scheduleWeeklyPlanningStableV5Preview({ input: stable.input, graph: stable.placementGraph, ...options });

  expect(compiledWorkSummary(next.input)).toEqual(compiledWorkSummary(stable.input));
  expect(nextResult.status).toBe(stableResult.status);
  expect(candidateSummary(nextResult)).toEqual(candidateSummary(stableResult));
  return { nextInput: next.input, stableInput: stable.input, nextResult, stableResult };
}

describe('VNext bridge preserves Stable V5 scheduling behavior', () => {
  it('keeps the seven-day 6+1 reserve and ordinary-day ×1.5 soft cap, while a hard date may use reserve', () => {
    // Stable V5 sources: weeklyPlanningStableV5DistributionPolicy.ts, weeklyPlanningStableV5PlacementPolicy.ts.
    const add: VNextAddFact[] = [];
    for (let index = 0; index < 6; index += 1) {
      const taskId = `ordinary-${index + 1}`;
      add.push(task(taskId, `Ordinary ${index + 1}`), work(`ordinary-work-${index + 1}`, taskId, 120),
        estimate(`ordinary-cap-${index + 1}`, taskId, taskId, 'session_duration', 120, null));
    }
    add.push(task('reserve', 'Hard-date reserve'), work('reserve-work', 'reserve', 60), earliestStart('reserve-date', 'reserve', '2026-11-08'));
    const state = apply(createEmptyWeeklyPlanningVNextState(), { ...emptyDelta(), add });
    const compared = comparePaths(state, context(START, '2026-11-08'));
    const perDate = new Map<string, number>();
    for (const candidate of compared.nextResult.candidates) {
      perDate.set(candidate.date, (perDate.get(candidate.date) ?? 0) + candidate.durationMinutes);
    }
    expect(perDate.get('2026-11-08')).toBe(60);
    expect([...perDate.keys()].sort()).toEqual([
      '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08',
    ]);
    const estimatedTotal = compared.nextInput.movableWorkItems.reduce((sum, item) => sum + (item.estimatedMinutes ?? 0), 0);
    const ordinarySoftCap = estimatedTotal / 6 * 1.5;
    for (const [date, minutes] of perDate) if (date !== '2026-11-08') expect(minutes).toBeLessThanOrEqual(ordinarySoftCap);
  });

  it.each([
    { base: 56, expected: 65, step: 5 as const },
    { base: 70, expected: 90, step: 15 as const },
  ])('applies the ×1.1 estimate buffer and $step-minute upward rounding for a $base-minute base', ({ base, expected, step }) => {
    // Stable V5 source: weeklyPlanningEffortAllocation.ts.
    const state = apply(createEmptyWeeklyPlanningVNextState(), { ...emptyDelta(), add: [
      task('task', 'Reading'), work('pages', 'task', base, 'page'), estimate('rate', 'task', 'pages', 'duration_per_unit', 1, 'page'),
    ] });
    const compared = comparePaths(state, context());
    expect(compared.nextInput.movableWorkItems[0]).toMatchObject({
      baseEstimatedMinutes: base, estimatedMinutes: expected, roundingStepMinutes: step,
    });
  });

  it.each([
    { amount: 60, unitCode: 'minute' as const, unitLabel: '分' },
    { amount: 1, unitCode: 'hour' as const, unitLabel: '時間' },
  ])('adds no estimate buffer to intrinsic $unitCode work', ({ amount, unitCode, unitLabel }) => {
    // Stable V5 source: weeklyPlanningGenericWorkItems.ts (intrinsic_duration).
    const state = apply(createEmptyWeeklyPlanningVNextState(), { ...emptyDelta(), add: [
      task('task', 'Study'), { ...work('work', 'task', amount, unitCode), unitLabel },
    ] });
    const compared = comparePaths(state, context());
    expect(compared.nextInput.movableWorkItems[0]).toMatchObject({ baseEstimatedMinutes: 60, estimatedMinutes: 60 });
  });

  it('keeps the provisional timebox at exactly60 minutes in both compilation paths', () => {
    // Stable V5 sources: weeklyPlanningStableV5ProvisionalTimebox.ts and its policy test.
    let state = apply(createEmptyWeeklyPlanningVNextState(), { ...emptyDelta(), add: [task('task', 'Open study work')] });
    const [question] = projectWeeklyPlanningVNext(state).questions;
    expect(question.code).toBe('missing_schedulable_work');
    state = apply(state, { ...emptyDelta(), defer: [{ questionKey: question.key, allocation: 'provisional_timebox' }] });
    const compared = comparePaths(state, context(), {}, true);
    expect(compared.nextInput.movableWorkItems).toHaveLength(1);
    expect(compared.nextInput.movableWorkItems[0]).toMatchObject({ baseEstimatedMinutes: 60, estimatedMinutes: 60 });
    expect(compared.nextResult.candidates.reduce((sum, candidate) => sum + candidate.durationMinutes, 0)).toBe(60);
  });

  it('applies an explicit session cap before distributing estimate margin', () => {
    // Stable V5 source: weeklyPlanningOriginalSessionCapBaseline.test.ts.
    const state = apply(createEmptyWeeklyPlanningVNextState(), { ...emptyDelta(), add: [
      task('task', 'Math'), work('problems', 'task', 20, 'problem'),
      estimate('rate', 'task', 'problems', 'duration_per_unit', 3, 'problem'),
      estimate('cap', 'task', 'task', 'session_duration', 30, null),
    ] });
    const compared = comparePaths(state, context());
    expect(compared.nextResult.candidates.map((candidate) => candidate.durationMinutes)).toEqual([30, 30]);
    expect(compared.nextInput.movableWorkItems.map((item) => item.estimatedMinutes)).toEqual([30, 30]);
  });

  it('keeps the default ten-minute break between intended sessions', () => {
    // Stable V5 source: weeklyPlanningTemporalWorkSemanticsV5.test.ts, 180-minute session policy case.
    const state = apply(createEmptyWeeklyPlanningVNextState(), { ...emptyDelta(), add: [
      task('task', 'Long study'), work('work', 'task', 180),
    ] });
    const compared = comparePaths(state, context());
    expect(compared.nextResult.candidates.map(({ startTime, endTime, durationMinutes }) => ({ startTime, endTime, durationMinutes })))
      .toEqual([{ startTime: '09:00', endTime: '10:30', durationMinutes: 90 }, { startTime: '10:40', endTime: '12:10', durationMinutes: 90 }]);
  });

  it('rounds request-time notBefore up to the minute without adding a legacy preparation delay', () => {
    // Stable V5 source: weeklyPlanningTemporalContext.ts and weeklyPlanningStableV5PreviewSchedulerNotBefore.test.ts.
    const request = createWeeklyPlanningTurnRequestContext({
      startedAtIso: '2026-11-02T14:55:12.000Z', timeZone: TIME_ZONE, weekStartsOn: 'monday',
    });
    expect(request.notBeforeTime).toBe('14:56');
    const state = apply(createEmptyWeeklyPlanningVNextState(), { ...emptyDelta(), add: [task('task', 'Study'), work('work', 'task', 60)] });
    const compared = comparePaths(state, context(request.currentDate), { notBefore: { date: request.notBeforeDate, time: request.notBeforeTime } });
    expect(compared.nextResult.candidates[0]).toMatchObject({ date: START, startTime: '14:56', endTime: '15:56' });
  });

  it('honors a busy calendar event and typed daily capacity on the same two-day horizon', () => {
    // Stable V5 sources: weeklyPlanningStableV5PlacementAvailability.ts and weeklyPlanningDailyCapacityResolverV5.ts.
    const state = apply(createEmptyWeeklyPlanningVNextState(), { ...emptyDelta(), add: [
      task('first', 'First study'), work('first-work', 'first', 60),
      task('second', 'Second study'), work('second-work', 'second', 60),
      dailyCapacity('capacity-first', '2026-11-02', 60), dailyCapacity('capacity-second', '2026-11-03', 60),
    ] });
    const busyEvent: MonthEvent = {
      id: 'busy-event', userId: OWNER, date: '2026-11-02', title: 'Busy', startTime: '09:00', endTime: '10:00',
      repeat: 'none', repeatUntil: null, excludedDates: [], url: '', memo: '', checklist: [], locationTags: [],
      createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
    };
    const compared = comparePaths(state, context(START, '2026-11-03'), { monthEvents: [busyEvent] });
    // The busy interval has the current ten-minute buffer, then the placement search adds its default ten-minute break.
    expect(compared.nextResult.candidates.map(({ date, startTime, endTime, durationMinutes }) => ({ date, startTime, endTime, durationMinutes })))
      .toEqual([
        { date: '2026-11-02', startTime: '10:20', endTime: '11:20', durationMinutes: 60 },
        { date: '2026-11-03', startTime: '09:00', endTime: '10:00', durationMinutes: 60 },
      ]);
  });
});
