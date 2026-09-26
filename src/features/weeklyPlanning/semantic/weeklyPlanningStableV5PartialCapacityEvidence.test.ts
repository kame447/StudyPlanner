import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningActiveSchedulerGraphViewV5,
} from './weeklyPlanningActiveSchedulerGraphViewV5';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import type { GenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import {
  createWeeklyPlanningPlacementGraphViewV5,
} from './weeklyPlanningPlacementGraphViewV5';
import { scheduleWeeklyPlanningStableV5Preview } from './weeklyPlanningStableV5PreviewScheduler';

const source = {
  conversationId: 'partial-capacity-conversation',
  turnId: 'turn-1',
  semanticLocalId: 'source',
  sourceText: '数学を英語より優先',
  origin: 'user' as const,
};

function graph(): WeeklyPlanningFactGraphV5 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 1,
    tasks: [
      { id: 'task-math', category: 'study', title: '数学', source, createdRevision: 1 },
      { id: 'task-english', category: 'study', title: '英語', source, createdRevision: 1 },
    ],
    workloads: [
      {
        id: 'workload-math', taskId: 'task-math', componentId: null,
        quantityRole: 'target', amount: 60, unitCode: 'minute', unitLabel: '分',
        rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
        source, createdRevision: 1,
      },
      {
        id: 'workload-english', taskId: 'task-english', componentId: null,
        quantityRole: 'target', amount: 60, unitCode: 'minute', unitLabel: '分',
        rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
        source, createdRevision: 1,
      },
    ],
    relations: [{
      id: 'relation-math-over-english',
      kind: 'priority_over',
      fromTaskId: 'task-math',
      toTaskId: 'task-english',
      source,
      createdRevision: 1,
    }],
    factLifecycles: [
      'task-math', 'task-english', 'workload-math', 'workload-english',
      'relation-math-over-english',
    ].map((factId) => ({
      factId,
      status: 'active' as const,
      createdRevision: 1,
      terminalRevision: null,
      supersededByFactId: null,
    })),
  };
}

function workItem(params: { id: string; taskId: string; workloadFactId: string }) {
  return {
    version: 'weekly-planning-generic-work-item-v1' as const,
    id: params.id,
    taskId: params.taskId,
    componentId: null,
    workloadFactId: params.workloadFactId,
    label: `${params.taskId} 60分`,
    quantityRole: 'target' as const,
    actionability: 'actionable' as const,
    quantity: {
      amount: 60,
      unitCode: 'minute' as const,
      unitLabel: '分',
      ordinalRange: null,
      actualRange: null,
    },
    estimatedMinutes: 60,
    baseEstimatedMinutes: 60,
    estimateBasis: 'intrinsic_duration' as const,
    estimateSourceFactIds: [],
    estimateSourceWorkloadFactIds: [],
    splitPolicy: 'splittable' as const,
    periodExpression: null,
    sourceFactRefs: [params.taskId, params.workloadFactId],
  };
}

function input(): GenericSchedulerInput {
  return {
    version: 'weekly-planning-generic-scheduler-input-v2',
    graphRevision: 1,
    ownerId: 'owner-1',
    horizon: {
      startDate: '2026-09-05',
      endDate: '2026-09-05',
      timeZone: 'Asia/Tokyo',
      planningWindowFactIds: [],
    },
    movableWorkItems: [
      workItem({ id: 'item-math', taskId: 'task-math', workloadFactId: 'workload-math' }),
      workItem({ id: 'item-english', taskId: 'task-english', workloadFactId: 'workload-english' }),
    ],
    fixedTaskReservations: [],
    taskDateEligibilities: [],
    availabilityWindows: [{
      id: 'available-1',
      kind: 'available',
      start: { date: '2026-09-05', time: '09:00' },
      end: { date: '2026-09-05', time: '10:00' },
      timeZone: 'Asia/Tokyo',
      constraintLevel: 'hard',
      sourceKind: 'user_declaration',
      sourceRef: 'availability-1',
      ownerId: 'owner-1',
      graphRevision: 1,
    }],
    sourceSelections: [],
    relations: [{
      factId: 'relation-math-over-english',
      kind: 'priority_over',
      fromTaskId: 'task-math',
      toTaskId: 'task-english',
    }],
    hardDateBounds: [],
    preferredPlacements: [],
    sourceFactRefs: [],
  };
}

function placementGraph() {
  return createWeeklyPlanningPlacementGraphViewV5(
    createWeeklyPlanningActiveSchedulerGraphViewV5(graph()),
  );
}

describe('Stable V5 partial capacity evidence', () => {
  it('keeps ordinary insufficient-capacity results all-or-nothing', () => {
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: input(),
      graph: placementGraph(),
    });

    expect(result.status).toBe('insufficient_capacity');
    expect(result.candidates).toEqual([]);
    expect(result.unscheduledWorkItemIds).toEqual(['item-english']);
  });

  it('retains already-safe candidates only when explicitly requested as capacity evidence', () => {
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: input(),
      graph: placementGraph(),
      retainPartialCandidates: true,
    });

    expect(result.status).toBe('insufficient_capacity');
    expect(result.unscheduledWorkItemIds).toEqual(['item-english']);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      durationMinutes: 60,
      stableV5Metadata: { taskId: 'task-math' },
    });
  });
});
