import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningActiveSchedulerGraphViewV5,
} from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from '../semantic/weeklyPlanningFactGraphV5';
import type { GenericSchedulerInput } from '../semantic/weeklyPlanningGenericSchedulerInput';
import {
  createWeeklyPlanningPlacementGraphViewV5,
} from '../semantic/weeklyPlanningPlacementGraphViewV5';
import {
  takeWeeklyPlanningStableV5DebugTrace,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import { executeWeeklyPlanningStableV5Preview } from './weeklyPlanningStableV5PreviewExecution';

function graph(): WeeklyPlanningFactGraphV5 {
  const source = {
    conversationId: 'trace-conversation',
    turnId: 'turn-1',
    semanticLocalId: 'task-1',
    sourceText: '数学を1時間',
    origin: 'user' as const,
  };
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 1,
    tasks: [{
      id: 'task-1',
      category: 'study',
      title: '数学',
      source,
      createdRevision: 1,
    }],
    workloads: [{
      id: 'workload-1',
      taskId: 'task-1',
      componentId: null,
      quantityRole: 'target',
      amount: 60,
      unitCode: 'minute',
      unitLabel: '分',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      source,
      createdRevision: 1,
    }],
    factLifecycles: [
      {
        factId: 'task-1',
        status: 'active',
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      },
      {
        factId: 'workload-1',
        status: 'active',
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      },
    ],
  };
}

function schedulerInput(): GenericSchedulerInput {
  return {
    version: 'weekly-planning-generic-scheduler-input-v2',
    graphRevision: 1,
    ownerId: 'owner-1',
    horizon: {
      startDate: '2026-09-04',
      endDate: '2026-09-05',
      timeZone: 'Asia/Tokyo',
      planningWindowFactIds: [],
    },
    movableWorkItems: [{
      version: 'weekly-planning-generic-work-item-v1',
      id: 'work-item-past',
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
      requiredDate: '2026-09-04',
    }],
    fixedTaskReservations: [],
    taskDateEligibilities: [],
    availabilityWindows: [],
    sourceSelections: [],
    relations: [],
    hardDateBounds: [],
    preferredPlacements: [],
    sourceFactRefs: ['task-1', 'workload-1'],
  };
}

describe('Stable V5 preview trace diagnostics', () => {
  it('preserves unscheduled work item ids in the projected debug trace', () => {
    const traceRequestId = 'preview-trace-unscheduled';
    const value = graph();
    const preview = executeWeeklyPlanningStableV5Preview({
      input: {
        plans: [],
        scheduleTemplates: [],
        timetableTermId: undefined,
        traceRequestId,
      },
      graph: createWeeklyPlanningPlacementGraphViewV5(
        createWeeklyPlanningActiveSchedulerGraphViewV5(value),
      ),
      schedulerInput: schedulerInput(),
      requestContext: {
        startedAtIso: '2026-09-05T00:00:00.000Z',
        timeZone: 'Asia/Tokyo',
        currentDate: '2026-09-05',
        currentTime: '09:00',
        notBeforeDate: '2026-09-05',
        notBeforeTime: '09:00',
        weekStartsOn: 'monday',
      },
    });

    expect(preview.unscheduledWorkItemIds).toEqual(['work-item-past']);
    const event = takeWeeklyPlanningStableV5DebugTrace(traceRequestId)
      .find((candidate) => candidate.stage === 'runtime_preview_scheduler_evaluated');
    expect(event?.data).toMatchObject({
      status: 'insufficient_capacity',
      unscheduledCount: 1,
      unscheduledWorkItems: ['work-item-past'],
    });
  });
});
