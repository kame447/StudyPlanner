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
import {
  resolveWeeklyPlanningDailyCapacitiesV5,
} from './weeklyPlanningDailyCapacityResolverV5';
import {
  resolveWeeklyPlanningDateExpressionsV5,
} from './weeklyPlanningResolvedDateExpressionsV5';
import {
  createWeeklyPlanningAvailabilityResolverGraphV5,
} from './weeklyPlanningSchedulerAvailabilityProjectionV5';
import {
  canonicalizeWeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticCanonicalizerV5';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  validateWeeklyPlanningSemanticValueV5,
} from './weeklyPlanningSemanticValidatorV5';
import { scheduleWeeklyPlanningStableV5Preview } from './weeklyPlanningStableV5PreviewScheduler';

const source = {
  conversationId: 'daily-capacity-test',
  turnId: 'turn-1',
  semanticLocalId: 'local',
  sourceText: 'test',
  origin: 'user' as const,
};

function capacityDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [{
      localId: 'weekend-capacity',
      kind: 'capacity',
      dateExpression: null,
      namedTimePeriod: null,
      startTime: null,
      endTime: null,
      recurrenceKind: 'weekends',
      days: [],
      constraintLevel: 'hard',
      capacityMinutes: 480,
      sourceText: '土日は基本的に1日8時間勉強できます',
    }],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function workItem(taskId: string, minutes: number): GenericPlanningWorkItem {
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

function placementFactGraph(taskIds: string[]): WeeklyPlanningFactGraphV5 {
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
      amount: 240,
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

function schedulerInput(items: GenericPlanningWorkItem[]): GenericSchedulerInput {
  return {
    version: 'weekly-planning-generic-scheduler-input-v2',
    graphRevision: 1,
    ownerId: 'owner-capacity',
    horizon: {
      startDate: '2026-08-22',
      endDate: '2026-08-22',
      timeZone: 'Asia/Tokyo',
      planningWindowFactIds: [],
    },
    movableWorkItems: items,
    fixedTaskReservations: [],
    taskDateEligibilities: [],
    availabilityWindows: [],
    dailyCapacityLimits: [{
      date: '2026-08-22',
      maxMinutes: 480,
      sourceFactIds: ['capacity-weekend'],
    }],
    sourceSelections: [],
    relations: [],
    hardDateBounds: [],
    preferredPlacements: [],
    sourceFactRefs: ['capacity-weekend'],
  };
}

describe('Stable V5 daily study capacity', () => {
  it('accepts a typed weekend capacity without inventing a clock window', () => {
    const document = capacityDocument();
    const validation = validateWeeklyPlanningSemanticValueV5(document);
    expect(validation.errors).toEqual([]);
    expect(validation.document?.availabilityDeclarations[0]).toMatchObject({
      kind: 'capacity',
      recurrenceKind: 'weekends',
      capacityMinutes: 480,
      startTime: null,
      endTime: null,
    });

    const canonicalized = canonicalizeWeeklyPlanningSemanticDocumentV5({
      document,
      context: {
        conversationId: 'daily-capacity-test',
        turnId: 'turn-1',
        expectedRevision: 0,
      },
    });
    expect(canonicalized.status).toBe('applied');
    expect(canonicalized.graph.availabilityDeclarations[0].capacityMinutes).toBe(480);

    const windowProjection = createWeeklyPlanningAvailabilityResolverGraphV5({
      revision: canonicalized.graph.revision,
      availabilityDeclarations: canonicalized.graph.availabilityDeclarations,
      constraintSourceRequests: [],
    });
    expect(windowProjection.availabilityDeclarations).toEqual([]);

    const resolvedDateExpressions = resolveWeeklyPlanningDateExpressionsV5({
      graph: canonicalized.graph,
      currentDate: '2026-08-17',
    });
    const resolvedCapacity = resolveWeeklyPlanningDailyCapacitiesV5({
      availabilityDeclarations: canonicalized.graph.availabilityDeclarations,
      planningDates: [
        '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20',
        '2026-08-21', '2026-08-22', '2026-08-23',
      ],
      resolvedDateExpressions,
    });
    expect(resolvedCapacity.issues).toEqual([]);
    expect(resolvedCapacity.limits.map(({ date, maxMinutes }) => ({ date, maxMinutes }))).toEqual([
      { date: '2026-08-22', maxMinutes: 480 },
      { date: '2026-08-23', maxMinutes: 480 },
    ]);
  });

  it('rejects capacity declarations that smuggle in a clock window', () => {
    const document = capacityDocument();
    document.availabilityDeclarations[0] = {
      ...document.availabilityDeclarations[0],
      startTime: '09:00',
      endTime: '17:00',
    };
    const validation = validateWeeklyPlanningSemanticValueV5(document);
    expect(validation.document).toBeNull();
    expect(validation.errors).toContain(
      'document.availabilityDeclarations[0]:capacity-cannot-have-clock-window',
    );
  });

  it('enforces the daily allocation ceiling during placement', () => {
    const twoTaskIds = ['task-a', 'task-b'];
    const twoItems = twoTaskIds.map((taskId) => workItem(taskId, 240));
    const twoGraph = createWeeklyPlanningPlacementGraphViewV5(
      createWeeklyPlanningActiveSchedulerGraphViewV5(placementFactGraph(twoTaskIds)),
    );
    const withinLimit = scheduleWeeklyPlanningStableV5Preview({
      input: schedulerInput(twoItems),
      graph: twoGraph,
    });
    expect(withinLimit.status).toBe('ready');
    expect(withinLimit.candidates).toHaveLength(2);

    const threeTaskIds = ['task-a', 'task-b', 'task-c'];
    const threeItems = threeTaskIds.map((taskId) => workItem(taskId, 240));
    const threeGraph = createWeeklyPlanningPlacementGraphViewV5(
      createWeeklyPlanningActiveSchedulerGraphViewV5(placementFactGraph(threeTaskIds)),
    );
    const overLimit = scheduleWeeklyPlanningStableV5Preview({
      input: schedulerInput(threeItems),
      graph: threeGraph,
    });
    expect(overLimit.status).toBe('insufficient_capacity');
    expect(overLimit.candidates).toEqual([]);
    expect(overLimit.unscheduledWorkItemIds.length).toBeGreaterThan(0);
  });
});
