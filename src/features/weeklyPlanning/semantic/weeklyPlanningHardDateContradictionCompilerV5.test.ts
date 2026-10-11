import { resolveWeeklyPlanningDateExpressionsV5 } from './weeklyPlanningResolvedDateExpressionsV5';
import { createWeeklyPlanningPlacementGraphViewV5 } from './weeklyPlanningPlacementGraphViewV5';
import { scheduleWeeklyPlanningStableV5Preview } from './weeklyPlanningStableV5PreviewScheduler';
import { resolveWeeklyPlanningTemporalConstraintsV5 } from './weeklyPlanningResolvedTemporalConstraintsV5';
import { createWeeklyPlanningTurnRequestContext, createWeeklyPlanningSchedulerContext,
  resolveWeeklyPlanningPlanningHorizon } from '../application/weeklyPlanningTemporalContext';
import { describe, expect, it } from 'vitest';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './weeklyPlanningActiveSchedulerGraphViewV5';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type PlanningFactLifecycleEntryV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import { compileGenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';

function source(id: string) {
  return {
    conversationId: 'hard-date-contradiction',
    turnId: 'turn-1',
    semanticLocalId: id,
    sourceText: id,
    origin: 'user' as const,
  };
}

function active(factId: string): PlanningFactLifecycleEntryV5 {
  return {
    factId,
    status: 'active',
    createdRevision: 1,
    terminalRevision: null,
    supersededByFactId: null,
  };
}

function graph(perOccurrence: boolean): WeeklyPlanningFactGraphV5 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 1,
    tasks: [{
      id: 'task-1',
      category: 'study',
      title: 'レポート',
      source: source('task-1'),
      createdRevision: 1,
    }],
    workloads: [{
      id: 'workload-1',
      taskId: 'task-1',
      componentId: null,
      quantityRole: 'target',
      amount: 1,
      unitCode: 'hour',
      unitLabel: '時間',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence,
      periodExpression: perOccurrence ? '毎日' : null,
      source: source('workload-1'),
      createdRevision: 1,
    }],
    temporalConstraints: [
      {
        id: 'earliest-1',
        taskId: 'task-1',
        targetFactId: 'task-1',
        kind: 'earliest_start',
        constraintLevel: 'hard',
        dateExpression: '2026-08-30',
        namedTimePeriod: null,
        startTime: '09:00',
        endTime: null,
        precision: 'exact',
        source: source('earliest-1'),
        createdRevision: 1,
      },
      {
        id: 'deadline-1',
        taskId: 'task-1',
        targetFactId: 'task-1',
        kind: 'deadline',
        constraintLevel: 'hard',
        dateExpression: '2026-08-27',
        namedTimePeriod: null,
        startTime: null,
        endTime: null,
        precision: 'exact',
        source: source('deadline-1'),
        createdRevision: 1,
      },
    ],
    recurrences: perOccurrence
      ? [{
          id: 'recurrence-1',
          taskId: 'task-1',
          targetFactId: 'task-1',
          kind: 'daily',
          count: null,
          days: [],
          source: source('recurrence-1'),
          createdRevision: 1,
        }]
      : [],
    factLifecycles: [
      active('task-1'),
      active('workload-1'),
      active('earliest-1'),
      active('deadline-1'),
      ...(perOccurrence ? [active('recurrence-1')] : []),
    ],
  };
}

function compile(perOccurrence: boolean) {
  return compileGenericSchedulerInput({
    graph: createWeeklyPlanningActiveSchedulerGraphViewV5(graph(perOccurrence)),
    context: {
      ownerId: 'owner-1',
      currentDate: '2026-08-26',
      planningStartDate: '2026-08-26',
      planningEndDate: '2026-09-01',
      timeZone: 'Asia/Tokyo',
    },
  });
}

describe('weekly planning hard date contradiction compiler boundary', () => {
  it.each([false, true])(
    'returns needs_resolution before distribution or placement (perOccurrence=%s)',
    (perOccurrence) => {
      const result = compile(perOccurrence);

      expect(result.status).toBe('needs_resolution');
      expect(result.input).toBeNull();
      expect(result.issues).toContainEqual(expect.objectContaining({
        domain: 'temporal_constraint',
        code: 'contradictory_hard_date_bound',
        blocking: true,
        details: expect.objectContaining({
          taskId: 'task-1',
          targetFactId: 'task-1',
          startDate: '2026-08-30',
          endDate: '2026-08-27',
        }),
      }));
    },
  );
});

// Existing C2 controls; the helper uses the current absolute-window owner without C1 accepted-period APIs.
function acceptedTemporalScopeGraph(
  form: 'task' | 'plan',
  dateExpression: string,
): WeeklyPlanningFactGraphV5 {
  const value = graph(false);
  value.planningWindows = [{
    id: 'window-1', kind: 'absolute', value: '2026-10-12/2026-10-13',
    start: '2026-10-12', end: '2026-10-13',
    source: source('window-1'), createdRevision: 1,
  }];
  value.temporalConstraints = form === 'task' ? [{
    ...value.temporalConstraints[0], id: 'preference-1', kind: 'preferred_window',
    constraintLevel: 'soft', dateExpression, startTime: '20:00', endTime: '22:00',
    source: source('preference-1'),
  }] : [];
  value.availabilityDeclarations = form === 'plan' ? [{
    id: 'preference-1', kind: 'preferred', dateExpression,
    namedTimePeriod: null, startTime: '20:00', endTime: '22:00',
    recurrenceKind: null, days: [], constraintLevel: 'soft', resolutionStatus: 'unresolved',
    source: source('preference-1'), createdRevision: 1,
  }] : [];
  value.factLifecycles = ['task-1', 'workload-1', 'window-1', 'preference-1'].map(active);
  return value;
}

const scopeRequest = createWeeklyPlanningTurnRequestContext({
  startedAtIso: '2026-10-08T03:00:00.000Z', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday',
});

type TemporalSnapshots = Pick<Parameters<typeof compileGenericSchedulerInput>[0],
  'resolvedDateExpressions' | 'resolvedTemporalConstraints'>;

function compileTemporalScope(value: WeeklyPlanningFactGraphV5, snapshots: TemporalSnapshots = {}) {
  const activeGraph = createWeeklyPlanningActiveSchedulerGraphViewV5(value);
  const horizon = resolveWeeklyPlanningPlanningHorizon({
    graph: activeGraph, selectedDate: '2026-10-12', requestContext: scopeRequest,
    resolvedTemporalConstraints: resolveWeeklyPlanningTemporalConstraintsV5({
      graph: activeGraph, currentDate: scopeRequest.currentDate,
      weekStartsOn: scopeRequest.weekStartsOn,
    }),
  });
  return compileGenericSchedulerInput({
    graph: activeGraph,
    context: createWeeklyPlanningSchedulerContext({
      ownerId: 'owner-1', horizon, requestContext: scopeRequest,
    }),
    ...snapshots,
  });
}

function hardClockScopeGraph(params: {
  kind: 'earliest_start' | 'latest_end' | 'deadline';
  dateExpression: string | null;
  time: string;
  daily?: boolean;
}): WeeklyPlanningFactGraphV5 {
  const value = acceptedTemporalScopeGraph('task', '2026-10-12');
  value.temporalConstraints = [{
    ...value.temporalConstraints[0], id: 'hard-clock-1', kind: params.kind,
    constraintLevel: 'hard', dateExpression: params.dateExpression,
    startTime: params.kind === 'earliest_start' ? params.time : null,
    endTime: params.kind === 'earliest_start' ? null : params.time,
    source: source('hard-clock-1'),
  }];
  value.factLifecycles = value.factLifecycles.filter(entry => entry.factId !== 'preference-1');
  value.factLifecycles.push(active('hard-clock-1'));
  if (params.daily) {
    value.recurrences = [{ id: 'daily-1', taskId: 'task-1', targetFactId: 'task-1',
      kind: 'daily', count: null, days: [], source: source('daily-1'), createdRevision: 1 }];
    value.factLifecycles.push(active('daily-1'));
  }
  return value;
}

function placeHardClockScope(value: WeeklyPlanningFactGraphV5, notBeforeDate = '2026-10-12', snapshots: TemporalSnapshots = {}) {
  const before = structuredClone(value);
  const compilation = compileTemporalScope(value, snapshots);
  expect(compilation.status).toBe('ready');
  if (!compilation.input) throw new Error('Expected a schedulable hard-clock fixture');
  const inputBefore = structuredClone(compilation.input);
  const scheduled = scheduleWeeklyPlanningStableV5Preview({
    input: compilation.input,
    graph: createWeeklyPlanningPlacementGraphViewV5(createWeeklyPlanningActiveSchedulerGraphViewV5(value)),
    notBefore: { date: notBeforeDate, time: '09:00' },
  });
  expect(value).toEqual(before);
  expect(compilation.input).toEqual(inputBefore);
  return { input: compilation.input, scheduled };
}

describe('typed task hard-clock placement controls', () => {
  it.each([
    { name: 'dateless lower bound without recurrence', kind: 'earliest_start', date: null, time: '20:00',
      daily: false, placeDate: '2026-10-12', lower: '20:00', upper: null },
    { name: 'dateless daily lower bound on a later day', kind: 'earliest_start', date: null, time: '20:00',
      daily: true, placeDate: '2026-10-13', lower: '20:00', upper: null },
    { name: 'dateless upper bound defeats a late soft preference', kind: 'latest_end', date: null, time: '13:00',
      daily: false, placeDate: '2026-10-12', lower: '09:00', upper: '13:00' },
    { name: 'absolute lower bound on its boundary day', kind: 'earliest_start', date: '2026-10-12', time: '20:00',
      daily: false, placeDate: '2026-10-12', lower: '20:00', upper: null },
    { name: 'absolute lower bound does not repeat on later days', kind: 'earliest_start', date: '2026-10-12', time: '20:00',
      daily: false, placeDate: '2026-10-13', lower: '09:00', upper: null },
    { name: 'absolute upper bound on its boundary day', kind: 'latest_end', date: '2026-10-13', time: '13:00',
      daily: false, placeDate: '2026-10-13', lower: '09:00', upper: '13:00' },
    { name: 'absolute upper bound does not repeat on earlier days', kind: 'latest_end', date: '2026-10-13', time: '13:00',
      daily: false, placeDate: '2026-10-12', lower: '20:00', upper: null },
    { name: 'absolute deadline clock caps completion on its boundary day', kind: 'deadline', date: '2026-10-13', time: '13:00',
      daily: false, placeDate: '2026-10-13', lower: '09:00', upper: '13:00' },
  ] as const)('$name', ({ kind, date, time, daily, placeDate, lower, upper }) => {
    const value = hardClockScopeGraph({ kind, dateExpression: date, time, daily });
    if (kind !== 'earliest_start') {
      value.temporalConstraints.push({
        ...value.temporalConstraints[0], id: 'late-preference', kind: 'preferred_window', constraintLevel: 'soft',
        dateExpression: null, startTime: '20:00', endTime: '22:00', source: source('late-preference'),
      });
      value.factLifecycles.push(active('late-preference'));
    }
    const { input, scheduled } = placeHardClockScope(value, placeDate);
    expect(input.movableWorkItems).toHaveLength(1); // recurrence must not manufacture another total workload
    expect(input.movableWorkItems[0]).toMatchObject({ baseEstimatedMinutes: 60, estimatedMinutes: 60, estimateBasis: 'intrinsic_duration' });
    expect(scheduled.status).toBe('ready');
    expect(scheduled.unscheduledWorkItemIds).toEqual([]);
    expect(scheduled.candidates).toHaveLength(1);
    expect(scheduled.candidates[0]).toMatchObject({ date: placeDate, startTime: lower, durationMinutes: 60 });
    if (upper) expect(scheduled.candidates[0].endTime <= upper).toBe(true);
    expect(input.sourceFactRefs).toContain('hard-clock-1');
  });

  it.each(['task-1', 'component-1'] as const)('keeps hard-clock inheritance scoped to %s', (targetFactId) => {
    const value = hardClockScopeGraph({ kind: 'earliest_start', dateExpression: null, time: '20:00' });
    value.temporalConstraints[0].targetFactId = targetFactId;
    if (targetFactId === 'component-1') {
      value.planningWindows[0].end = '2026-10-12';
      value.planningWindows[0].value = '2026-10-12/2026-10-12';
    }
    value.components = ['component-1', 'component-2'].map(id => ({
      id, taskId: 'task-1', parentComponentId: null, role: 'section' as const, label: id,
      source: source(id), createdRevision: 1,
    }));
    value.workloads = value.components.map((component, index) => ({
      ...value.workloads[0], id: `workload-${index + 1}`, componentId: component.id,
    }));
    value.factLifecycles.push(...['component-1', 'component-2', 'workload-2'].map(active));
    const { input, scheduled } = placeHardClockScope(value);
    expect(scheduled.status).toBe('ready');
    expect(scheduled.candidates).toHaveLength(2);
    expect(scheduled.unscheduledWorkItemIds).toEqual([]);
    for (const component of value.components) {
      const item = input.movableWorkItems.find(item => item.componentId === component.id);
      const candidate = scheduled.candidates.find(candidate => candidate.workItemKey === item?.id);
      if (!candidate) throw new Error(`Expected work for ${component.id}`);
      expect(candidate.durationMinutes).toBe(60);
      expect(candidate.startTime >= '20:00').toBe(targetFactId === 'task-1' || component.id === 'component-1');
      if (targetFactId === 'component-1') {
        expect(candidate.date).toBe('2026-10-12');
        expect(candidate.startTime).toBe(component.id === 'component-1' ? '20:00' : '09:00');
      }
    }
    expect(input.hardClockBounds).toEqual([{ taskId: 'task-1', targetFactId, sourceFactId: 'hard-clock-1',
      kind: 'earliest_start', minute: 1200, anchorDate: null }]);
    // Reusing the same compiled input cannot inherit another item's clock mask.
    expect(scheduleWeeklyPlanningStableV5Preview({ input, graph: createWeeklyPlanningPlacementGraphViewV5(
      createWeeklyPlanningActiveSchedulerGraphViewV5(value)), notBefore: { date: '2026-10-12', time: '09:00' },
    })).toEqual(scheduled);
  });

  it('fails closed when the remaining hard-clock interval cannot fit the current single chunk', () => {
    const value = hardClockScopeGraph({ kind: 'earliest_start', dateExpression: null, time: '21:30' });
    value.temporalConstraints.push({
      ...value.temporalConstraints[0], id: 'hard-clock-end', kind: 'latest_end',
      startTime: null, endTime: '22:00', source: source('hard-clock-end'),
    });
    value.factLifecycles.push(active('hard-clock-end'));
    const { input, scheduled } = placeHardClockScope(value);
    // This intrinsic one-hour item is one current chunk; the typed 21:30–22:00 window has only30 minutes.
    expect(input.movableWorkItems[0]).toMatchObject({
      baseEstimatedMinutes: 60, estimatedMinutes: 60, estimateBasis: 'intrinsic_duration', splitPolicy: 'splittable',
    });
    expect(scheduled.status).toBe('insufficient_capacity');
    expect(scheduled.candidates).toEqual([]);
    expect(scheduled.unscheduledWorkItemIds).toEqual([input.movableWorkItems[0].id]);
  });

  it('preserves date clipping before an absolute earliest clock', () => {
    const value = hardClockScopeGraph({ kind: 'earliest_start', dateExpression: '2026-10-13', time: '20:00' });
    const { input, scheduled } = placeHardClockScope(value);
    expect(input.hardDateBounds[0].startDate).toBe('2026-10-13');
    expect(scheduled.candidates).toHaveLength(1);
    expect(scheduled.candidates[0]).toMatchObject({ date: '2026-10-13', startTime: '20:00' });
  });

  it.each(['latest_end', 'deadline'] as const)('preserves date clipping after an absolute %s clock', kind => {
    const value = hardClockScopeGraph({ kind, dateExpression: '2026-10-12', time: '13:00' });
    const { input, scheduled } = placeHardClockScope(value, '2026-10-13');
    expect(input.hardDateBounds[0].endDate).toBe('2026-10-12');
    expect(scheduled.status).toBe('insufficient_capacity');
    expect(scheduled.candidates).toEqual([]);
    expect(scheduled.unscheduledWorkItemIds).toEqual([input.movableWorkItems[0].id]);
  });

  it('keeps a dateless clock alongside a separate absolute lower bound', () => {
    const value = hardClockScopeGraph({ kind: 'earliest_start', dateExpression: null, time: '20:00' });
    value.temporalConstraints.push({ ...value.temporalConstraints[0], id: 'absolute-start',
      dateExpression: '2026-10-13', startTime: '09:00', source: source('absolute-start') });
    value.factLifecycles.push(active('absolute-start'));
    const { input, scheduled } = placeHardClockScope(value);
    expect(input.hardClockBounds).toEqual([
      { taskId: 'task-1', targetFactId: 'task-1', sourceFactId: 'hard-clock-1', kind: 'earliest_start', minute: 1200, anchorDate: null },
      { taskId: 'task-1', targetFactId: 'task-1', sourceFactId: 'absolute-start', kind: 'earliest_start', minute: 540, anchorDate: '2026-10-13' },
    ]);
    expect(scheduled.candidates).toHaveLength(1);
    expect(scheduled.candidates[0]).toMatchObject({ date: '2026-10-13', startTime: '20:00' });
  });

  it('retains a dateless accepted clock snapshot before a workload is supplied', () => {
    const value = hardClockScopeGraph({ kind: 'earliest_start', dateExpression: null, time: '20:00' });
    const [workload] = value.workloads;
    value.workloads = [];
    const resolvedTemporalConstraints = resolveWeeklyPlanningTemporalConstraintsV5({
      graph: createWeeklyPlanningActiveSchedulerGraphViewV5(value), currentDate: scopeRequest.currentDate,
      weekStartsOn: scopeRequest.weekStartsOn,
    });
    expect(resolvedTemporalConstraints.hardClockBounds).toEqual([{ taskId: 'task-1', targetFactId: 'task-1',
      sourceFactId: 'hard-clock-1', kind: 'earliest_start', minute: 1200, anchorDate: null }]);
    value.workloads = [workload];
    const compilation = compileGenericSchedulerInput({
      graph: createWeeklyPlanningActiveSchedulerGraphViewV5(value), resolvedTemporalConstraints,
      context: { ownerId: 'owner-1', currentDate: scopeRequest.currentDate, planningStartDate: '2026-10-12',
        planningEndDate: '2026-10-13', timeZone: scopeRequest.timeZone },
    });
    expect(compilation.status).toBe('ready');
    if (!compilation.input) throw new Error('Expected the supplied workload to compile');
    const scheduled = scheduleWeeklyPlanningStableV5Preview({ input: compilation.input,
      graph: createWeeklyPlanningPlacementGraphViewV5(createWeeklyPlanningActiveSchedulerGraphViewV5(value)) });
    expect(scheduled.candidates).toHaveLength(1);
    expect(scheduled.candidates[0].startTime).toBe('20:00');
  });

  it.each(['current', 'retired', 'other-task'] as const)('materializes current targets from the supplied date snapshot (source=%s)', mode => {
    const value = hardClockScopeGraph({ kind: 'earliest_start', dateExpression: 'tomorrow', time: '20:00' });
    const workloads = value.workloads;
    value.workloads = [];
    const beforeWork = createWeeklyPlanningActiveSchedulerGraphViewV5(value);
    const resolvedDateExpressions = resolveWeeklyPlanningDateExpressionsV5({ graph: beforeWork,
      currentDate: '2026-10-11', weekStartsOn: 'monday' });
    const resolvedTemporalConstraints = resolveWeeklyPlanningTemporalConstraintsV5({ graph: beforeWork,
      currentDate: '2026-10-11', resolvedDateExpressions });
    expect(resolvedTemporalConstraints.hardDateBounds).toEqual([]);
    expect(resolvedTemporalConstraints.hardClockBounds[0].anchorDate).toBe('2026-10-12');
    value.workloads = workloads;
    if (mode === 'retired') {
      Object.assign(value.factLifecycles.find(entry => entry.factId === 'hard-clock-1')!, {
        status: 'removed', terminalRevision: 2,
      });
      value.revision = 2;
    }
    if (mode === 'other-task') {
      value.tasks.push({ ...value.tasks[0], id: 'task-2', title: '物理', source: source('task-2') });
      value.workloads.push({ ...workloads[0], id: 'workload-2', taskId: 'task-2', source: source('workload-2') });
      value.factLifecycles.push(active('task-2'), active('workload-2'));
    }
    const { input, scheduled } = placeHardClockScope(value, '2026-10-12', { resolvedDateExpressions, resolvedTemporalConstraints });
    // The compiler request reference is Oct8; reparsing tomorrow would incorrectly produce Oct9.
    expect(input.hardDateBounds).toEqual(mode === 'retired' ? [] : [{ taskId: 'task-1', targetFactId: 'task-1',
      startDate: '2026-10-12', endDate: null, sourceFactIds: ['hard-clock-1'] }]);
    const firstWork = input.movableWorkItems.find(item => item.taskId === 'task-1');
    const first = scheduled.candidates.find(candidate => candidate.workItemKey === firstWork?.id);
    expect(first?.startTime).toBe(mode === 'retired' ? '09:00' : '20:00');
    if (mode === 'retired') {
      expect(input.hardClockBounds).toEqual([]);
      expect(input.sourceFactRefs).not.toContain('hard-clock-1');
    }
    if (mode === 'other-task') {
      const otherWork = input.movableWorkItems.find(item => item.taskId === 'task-2');
      expect(scheduled.candidates.find(candidate => candidate.workItemKey === otherWork?.id)?.startTime).toBe('09:00');
    }
    expect(resolvedTemporalConstraints.hardDateBounds).toEqual([]); // Caller-owned snapshot stays unchanged.
  });

  it('preserves a standalone temporal snapshot without reinterpreting its date at the current clock', () => {
    const value = hardClockScopeGraph({ kind: 'earliest_start', dateExpression: 'tomorrow', time: '20:00' });
    const resolvedTemporalConstraints = resolveWeeklyPlanningTemporalConstraintsV5({
      graph: createWeeklyPlanningActiveSchedulerGraphViewV5(value), currentDate: '2026-10-11',
    });
    const before = structuredClone(resolvedTemporalConstraints);
    const { input, scheduled } = placeHardClockScope(value, '2026-10-12', { resolvedTemporalConstraints });
    expect(input.horizon.referenceDate).toBe('2026-10-08');
    expect(input.hardDateBounds).toEqual([{ taskId: 'task-1', targetFactId: 'task-1',
      startDate: '2026-10-12', endDate: null, sourceFactIds: ['hard-clock-1'] }]);
    expect(input.hardClockBounds![0].anchorDate).toBe('2026-10-12');
    expect(scheduled.candidates[0]).toMatchObject({ date: '2026-10-12', startTime: '20:00' });
    expect(resolvedTemporalConstraints).toEqual(before);
  });

  it('detects contradictory dates for newly supplied work before placement', () => {
    const value = hardClockScopeGraph({ kind: 'earliest_start', dateExpression: '2026-10-13', time: '20:00' });
    value.temporalConstraints.push({ ...value.temporalConstraints[0], id: 'upper-clock', kind: 'latest_end',
      dateExpression: '2026-10-12', startTime: null, endTime: '13:00', source: source('upper-clock') });
    value.factLifecycles.push(active('upper-clock'));
    const workloads = value.workloads;
    value.workloads = [];
    const activeGraph = createWeeklyPlanningActiveSchedulerGraphViewV5(value);
    const resolvedDateExpressions = resolveWeeklyPlanningDateExpressionsV5({ graph: activeGraph, currentDate: scopeRequest.currentDate });
    const resolvedTemporalConstraints = resolveWeeklyPlanningTemporalConstraintsV5({ graph: activeGraph,
      currentDate: scopeRequest.currentDate, resolvedDateExpressions });
    expect(resolvedTemporalConstraints.hardDateBounds).toEqual([]);
    value.workloads = workloads;
    const compilation = compileTemporalScope(value, { resolvedDateExpressions, resolvedTemporalConstraints });
    expect(compilation.status).toBe('needs_resolution');
    expect(compilation.input).toBeNull();
    expect(compilation.issues).toContainEqual(expect.objectContaining({ code: 'contradictory_hard_date_bound', blocking: true,
      details: expect.objectContaining({ taskId: 'task-1', startDate: '2026-10-13', endDate: '2026-10-12' }) }));
  });

  it('uses only the active replacement clock and its source identity', () => {
    const value = hardClockScopeGraph({ kind: 'earliest_start', dateExpression: null, time: '20:00' });
    Object.assign(value.factLifecycles.find(entry => entry.factId === 'hard-clock-1')!, {
      status: 'superseded', terminalRevision: 2, supersededByFactId: 'replacement-clock',
    });
    value.temporalConstraints.push({ ...value.temporalConstraints[0], id: 'replacement-clock',
      startTime: '17:00', source: source('replacement-clock'), createdRevision: 2 });
    value.factLifecycles.push({ ...active('replacement-clock'), createdRevision: 2 });
    value.revision = 2;
    const { input, scheduled } = placeHardClockScope(value);
    expect(input.hardClockBounds).toEqual([{ taskId: 'task-1', targetFactId: 'task-1',
      sourceFactId: 'replacement-clock', kind: 'earliest_start', minute: 1020, anchorDate: null }]);
    expect(input.sourceFactRefs).toContain('replacement-clock');
    expect(input.sourceFactRefs).not.toContain('hard-clock-1');
    expect(scheduled.candidates[0].startTime).toBe('17:00');
  });

  it.each(['none', 'overlap', 'empty'] as const)('intersects early preference and existing hard availability without dropping an empty mask (available=%s)', available => {
    const value = hardClockScopeGraph({ kind: 'earliest_start', dateExpression: null, time: '20:00' });
    value.temporalConstraints.push({ ...value.temporalConstraints[0], id: 'early-preference', kind: 'preferred_window',
      constraintLevel: 'soft', startTime: '09:00', endTime: '11:00', source: source('early-preference') });
    value.factLifecycles.push(active('early-preference'));
    if (available !== 'none') {
      value.availabilityDeclarations = [{ id: 'hard-available', kind: 'available', dateExpression: null,
        startTime: available === 'overlap' ? '19:30' : '09:00',
        endTime: available === 'overlap' ? '21:30' : '11:00', namedTimePeriod: null, recurrenceKind: 'daily', days: [],
        constraintLevel: 'hard', resolutionStatus: 'unresolved', source: source('hard-available'), createdRevision: 1 }];
      value.factLifecycles.push(active('hard-available'));
    }
    const { input, scheduled } = placeHardClockScope(value);
    if (available !== 'none') expect(input.availabilityWindows).toHaveLength(2);
    if (available === 'empty') {
      expect(scheduled.status).toBe('insufficient_capacity');
      expect(scheduled.candidates).toEqual([]);
      expect(scheduled.unscheduledWorkItemIds).toEqual([input.movableWorkItems[0].id]);
    } else {
      expect(scheduled.status).toBe('ready');
      expect(scheduled.candidates[0].startTime).toBe('20:00');
    }
  });

  it.each([false, true])('does not manufacture evening availability from a date-only preference (explicitClock=%s)', explicitClock => {
    const value = hardClockScopeGraph({ kind: 'earliest_start', dateExpression: null, time: '22:30' });
    value.temporalConstraints.push({ ...value.temporalConstraints[0], id: 'late-date-preference',
      kind: 'preferred_window', constraintLevel: 'soft', dateExpression: '2026-10-12',
      startTime: explicitClock ? '22:45' : null, endTime: explicitClock ? '23:45' : null,
      source: source('late-date-preference') });
    value.factLifecycles.push(active('late-date-preference'));
    const { input, scheduled } = placeHardClockScope(value);
    expect(scheduled.status).toBe(explicitClock ? 'ready' : 'insufficient_capacity');
    if (explicitClock) expect(scheduled.candidates[0]).toMatchObject({ date: '2026-10-12', startTime: '22:45', endTime: '23:45' });
    else {
      expect(scheduled.candidates).toEqual([]);
      expect(scheduled.unscheduledWorkItemIds).toEqual([input.movableWorkItems[0].id]);
    }
  });

  it('does not reinterpret contradictory independent clocks as overnight availability', () => {
    const value = hardClockScopeGraph({ kind: 'earliest_start', dateExpression: null, time: '22:00' });
    value.temporalConstraints.push({ ...value.temporalConstraints[0], id: 'hard-upper', kind: 'latest_end',
      startTime: null, endTime: '01:00', source: source('hard-upper') });
    value.temporalConstraints.push({ ...value.temporalConstraints[0], id: 'late-preference', kind: 'preferred_window',
      constraintLevel: 'soft', startTime: '22:00', endTime: '23:00', source: source('late-preference') });
    value.factLifecycles.push(active('hard-upper'), active('late-preference'));
    const { input, scheduled } = placeHardClockScope(value);
    expect(scheduled.status).toBe('insufficient_capacity');
    expect(scheduled.candidates).toEqual([]);
    expect(scheduled.unscheduledWorkItemIds).toEqual([input.movableWorkItems[0].id]);
  });

  it('applies clocks to each existing daily occurrence without changing its quantity', () => {
    const value = hardClockScopeGraph({ kind: 'earliest_start', dateExpression: null, time: '20:00', daily: true });
    value.workloads[0].perOccurrence = true;
    value.workloads[0].periodExpression = 'daily';
    const { input, scheduled } = placeHardClockScope(value);
    expect(input.movableWorkItems).toHaveLength(2);
    expect(input.movableWorkItems.map(item => item.quantity.amount)).toEqual([1, 1]);
    expect(scheduled.candidates.map(candidate => ({ date: candidate.date, start: candidate.startTime, minutes: candidate.durationMinutes })))
      .toEqual(['2026-10-12', '2026-10-13'].map(date => ({ date, start: '20:00', minutes: 60 })));
  });

});
