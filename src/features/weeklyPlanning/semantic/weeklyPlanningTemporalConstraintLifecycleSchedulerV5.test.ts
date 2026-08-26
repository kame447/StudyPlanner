import { describe, expect, it } from 'vitest';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './weeklyPlanningActiveSchedulerGraphViewV5';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type PlanningFactLifecycleEntryV5,
  type TemporalConstraintFactV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import { compileGenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import { scheduleWeeklyPlanningStableV5Preview } from './weeklyPlanningStableV5PreviewScheduler';

function source(id: string) {
  return {
    conversationId: 'temporal-constraint-lifecycle',
    turnId: 'turn-1',
    semanticLocalId: id,
    sourceText: '毎日1時間勉強する',
    origin: 'user' as const,
  };
}

function lifecycle(params: {
  factId: string;
  status: PlanningFactLifecycleEntryV5['status'];
  supersededByFactId?: string | null;
}): PlanningFactLifecycleEntryV5 {
  return {
    factId: params.factId,
    status: params.status,
    createdRevision: 1,
    terminalRevision: params.status === 'active' ? null : 2,
    supersededByFactId: params.supersededByFactId ?? null,
  };
}

function temporalConstraint(params: {
  id: string;
  kind: 'deadline' | 'earliest_start';
  dateExpression: string;
}): TemporalConstraintFactV5 {
  return {
    id: params.id,
    taskId: 'task-1',
    targetFactId: 'task-1',
    kind: params.kind,
    constraintLevel: 'hard',
    dateExpression: params.dateExpression,
    namedTimePeriod: null,
    startTime: null,
    endTime: null,
    precision: 'exact',
    source: source(params.id),
    createdRevision: 1,
  };
}

function graph(params: {
  temporalConstraints: TemporalConstraintFactV5[];
  temporalLifecycles: PlanningFactLifecycleEntryV5[];
}): WeeklyPlanningFactGraphV5 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 2,
    tasks: [{
      id: 'task-1',
      category: 'study',
      title: '金フレ',
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
      perOccurrence: true,
      periodExpression: '毎日',
      source: source('workload-1'),
      createdRevision: 1,
    }],
    temporalConstraints: params.temporalConstraints,
    recurrences: [{
      id: 'recurrence-1',
      taskId: 'task-1',
      targetFactId: 'task-1',
      kind: 'daily',
      count: null,
      days: [],
      source: source('recurrence-1'),
      createdRevision: 1,
    }],
    factLifecycles: [
      lifecycle({ factId: 'task-1', status: 'active' }),
      lifecycle({ factId: 'workload-1', status: 'active' }),
      lifecycle({ factId: 'recurrence-1', status: 'active' }),
      ...params.temporalLifecycles,
    ],
  };
}

function compileAndSchedule(value: WeeklyPlanningFactGraphV5) {
  const activeGraph = createWeeklyPlanningActiveSchedulerGraphViewV5(value);
  const compiled = compileGenericSchedulerInput({
    graph: activeGraph,
    context: {
      ownerId: 'owner-1',
      currentDate: '2026-08-26',
      planningStartDate: '2026-08-26',
      planningEndDate: '2026-09-01',
      timeZone: 'Asia/Tokyo',
      weekStartsOn: 'monday',
    },
  });
  expect(compiled.status).toBe('ready');
  expect(compiled.input?.movableWorkItems.map((item) => item.requiredDate)).toEqual([
    '2026-08-26',
    '2026-08-27',
    '2026-08-28',
    '2026-08-29',
    '2026-08-30',
    '2026-08-31',
    '2026-09-01',
  ]);
  return scheduleWeeklyPlanningStableV5Preview({
    input: compiled.input!,
    graph: value,
  });
}

describe('Stable V5 temporal constraint lifecycle at scheduler boundary', () => {
  it('does not revive a removed deadline during final placement', () => {
    const deadline = temporalConstraint({
      id: 'deadline-old',
      kind: 'deadline',
      dateExpression: '2026-08-27',
    });
    const scheduled = compileAndSchedule(graph({
      temporalConstraints: [deadline],
      temporalLifecycles: [
        lifecycle({ factId: deadline.id, status: 'removed' }),
      ],
    }));

    expect(scheduled.status).toBe('ready');
    expect(scheduled.unscheduledWorkItemIds).toEqual([]);
  });

  it('uses only the active replacement when an old deadline is superseded', () => {
    const oldDeadline = temporalConstraint({
      id: 'deadline-old',
      kind: 'deadline',
      dateExpression: '2026-08-27',
    });
    const activeDeadline = temporalConstraint({
      id: 'deadline-active',
      kind: 'deadline',
      dateExpression: '2026-09-01',
    });
    const scheduled = compileAndSchedule(graph({
      temporalConstraints: [oldDeadline, activeDeadline],
      temporalLifecycles: [
        lifecycle({
          factId: oldDeadline.id,
          status: 'superseded',
          supersededByFactId: activeDeadline.id,
        }),
        lifecycle({ factId: activeDeadline.id, status: 'active' }),
      ],
    }));

    expect(scheduled.status).toBe('ready');
    expect(scheduled.unscheduledWorkItemIds).toEqual([]);
  });

  it('does not revive a removed earliest-start bound during final placement', () => {
    const earliestStart = temporalConstraint({
      id: 'earliest-start-old',
      kind: 'earliest_start',
      dateExpression: '2026-08-30',
    });
    const scheduled = compileAndSchedule(graph({
      temporalConstraints: [earliestStart],
      temporalLifecycles: [
        lifecycle({ factId: earliestStart.id, status: 'removed' }),
      ],
    }));

    expect(scheduled.status).toBe('ready');
    expect(scheduled.unscheduledWorkItemIds).toEqual([]);
  });
});
