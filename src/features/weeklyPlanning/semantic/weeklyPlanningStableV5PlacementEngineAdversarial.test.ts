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

const WEEK = [
  '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20',
  '2026-08-21', '2026-08-22', '2026-08-23',
];

const source = {
  conversationId: 'conversation-placement-engine',
  turnId: 'turn-1',
  semanticLocalId: 'local',
  sourceText: 'test',
  origin: 'user' as const,
};

function item(taskId: string, minutes = 60): GenericPlanningWorkItem {
  return {
    version: 'weekly-planning-generic-work-item-v1',
    id: `item-${taskId}`,
    taskId,
    componentId: null,
    workloadFactId: `workload-${taskId}`,
    label: `${taskId} ${minutes}分`,
    quantityRole: 'target',
    actionability: 'actionable',
    quantity: {
      amount: minutes,
      unitCode: 'minute',
      unitLabel: '分',
      ordinalRange: null,
      actualRange: null,
    },
    estimatedMinutes: minutes,
    estimateBasis: 'intrinsic_duration',
    estimateSourceFactIds: [],
    estimateSourceWorkloadFactIds: [],
    splitPolicy: 'atomic',
    periodExpression: null,
    sourceFactRefs: [taskId, `workload-${taskId}`],
  };
}

function graph(taskIds: string[]): WeeklyPlanningFactGraphV5 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 1,
    tasks: taskIds.map((taskId) => ({
      id: taskId,
      category: 'study' as const,
      title: taskId,
      source: { ...source, semanticLocalId: taskId },
      createdRevision: 1,
    })),
    workloads: taskIds.map((taskId) => ({
      id: `workload-${taskId}`,
      taskId,
      componentId: null,
      quantityRole: 'target' as const,
      amount: 60,
      unitCode: 'minute' as const,
      unitLabel: '分',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      source: { ...source, semanticLocalId: `workload-${taskId}` },
      createdRevision: 1,
    })),
    factLifecycles: taskIds.flatMap((taskId) => [
      {
        factId: taskId,
        status: 'active' as const,
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      },
      {
        factId: `workload-${taskId}`,
        status: 'active' as const,
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      },
    ]),
  };
}

function placementGraph(taskIds: string[]) {
  return createWeeklyPlanningPlacementGraphViewV5(
    createWeeklyPlanningActiveSchedulerGraphViewV5(graph(taskIds)),
  );
}

function input(items: GenericPlanningWorkItem[]): GenericSchedulerInput {
  return {
    version: 'weekly-planning-generic-scheduler-input-v2',
    graphRevision: 1,
    ownerId: 'owner-placement',
    horizon: {
      startDate: WEEK[0],
      endDate: WEEK[6],
      timeZone: 'Asia/Tokyo',
      planningWindowFactIds: [],
    },
    movableWorkItems: items,
    fixedTaskReservations: [],
    taskDateEligibilities: [],
    availabilityWindows: [],
    sourceSelections: [],
    relations: [],
    hardDateBounds: [],
    preferredPlacements: [],
    sourceFactRefs: items.flatMap((value) => value.sourceFactRefs),
  };
}

describe('Stable V5 placement engine adversarial integration', () => {
  it('offsets independent singleton tasks instead of piling them onto Monday', () => {
    const taskIds = ['task-a', 'task-b', 'task-c'];
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: input(taskIds.map((taskId) => item(taskId))),
      graph: placementGraph(taskIds),
    });
    expect(result.status).toBe('ready');
    expect(result.candidates.map((candidate) => candidate.date)).toEqual(WEEK.slice(0, 3));
  });

  it('enforces actual chronology for depends_on when the predecessor is fixed late in the week', () => {
    const value = input([item('task-b')]);
    value.fixedTaskReservations = [{
      id: 'fixed-a',
      taskId: 'task-a',
      start: { date: '2026-08-21', time: '10:00' },
      end: { date: '2026-08-21', time: '11:00' },
      timeZone: 'Asia/Tokyo',
      temporalConstraintFactId: 'fixed-a-fact',
      constraintLevel: 'hard',
      sourceKind: 'user_commitment',
      sourceRef: 'fixed-a-fact',
      graphRevision: 1,
    }];
    value.relations = [{
      factId: 'depends',
      kind: 'depends_on',
      fromTaskId: 'task-b',
      toTaskId: 'task-a',
    }];
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: value,
      graph: placementGraph(['task-a', 'task-b']),
    });
    expect(result.status).toBe('ready');
    expect(result.candidates[0].date >= '2026-08-21').toBe(true);
    if (result.candidates[0].date === '2026-08-21') {
      expect(result.candidates[0].startTime >= '11:00').toBe(true);
    }
  });

  it('enforces chronology between two movable tasks even when the predecessor is date-constrained', () => {
    const value = input([item('task-a'), item('task-b')]);
    value.taskDateEligibilities = [{
      taskId: 'task-a',
      allowedDates: ['2026-08-21'],
      excludedDates: [],
      sourceFactIds: ['date-a'],
    }];
    value.relations = [{
      factId: 'before',
      kind: 'before',
      fromTaskId: 'task-a',
      toTaskId: 'task-b',
    }];
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: value,
      graph: placementGraph(['task-a', 'task-b']),
    });
    expect(result.status).toBe('ready');
    const first = result.candidates.find((candidate) => candidate.workItemKey === 'item-task-a')!;
    const second = result.candidates.find((candidate) => candidate.workItemKey === 'item-task-b')!;
    expect(`${second.date}T${second.startTime}` >= `${first.date}T${first.endTime}`).toBe(true);
  });

  it('avoids leaving a ten-minute unusable tail when another clean slot exists', () => {
    const value = input([item('task-a', 120)]);
    value.availabilityWindows = [
      {
        id: 'short-awkward',
        kind: 'available',
        start: { date: WEEK[0], time: '09:00' },
        end: { date: WEEK[0], time: '11:10' },
        timeZone: 'Asia/Tokyo',
        constraintLevel: 'hard',
        sourceKind: 'user_declaration',
        sourceRef: 'short-awkward',
        ownerId: 'owner-placement',
        graphRevision: 1,
      },
      {
        id: 'clean',
        kind: 'available',
        start: { date: WEEK[0], time: '13:00' },
        end: { date: WEEK[0], time: '15:00' },
        timeZone: 'Asia/Tokyo',
        constraintLevel: 'hard',
        sourceKind: 'user_declaration',
        sourceRef: 'clean',
        ownerId: 'owner-placement',
        graphRevision: 1,
      },
    ];
    const result = scheduleWeeklyPlanningStableV5Preview({
      input: value,
      graph: placementGraph(['task-a']),
    });
    expect(result.status).toBe('ready');
    expect(result.candidates[0]).toMatchObject({
      date: WEEK[0],
      startTime: '13:00',
      endTime: '15:00',
    });
  });
});
