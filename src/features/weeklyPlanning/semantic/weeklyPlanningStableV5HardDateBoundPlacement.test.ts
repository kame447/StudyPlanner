import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningActiveSchedulerGraphViewV5,
} from './weeklyPlanningActiveSchedulerGraphViewV5';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type TemporalConstraintFactV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import type { GenericPlanningWorkItem } from './weeklyPlanningGenericWorkItems';
import type { GenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import {
  createWeeklyPlanningPlacementGraphViewV5,
} from './weeklyPlanningPlacementGraphViewV5';
import type {
  WeeklyPlanningSchedulerHardDateBoundV5,
} from './weeklyPlanningResolvedTemporalConstraintsV5';
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

function schedulerInput(params: {
  item?: GenericPlanningWorkItem;
  hardDateBounds?: WeeklyPlanningSchedulerHardDateBoundV5[];
} = {}): GenericSchedulerInput {
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
    movableWorkItems: [params.item ?? workItem()],
    fixedTaskReservations: [],
    taskDateEligibilities: [],
    availabilityWindows: [],
    sourceSelections: [],
    relations: [],
    hardDateBounds: params.hardDateBounds ?? [],
    preferredPlacements: [],
    sourceFactRefs: ['task-1', 'workload-1'],
  };
}

function hardBound(params: {
  targetFactId?: string;
  startDate?: string | null;
  endDate?: string | null;
  sourceFactIds: string[];
}): WeeklyPlanningSchedulerHardDateBoundV5 {
  return {
    taskId: 'task-1',
    targetFactId: params.targetFactId ?? 'task-1',
    startDate: params.startDate ?? null,
    endDate: params.endDate ?? null,
    sourceFactIds: params.sourceFactIds,
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

function placementGraph(params: Parameters<typeof graph>[0]) {
  return createWeeklyPlanningPlacementGraphViewV5(
    createWeeklyPlanningActiveSchedulerGraphViewV5(graph(params)),
  );
}

describe('Stable V5 hard date bound placement', () => {
  it('never places ordinary movable work after a compiled hard deadline', () => {
    const scheduled = scheduleWeeklyPlanningStableV5Preview({
      input: schedulerInput({
        hardDateBounds: [hardBound({
          endDate: '2026-08-19',
          sourceFactIds: ['deadline-1'],
        })],
      }),
      graph: placementGraph({
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

  it('never places ordinary movable work before a compiled hard earliest start', () => {
    const scheduled = scheduleWeeklyPlanningStableV5Preview({
      input: schedulerInput({
        hardDateBounds: [hardBound({
          startDate: '2026-08-21',
          sourceFactIds: ['earliest-start-1'],
        })],
      }),
      graph: placementGraph({
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

  it('intersects compiled hard start and end bounds down to an exact allowed date', () => {
    const scheduled = scheduleWeeklyPlanningStableV5Preview({
      input: schedulerInput({
        hardDateBounds: [hardBound({
          startDate: '2026-08-20',
          endDate: '2026-08-20',
          sourceFactIds: ['earliest-start-1', 'latest-end-1'],
        })],
      }),
      graph: placementGraph({
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

  it('applies a compiler-inherited task bound to component work', () => {
    const item = workItem({ componentId: 'component-1' });
    const scheduled = scheduleWeeklyPlanningStableV5Preview({
      input: schedulerInput({
        item,
        hardDateBounds: [hardBound({
          targetFactId: 'component-1',
          startDate: '2026-08-20',
          endDate: '2026-08-20',
          sourceFactIds: ['task-start-1', 'task-deadline-1'],
        })],
      }),
      graph: placementGraph({
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

  it('fails closed when compiled hard date bounds leave no eligible day', () => {
    const scheduled = scheduleWeeklyPlanningStableV5Preview({
      input: schedulerInput({
        hardDateBounds: [hardBound({
          startDate: '2026-08-22',
          endDate: '2026-08-20',
          sourceFactIds: ['earliest-start-1', 'deadline-1'],
        })],
      }),
      graph: placementGraph({
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

  it('does not turn a soft deadline into a compiled hard placement bound', () => {
    const scheduled = scheduleWeeklyPlanningStableV5Preview({
      input: schedulerInput(),
      graph: placementGraph({
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
