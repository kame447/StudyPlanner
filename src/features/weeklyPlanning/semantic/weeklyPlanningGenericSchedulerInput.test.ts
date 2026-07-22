import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV2,
  type WeeklyPlanningFactGraphV2,
} from './weeklyPlanningFactGraphV2';
import {
  compileGenericSchedulerInput,
  type GenericSchedulerInputContext,
} from './weeklyPlanningGenericSchedulerInput';
import type {
  ExternalConstraintEvent,
  ExternalConstraintSourceSnapshot,
} from './weeklyPlanningAvailabilityResolver';

function source(semanticLocalId: string, sourceText: string) {
  return {
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    semanticLocalId,
    sourceText,
    origin: 'user' as const,
  };
}

function baseGraph(): WeeklyPlanningFactGraphV2 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV2(),
    revision: 1,
    tasks: [
      {
        id: 'task-study',
        category: 'study',
        title: '英単語',
        source: source('task-study', '英単語を30分'),
        createdRevision: 1,
      },
      {
        id: 'task-dinner',
        category: 'non_study',
        title: '夕食',
        source: source('task-dinner', '夕食を18時から19時'),
        createdRevision: 1,
      },
    ],
    workloads: [
      {
        id: 'workload-study',
        taskId: 'task-study',
        componentId: null,
        quantityRole: 'target',
        amount: 30,
        unitCode: 'minute',
        unitLabel: '分',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        source: source('workload-study', '30分'),
        createdRevision: 1,
      },
      {
        id: 'workload-dinner',
        taskId: 'task-dinner',
        componentId: null,
        quantityRole: 'target',
        amount: 60,
        unitCode: 'minute',
        unitLabel: '分',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        source: source('workload-dinner', '1時間'),
        createdRevision: 1,
      },
    ],
    temporalConstraints: [
      {
        id: 'constraint-dinner',
        taskId: 'task-dinner',
        targetFactId: 'task-dinner',
        kind: 'fixed_interval',
        dateExpression: 'today',
        namedTimePeriod: null,
        startTime: '18:00',
        endTime: '19:00',
        precision: 'exact',
        constraintLevel: 'hard',
        source: source('constraint-dinner', '今日18時から19時まで夕食'),
        createdRevision: 1,
      },
    ],
    relations: [
      {
        id: 'relation-dinner-before-study',
        kind: 'before',
        fromTaskId: 'task-dinner',
        toTaskId: 'task-study',
        source: source('relation-dinner-before-study', '夕食の後に英単語'),
        createdRevision: 1,
      },
    ],
    availabilityDeclarations: [
      {
        id: 'availability-morning',
        kind: 'preferred',
        dateExpression: null,
        namedTimePeriod: 'morning',
        startTime: null,
        endTime: null,
        recurrenceKind: 'daily',
        days: [],
        constraintLevel: 'soft',
        resolutionStatus: 'unresolved',
        source: source('availability-morning', '午前中がやりやすい'),
        createdRevision: 1,
      },
    ],
  };
}

function context(
  partial: Partial<GenericSchedulerInputContext> = {},
): GenericSchedulerInputContext {
  return {
    ownerId: 'user-1',
    currentDate: '2026-07-22',
    planningStartDate: '2026-07-22',
    planningEndDate: '2026-07-22',
    timeZone: 'Asia/Tokyo',
    namedTimePeriods: {
      morning: { startTime: '08:00', endTime: '12:00' },
    },
    ...partial,
  };
}

function classEvent(): ExternalConstraintEvent {
  return {
    eventId: 'class-1',
    ownerId: 'user-1',
    start: { date: '2026-07-22', time: '10:00' },
    end: { date: '2026-07-22', time: '11:00' },
    timeZone: 'Asia/Tokyo',
    constraintLevel: 'hard',
  };
}

function successfulTimetable(
  events: ExternalConstraintEvent[] = [classEvent()],
): ExternalConstraintSourceSnapshot {
  return {
    kind: 'timetable',
    status: 'success',
    ownerId: 'user-1',
    activeSourceId: 'timetable-1',
    events,
    attemptCount: 1,
  };
}

function failedTimetable(): ExternalConstraintSourceSnapshot {
  return {
    kind: 'timetable',
    status: 'failure',
    ownerId: 'user-1',
    activeSourceId: null,
    failureKind: 'network_error',
    attemptCount: 3,
  };
}

describe('generic weekly planning scheduler input', () => {
  it('combines movable work, fixed reservations, availability, and relations', () => {
    const result = compileGenericSchedulerInput({
      graph: baseGraph(),
      context: context(),
    });

    expect(result.status).toBe('ready');
    expect(result.input).not.toBeNull();
    expect(result.input?.movableWorkItems).toHaveLength(1);
    expect(result.input?.movableWorkItems[0]).toMatchObject({
      taskId: 'task-study',
      estimatedMinutes: 30,
    });
    expect(result.input?.fixedTaskReservations).toEqual([
      expect.objectContaining({
        taskId: 'task-dinner',
        start: { date: '2026-07-22', time: '18:00' },
        end: { date: '2026-07-22', time: '19:00' },
      }),
    ]);
    expect(result.input?.availabilityWindows).toEqual([
      expect.objectContaining({
        kind: 'preferred',
        start: { date: '2026-07-22', time: '08:00' },
        end: { date: '2026-07-22', time: '12:00' },
      }),
    ]);
    expect(result.input?.relations).toEqual([
      {
        factId: 'relation-dinner-before-study',
        kind: 'before',
        fromTaskId: 'task-dinner',
        toTaskId: 'task-study',
      },
    ]);
  });

  it('suppresses movable work and its blocking issues for a fixed task', () => {
    const graph = baseGraph();
    graph.workloads[1].unitCode = 'problem';
    graph.workloads[1].unitLabel = '問';
    graph.workloads[1].amount = 10;

    const result = compileGenericSchedulerInput({
      graph,
      context: context(),
    });

    expect(result.status).toBe('ready');
    expect(result.input?.movableWorkItems.map((item) => item.taskId))
      .toEqual(['task-study']);
    expect(result.issues).toContainEqual({
      domain: 'deduplication',
      code: 'fixed_task_movable_work_suppressed',
      blocking: false,
      factId: 'workload-dinner',
      details: {
        taskId: 'task-dinner',
        workItemId: expect.stringMatching(/^wpwi_/),
      },
    });
    expect(result.issues).not.toContainEqual(expect.objectContaining({
      domain: 'work_item',
      factId: 'workload-dinner',
      blocking: true,
    }));
  });

  it('returns no scheduler input after external source retries fail', () => {
    const graph = baseGraph();
    graph.constraintSourceRequests = [
      {
        id: 'source-request-timetable',
        kind: 'timetable',
        selector: 'active',
        requestedAction: 'use',
        resolutionStatus: 'unresolved',
        source: source('source-request-timetable', '時間割も使って'),
        createdRevision: 1,
      },
    ];

    const result = compileGenericSchedulerInput({
      graph,
      context: context(),
      externalSources: [failedTimetable()],
    });

    expect(result.status).toBe('needs_resolution');
    expect(result.input).toBeNull();
    expect(result.issues).toContainEqual(expect.objectContaining({
      domain: 'availability',
      code: 'constraint_source_unavailable',
      blocking: true,
      factId: 'source-request-timetable',
      details: {
        kind: 'timetable',
        failureKind: 'network_error',
        attemptCount: 3,
      },
    }));
  });

  it('includes authoritative occupied windows after a successful import', () => {
    const graph = baseGraph();
    graph.constraintSourceRequests = [
      {
        id: 'source-request-timetable',
        kind: 'timetable',
        selector: 'active',
        requestedAction: 'use',
        resolutionStatus: 'unresolved',
        source: source('source-request-timetable', '時間割も使って'),
        createdRevision: 1,
      },
    ];

    const result = compileGenericSchedulerInput({
      graph,
      context: context(),
      externalSources: [successfulTimetable()],
    });

    expect(result.status).toBe('ready');
    expect(result.input?.availabilityWindows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'occupied',
        sourceKind: 'timetable',
        sourceRef: 'class-1',
      }),
    ]));
    expect(result.input?.sourceSelections).toEqual([
      expect.objectContaining({
        status: 'selected',
        sourceId: 'timetable-1',
      }),
    ]);
  });

  it('accepts a successfully fetched source with no registered events', () => {
    const graph = baseGraph();
    graph.constraintSourceRequests = [
      {
        id: 'source-request-timetable',
        kind: 'timetable',
        selector: 'active',
        requestedAction: 'use',
        resolutionStatus: 'unresolved',
        source: source('source-request-timetable', '時間割も使って'),
        createdRevision: 1,
      },
    ];

    const result = compileGenericSchedulerInput({
      graph,
      context: context(),
      externalSources: [successfulTimetable([])],
    });

    expect(result.status).toBe('ready');
    expect(result.input).not.toBeNull();
    expect(result.input?.sourceSelections).toEqual([
      expect.objectContaining({ status: 'selected' }),
    ]);
    expect(result.input?.availabilityWindows).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceKind: 'timetable' }),
    ]));
  });

  it('blocks orphan and self relations', () => {
    const orphan = baseGraph();
    orphan.relations[0].toTaskId = 'missing-task';
    const orphanResult = compileGenericSchedulerInput({
      graph: orphan,
      context: context(),
    });
    expect(orphanResult.input).toBeNull();
    expect(orphanResult.issues).toContainEqual(expect.objectContaining({
      domain: 'relation',
      code: 'orphan_relation_task',
      blocking: true,
    }));

    const self = baseGraph();
    self.relations[0].toTaskId = 'task-dinner';
    const selfResult = compileGenericSchedulerInput({
      graph: self,
      context: context(),
    });
    expect(selfResult.input).toBeNull();
    expect(selfResult.issues).toContainEqual(expect.objectContaining({
      domain: 'relation',
      code: 'self_relation',
      blocking: true,
    }));
  });

  it('blocks unresolved movable work estimates instead of passing partial input', () => {
    const graph = baseGraph();
    graph.workloads[0].unitCode = 'problem';
    graph.workloads[0].unitLabel = '問';
    graph.workloads[0].amount = 10;

    const result = compileGenericSchedulerInput({
      graph,
      context: context(),
    });

    expect(result.status).toBe('needs_resolution');
    expect(result.input).toBeNull();
    expect(result.issues).toContainEqual(expect.objectContaining({
      domain: 'work_item',
      code: 'missing_effort_estimate',
      blocking: true,
      factId: 'workload-study',
    }));
  });

  it('allows a plan containing only fixed task reservations', () => {
    const graph = baseGraph();
    graph.workloads = graph.workloads.filter((item) => item.taskId === 'task-dinner');
    graph.tasks = graph.tasks.filter((task) => task.id === 'task-dinner');
    graph.relations = [];

    const result = compileGenericSchedulerInput({
      graph,
      context: context(),
    });

    expect(result.status).toBe('ready');
    expect(result.input?.movableWorkItems).toEqual([]);
    expect(result.input?.fixedTaskReservations).toHaveLength(1);
  });

  it('rejects invalid or ambiguous planning horizons', () => {
    const invalid = compileGenericSchedulerInput({
      graph: baseGraph(),
      context: context({ planningEndDate: '2026-02-30' }),
    });
    expect(invalid.input).toBeNull();
    expect(invalid.issues).toContainEqual(expect.objectContaining({
      domain: 'planning_horizon',
      code: 'invalid_planning_horizon',
    }));

    const ambiguousGraph = baseGraph();
    ambiguousGraph.planningWindows = [
      {
        id: 'window-1',
        kind: 'relative_day',
        value: 'today',
        start: null,
        end: null,
        source: source('window-1', '今日'),
        createdRevision: 1,
      },
      {
        id: 'window-2',
        kind: 'relative_day',
        value: 'tomorrow',
        start: null,
        end: null,
        source: source('window-2', '明日'),
        createdRevision: 1,
      },
    ];
    const ambiguous = compileGenericSchedulerInput({
      graph: ambiguousGraph,
      context: context(),
    });
    expect(ambiguous.input).toBeNull();
    expect(ambiguous.issues).toContainEqual(expect.objectContaining({
      domain: 'planning_horizon',
      code: 'ambiguous_planning_window',
    }));
  });
});
