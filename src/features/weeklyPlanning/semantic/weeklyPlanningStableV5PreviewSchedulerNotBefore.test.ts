import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningActiveSchedulerGraphViewV5,
} from './weeklyPlanningActiveSchedulerGraphViewV5';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import type { GenericPlanningWorkItem } from './weeklyPlanningGenericWorkItems';
import type { GenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import {
  createWeeklyPlanningPlacementGraphViewV5,
} from './weeklyPlanningPlacementGraphViewV5';
import { scheduleWeeklyPlanningStableV5Preview } from './weeklyPlanningStableV5PreviewScheduler';

function workItem(): GenericPlanningWorkItem {
  return {
    version: 'weekly-planning-generic-work-item-v1',
    id: 'work-item-1',
    taskId: 'task-1',
    componentId: null,
    workloadFactId: 'workload-1',
    label: '数学 60分',
    quantityRole: 'target',
    actionability: 'actionable',
    quantity: {
      amount: 60,
      unitCode: 'minute',
      unitLabel: '分',
      ordinalRange: null,
      actualRange: null,
    },
    estimatedMinutes: 60,
    estimateBasis: 'intrinsic_duration',
    estimateSourceFactIds: [],
    estimateSourceWorkloadFactIds: [],
    splitPolicy: 'splittable',
    periodExpression: null,
    sourceFactRefs: ['task-1', 'workload-1'],
  };
}

function input(): GenericSchedulerInput {
  return {
    version: 'weekly-planning-generic-scheduler-input-v2',
    graphRevision: 1,
    ownerId: 'owner-1',
    horizon: {
      startDate: '2026-08-11',
      endDate: '2026-08-11',
      timeZone: 'Asia/Tokyo',
      planningWindowFactIds: [],
    },
    movableWorkItems: [workItem()],
    fixedTaskReservations: [],
    taskDateEligibilities: [],
    availabilityWindows: [],
    sourceSelections: [],
    relations: [],
    sourceFactRefs: ['task-1', 'workload-1'],
  };
}

function graph(): WeeklyPlanningFactGraphV5 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 1,
    tasks: [{
      id: 'task-1',
      category: 'study',
      title: '数学',
      source: {
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        semanticLocalId: 'task-local-1',
        sourceText: '今日数学を1時間やりたい',
        origin: 'user',
      },
      createdRevision: 1,
    }],
  };
}

function placementGraph() {
  return createWeeklyPlanningPlacementGraphViewV5(
    createWeeklyPlanningActiveSchedulerGraphViewV5(graph()),
  );
}

describe('Stable V5 preview scheduler request-time cutoff', () => {
  it('never places a today block before the request-time cutoff', () => {
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: input(),
      graph: placementGraph(),
      notBefore: { date: '2026-08-11', time: '14:56' },
    });

    expect(result.status).toBe('ready');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      date: '2026-08-11',
      startTime: '14:56',
      endTime: '15:56',
    });
  });

  it('reports insufficient capacity when today has already ended', () => {
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: input(),
      graph: placementGraph(),
      notBefore: { date: '2026-08-11', time: '24:00' },
    });

    expect(result.status).toBe('insufficient_capacity');
    expect(result.candidates).toEqual([]);
    expect(result.unscheduledWorkItemIds).toEqual(['work-item-1']);
  });
});
