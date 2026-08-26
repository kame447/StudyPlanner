import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type TemporalConstraintFactV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import type { GenericPlanningWorkItem } from './weeklyPlanningGenericWorkItems';
import type { GenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import { scheduleWeeklyPlanningStableV5Preview } from './weeklyPlanningStableV5PreviewScheduler';

function source(id: string) {
  return {
    conversationId: 'hard-date-bound-conversation',
    turnId: 'turn-1',
    semanticLocalId: id,
    sourceText: 'レポートを進める',
    origin: 'user' as const,
  };
}

function workItem(overrides: Partial<GenericPlanningWorkItem> = {}): GenericPlanningWorkItem {
  return {
    version: 'weekly-planning-generic-work-item-v1',
    id: 'work-item-1',
    taskId: 'task-1',
    componentId: null,
    workloadFactId: 'workload-1',
    label: 'レポート 1時間',
    quantityRole: 'target',
    actionability: 'actionable',
    quantity: {
      amount: 1,
      unitCode: 'hour',
      unitLabel: '時間',
      ordinalRange: null,
      actualRange: null,
    },
    estimatedMinutes: 60,
    estimateBasis: 'intrinsic_duration',
    estimateSourceFactIds: [],
    estimateSourceWorkloadFactIds: [],
    splitPolicy: 'atomic',
    periodExpression: null,
    sourceFactRefs: ['task-1', 'workload-1'],
    ...overrides,
  };
}

function schedulerInput(item = workItem()): GenericSchedulerInput {
  return {
    version: 'weekly-planning-generic-scheduler-input-v2',
    graphRevision: 1,
    ownerId: 'owner-1',
    horizon: {
      startDate: '2026-08-17',
      endDate: '2026-08-23',
      timeZone: 'Asia/Tokyo',
      planningWindowFactIds: [],
    },
    movableWorkItems: [item],
    fixedTaskReservations: [],
    taskDateEligibilities: [],
    availabilityWindows: [],
    sourceSelections: [],
    relations: [],
    sourceFactRefs: ['task-1', 'workload-1'],
  };
}

function graph(params: {
  constraints: Array<{
    id: string;
    kind: Extract<TemporalConstraintFactV5['kind'], 'earliest_start' | 'deadline' | 'latest_end'>;
    dateExpression: string;
    constraintLevel?: TemporalConstraintFactV5['constraintLevel'];
    targetFactId?: string;
  }>;
  withComponent?: boolean;
}): WeeklyPlanningFactGraphV5 {
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
    components: params.withComponent
      ? [{
          id: 'component-1',
          taskId: 'task-1',
          parentComponentId: null,
          role: 'section',
          label: '考察',
          source: source('component-1'),
          createdRevision: 1,
        }]
      : [],
    temporalConstraints: params.constraints.map((constraint) => ({
      id: constraint.id,
      taskId: 'task-1',
      targetFactId: constraint.targetFactId ?? 'task-1',
      kind: constraint.kind,
      constraintLevel: constraint.constraintLevel ?? 'hard',
      dateExpression: constraint.dateExpression,
      namedTimePeriod: null,
      startTime: null,
      endTime: null,
      precision: 'exact' as const,
      source: source(constraint.id),
      createdRevision: 1,
    })),
  };
}

describe('Stable V5 hard date bound placement', () => {
  it('never places ordinary movable work after a hard deadline', () => {
    const scheduled = scheduleWeeklyPlanningStableV5Preview({
      input: schedulerInput(),
      graph: graph({
        constraints: [{
          id: 'deadline-1',
          kind: 'deadline',
          dateExpression: '2026-08-19',
        }],
      }),
    });

    expect(scheduled.status).toBe('ready');
    expect(scheduled.candidates).toHaveLength(1);
    expect(scheduled.candidates[0].date <= '2026-08-19').toBe(true);
  });

  it('never places ordinary movable work before a hard earliest start', () => {
    const scheduled = scheduleWeeklyPlanningStableV5Preview({
      input: schedulerInput(),
      graph: graph({
        constraints: [{
          id: 'earliest-start-1',
          kind: 'earliest_start',
          dateExpression: '2026-08-21',
        }],
      }),
    });

    expect(scheduled.status).toBe('ready');
    expect(scheduled.candidates).toHaveLength(1);
    expect(scheduled.candidates[0].date >= '2026-08-21').toBe(true);
  });

  it('intersects hard start and end bounds down to an exact allowed date', () => {
    const scheduled = scheduleWeeklyPlanningStableV5Preview({
      input: schedulerInput(),
      graph: graph({
        constraints: [
          {
            id: 'earliest-start-1',
            kind: 'earliest_start',
            dateExpression: '2026-08-20',
          },
          {
            id: 'latest-end-1',
            kind: 'latest_end',
            dateExpression: '2026-08-20',
          },
        ],
      }),
    });

    expect(scheduled.status).toBe('ready');
    expect(scheduled.candidates.map((candidate) => candidate.date)).toEqual(['2026-08-20']);
  });

  it('inherits a task-level hard bound for component work', () => {
    const item = workItem({ componentId: 'component-1' });
    const scheduled = scheduleWeeklyPlanningStableV5Preview({
      input: schedulerInput(item),
      graph: graph({
        withComponent: true,
        constraints: [
          {
            id: 'task-start-1',
            kind: 'earliest_start',
            dateExpression: '2026-08-20',
          },
          {
            id: 'task-deadline-1',
            kind: 'deadline',
            dateExpression: '2026-08-20',
          },
        ],
      }),
    });

    expect(scheduled.status).toBe('ready');
    expect(scheduled.candidates.map((candidate) => candidate.date)).toEqual(['2026-08-20']);
  });

  it('fails closed when hard date bounds leave no eligible day', () => {
    const scheduled = scheduleWeeklyPlanningStableV5Preview({
      input: schedulerInput(),
      graph: graph({
        constraints: [
          {
            id: 'earliest-start-1',
            kind: 'earliest_start',
            dateExpression: '2026-08-22',
          },
          {
            id: 'deadline-1',
            kind: 'deadline',
            dateExpression: '2026-08-20',
          },
        ],
      }),
    });

    expect(scheduled.status).toBe('insufficient_capacity');
    expect(scheduled.candidates).toEqual([]);
    expect(scheduled.unscheduledWorkItemIds).toEqual(['work-item-1']);
  });

  it('does not turn a soft deadline into a hard placement bound', () => {
    const scheduled = scheduleWeeklyPlanningStableV5Preview({
      input: schedulerInput(),
      graph: graph({
        constraints: [{
          id: 'soft-deadline-1',
          kind: 'deadline',
          dateExpression: '2026-08-16',
          constraintLevel: 'soft',
        }],
      }),
    });

    expect(scheduled.status).toBe('ready');
    expect(scheduled.candidates).toHaveLength(1);
  });
});
