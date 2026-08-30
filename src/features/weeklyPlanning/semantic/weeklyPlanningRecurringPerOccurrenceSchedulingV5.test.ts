import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningActiveSchedulerGraphViewV5,
} from './weeklyPlanningActiveSchedulerGraphViewV5';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type PlanningFactLifecycleEntryV5,
  type TemporalConstraintFactV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import { compileGenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import {
  createWeeklyPlanningPlacementGraphViewV5,
} from './weeklyPlanningPlacementGraphViewV5';
import { scheduleWeeklyPlanningStableV5Preview } from './weeklyPlanningStableV5PreviewScheduler';

function source(id: string) {
  return {
    conversationId: 'recurring-per-occurrence-conversation',
    turnId: 'turn-1',
    semanticLocalId: id,
    sourceText: '来週は毎日2時間ずつ',
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

function graph(): WeeklyPlanningFactGraphV5 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 1,
    tasks: [{
      id: 'task-mock-exam',
      category: 'study',
      title: '模試対策',
      source: source('task-mock-exam'),
      createdRevision: 1,
    }],
    components: [
      {
        id: 'component-math',
        taskId: 'task-mock-exam',
        parentComponentId: null,
        role: 'subject',
        label: '数学',
        source: source('component-math'),
        createdRevision: 1,
      },
      {
        id: 'component-english',
        taskId: 'task-mock-exam',
        parentComponentId: null,
        role: 'subject',
        label: '英語',
        source: source('component-english'),
        createdRevision: 1,
      },
    ],
    workloads: [{
      id: 'workload-math-daily',
      taskId: 'task-mock-exam',
      componentId: 'component-math',
      quantityRole: 'target',
      amount: 2,
      unitCode: 'hour',
      unitLabel: '時間',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: true,
      periodExpression: '来週',
      source: source('workload-math-daily'),
      createdRevision: 1,
    }],
    recurrences: [{
      id: 'recurrence-math-daily',
      taskId: 'task-mock-exam',
      targetFactId: 'component-math',
      kind: 'daily',
      count: null,
      days: [],
      source: source('recurrence-math-daily'),
      createdRevision: 1,
    }],
    factLifecycles: [
      active('task-mock-exam'),
      active('component-math'),
      active('component-english'),
      active('workload-math-daily'),
      active('recurrence-math-daily'),
    ],
  };
}

function placementGraph(value: WeeklyPlanningFactGraphV5) {
  return createWeeklyPlanningPlacementGraphViewV5(
    createWeeklyPlanningActiveSchedulerGraphViewV5(value),
  );
}

function addTemporalConstraint(
  value: WeeklyPlanningFactGraphV5,
  params: {
    id: string;
    kind: Extract<TemporalConstraintFactV5['kind'], 'earliest_start' | 'deadline' | 'latest_end'>;
    dateExpression: string;
    constraintLevel?: TemporalConstraintFactV5['constraintLevel'];
    targetFactId?: string;
  },
) {
  value.temporalConstraints.push({
    id: params.id,
    taskId: 'task-mock-exam',
    targetFactId: params.targetFactId ?? 'component-math',
    kind: params.kind,
    constraintLevel: params.constraintLevel ?? 'hard',
    dateExpression: params.dateExpression,
    namedTimePeriod: null,
    startTime: null,
    endTime: null,
    precision: 'exact',
    source: source(params.id),
    createdRevision: 1,
  });
  value.factLifecycles.push(active(params.id));
}

function compile(
  value: WeeklyPlanningFactGraphV5,
  planningStartDate = '2026-08-17',
  planningEndDate = '2026-08-23',
) {
  return compileGenericSchedulerInput({
    graph: createWeeklyPlanningActiveSchedulerGraphViewV5(value),
    context: {
      ownerId: 'owner-1',
      currentDate: '2026-08-14',
      planningStartDate,
      planningEndDate,
      timeZone: 'Asia/Tokyo',
    },
  });
}

describe('Stable V5 recurring per-occurrence scheduling', () => {
  it('places one complete occurrence on every day in the planning horizon', () => {
    const value = graph();
    const compiled = compile(value);

    expect(compiled.status).toBe('ready');
    expect(compiled.input?.movableWorkItems).toHaveLength(7);
    expect(compiled.input?.movableWorkItems.map((item) => item.requiredDate)).toEqual([
      '2026-08-17',
      '2026-08-18',
      '2026-08-19',
      '2026-08-20',
      '2026-08-21',
      '2026-08-22',
      '2026-08-23',
    ]);
    expect(compiled.input?.sourceFactRefs).toContain('recurrence-math-daily');

    const scheduled = scheduleWeeklyPlanningStableV5Preview({
      input: compiled.input!,
      graph: placementGraph(value),
    });

    expect(scheduled.status).toBe('ready');
    expect(scheduled.candidates).toHaveLength(7);
    expect(scheduled.candidates.map((candidate) => candidate.date)).toEqual([
      '2026-08-17',
      '2026-08-18',
      '2026-08-19',
      '2026-08-20',
      '2026-08-21',
      '2026-08-22',
      '2026-08-23',
    ]);
    expect(scheduled.candidates.every((candidate) => candidate.durationMinutes === 120))
      .toBe(true);
    expect(scheduled.candidates.reduce(
      (sum, candidate) => sum + candidate.durationMinutes,
      0,
    )).toBe(840);
    expect(scheduled.candidates.every((candidate) =>
      (candidate as typeof candidate & {
        stableV5Metadata?: { sourceFactRefs: string[] };
      }).stableV5Metadata?.sourceFactRefs.includes('recurrence-math-daily')))
      .toBe(true);
  });

  it('does not multiply a workload that is not marked per occurrence', () => {
    const value = graph();
    value.workloads[0].perOccurrence = false;

    const compiled = compile(value);

    expect(compiled.status).toBe('ready');
    expect(compiled.input?.movableWorkItems).toHaveLength(1);
    expect(compiled.input?.movableWorkItems[0].requiredDate).toBeUndefined();
  });

  it('inherits a task-level recurrence for component work', () => {
    const value = graph();
    value.recurrences[0].targetFactId = 'task-mock-exam';

    const compiled = compile(value);

    expect(compiled.status).toBe('ready');
    expect(compiled.input?.movableWorkItems.map((item) => item.requiredDate)).toEqual([
      '2026-08-17',
      '2026-08-18',
      '2026-08-19',
      '2026-08-20',
      '2026-08-21',
      '2026-08-22',
      '2026-08-23',
    ]);
  });

  it('does not borrow recurrence semantics from a sibling component', () => {
    const value = graph();
    value.recurrences[0].targetFactId = 'component-english';

    const compiled = compile(value);

    expect(compiled.status).toBe('ready');
    expect(compiled.input?.movableWorkItems).toHaveLength(1);
    expect(compiled.input?.movableWorkItems[0].requiredDate).toBeUndefined();
  });

  it('expands simple weekend recurrence only on weekend dates', () => {
    const value = graph();
    value.recurrences[0].kind = 'weekends';

    const compiled = compile(value);

    expect(compiled.status).toBe('ready');
    expect(compiled.input?.movableWorkItems.map((item) => item.requiredDate)).toEqual([
      '2026-08-22',
      '2026-08-23',
    ]);
  });

  it('creates no fake occurrence when a simple recurrence has no date in the horizon', () => {
    const value = graph();
    value.recurrences[0].kind = 'weekdays';

    const compiled = compile(value, '2026-08-22', '2026-08-23');

    expect(compiled.status).toBe('empty');
    expect(compiled.input).toBeNull();
  });

  it('clips recurring occurrences after a hard deadline or latest end', () => {
    for (const kind of ['deadline', 'latest_end'] as const) {
      const value = graph();
      addTemporalConstraint(value, {
        id: `hard-${kind}`,
        kind,
        dateExpression: '2026-08-19',
      });

      const compiled = compile(value);

      expect(compiled.status).toBe('ready');
      expect(compiled.input?.movableWorkItems.map((item) => item.requiredDate)).toEqual([
        '2026-08-17',
        '2026-08-18',
        '2026-08-19',
      ]);
    }
  });

  it('clips recurring occurrences before a hard earliest start', () => {
    const value = graph();
    addTemporalConstraint(value, {
      id: 'hard-earliest-start',
      kind: 'earliest_start',
      dateExpression: '2026-08-21',
    });

    const compiled = compile(value);

    expect(compiled.status).toBe('ready');
    expect(compiled.input?.movableWorkItems.map((item) => item.requiredDate)).toEqual([
      '2026-08-21',
      '2026-08-22',
      '2026-08-23',
    ]);
  });

  it('intersects multiple hard recurring date bounds', () => {
    const value = graph();
    addTemporalConstraint(value, {
      id: 'hard-earliest-start',
      kind: 'earliest_start',
      dateExpression: '2026-08-19',
    });
    addTemporalConstraint(value, {
      id: 'hard-deadline',
      kind: 'deadline',
      dateExpression: '2026-08-21',
    });

    const compiled = compile(value);

    expect(compiled.status).toBe('ready');
    expect(compiled.input?.movableWorkItems.map((item) => item.requiredDate)).toEqual([
      '2026-08-19',
      '2026-08-20',
      '2026-08-21',
    ]);
  });

  it('inherits a task-level hard date bound for a recurring component workload', () => {
    const value = graph();
    addTemporalConstraint(value, {
      id: 'task-deadline',
      kind: 'deadline',
      dateExpression: '2026-08-19',
      targetFactId: 'task-mock-exam',
    });

    expect(compile(value).input?.movableWorkItems.map((item) => item.requiredDate)).toEqual([
      '2026-08-17',
      '2026-08-18',
      '2026-08-19',
    ]);
  });

  it('does not turn soft or sibling component date preferences into hard recurrence bounds', () => {
    const soft = graph();
    addTemporalConstraint(soft, {
      id: 'soft-deadline',
      kind: 'deadline',
      dateExpression: '2026-08-19',
      constraintLevel: 'soft',
    });
    expect(compile(soft).input?.movableWorkItems).toHaveLength(7);

    const siblingTarget = graph();
    addTemporalConstraint(siblingTarget, {
      id: 'other-component-deadline',
      kind: 'deadline',
      dateExpression: '2026-08-19',
      targetFactId: 'component-english',
    });
    expect(compile(siblingTarget).input?.movableWorkItems).toHaveLength(7);
  });

  it('intersects an occurrence date with task exclusions and returns no partial preview', () => {
    const value = graph();
    value.taskDateRules = [{
      id: 'exclude-wednesday',
      taskId: 'task-mock-exam',
      targetFactId: 'task-mock-exam',
      kind: 'excluded_date',
      dateExpression: '2026-08-19',
      constraintLevel: 'hard',
      source: source('exclude-wednesday'),
      createdRevision: 1,
    }];
    value.factLifecycles.push(active('exclude-wednesday'));
    const compiled = compile(value);
    expect(compiled.status).toBe('ready');

    const scheduled = scheduleWeeklyPlanningStableV5Preview({
      input: compiled.input!,
      graph: placementGraph(value),
    });

    expect(scheduled.status).toBe('insufficient_capacity');
    expect(scheduled.candidates).toEqual([]);
    expect(scheduled.unscheduledWorkItemIds).toEqual([
      expect.stringContaining(':recurrence:recurrence-math-daily:2026-08-19'),
    ]);
  });
});
