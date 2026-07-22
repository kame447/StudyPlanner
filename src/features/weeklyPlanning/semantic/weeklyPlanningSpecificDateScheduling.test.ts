import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV2,
  type WeeklyPlanningFactGraphV2,
} from './weeklyPlanningFactGraphV2';
import { compileGenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';

function source(id: string, text = id) {
  return {
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    semanticLocalId: id,
    sourceText: text,
    origin: 'user' as const,
  };
}

function taskGraph(): WeeklyPlanningFactGraphV2 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV2(),
    revision: 1,
    planningWindows: [{
      id: 'window-1',
      kind: 'absolute',
      value: '2026-07-24',
      start: '2026-07-24',
      end: '2026-07-24',
      source: source('window-1', '7月24日の予定'),
      createdRevision: 1,
    }],
    tasks: [{
      id: 'task-study',
      category: 'study',
      title: '英単語',
      source: source('task-study'),
      createdRevision: 1,
    }],
    workloads: [{
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
      source: source('workload-study'),
      createdRevision: 1,
    }],
  };
}

const context = {
  ownerId: 'user-1',
  currentDate: '2026-07-22',
  planningStartDate: '2026-07-24',
  planningEndDate: '2026-07-24',
  timeZone: 'Asia/Tokyo',
};

describe('specific date scheduling integration', () => {
  it('supports a plan whose horizon is one specific day', () => {
    const result = compileGenericSchedulerInput({
      graph: taskGraph(),
      context,
    });

    expect(result.status).toBe('ready');
    expect(result.input?.horizon).toMatchObject({
      startDate: '2026-07-24',
      endDate: '2026-07-24',
    });
  });

  it('passes task-only and task-excluded dates to the scheduler', () => {
    const graph = taskGraph();
    graph.taskDateRules = [
      {
        id: 'allow-24',
        taskId: 'task-study',
        targetFactId: 'task-study',
        kind: 'allowed_date',
        dateExpression: '2026-07-24',
        constraintLevel: 'hard',
        source: source('allow-24', '英単語は24日だけ'),
        createdRevision: 1,
      },
      {
        id: 'exclude-25',
        taskId: 'task-study',
        targetFactId: 'task-study',
        kind: 'excluded_date',
        dateExpression: '2026-07-25',
        constraintLevel: 'hard',
        source: source('exclude-25', '25日は英単語をやらない'),
        createdRevision: 1,
      },
    ];

    const result = compileGenericSchedulerInput({
      graph,
      context: { ...context, planningEndDate: '2026-07-26' },
    });

    expect(result.status).toBe('ready');
    expect(result.input?.taskDateEligibilities).toEqual([{
      taskId: 'task-study',
      allowedDates: ['2026-07-24'],
      excludedDates: ['2026-07-25'],
      sourceFactIds: ['allow-24', 'exclude-25'],
    }]);
    expect(result.input?.sourceFactRefs).toEqual(expect.arrayContaining([
      'allow-24',
      'exclude-25',
    ]));
  });

  it('treats a hard date-only unavailable declaration as a whole-day break', () => {
    const graph = taskGraph();
    graph.availabilityDeclarations = [{
      id: 'break-24',
      kind: 'unavailable',
      dateExpression: '2026-07-24',
      namedTimePeriod: null,
      startTime: null,
      endTime: null,
      recurrenceKind: null,
      days: [],
      constraintLevel: 'hard',
      resolutionStatus: 'unresolved',
      source: source('break-24', '24日は何も予定を入れない'),
      createdRevision: 1,
    }];

    const result = compileGenericSchedulerInput({ graph, context });

    expect(result.status).toBe('ready');
    expect(result.input?.availabilityWindows).toContainEqual(expect.objectContaining({
      kind: 'unavailable',
      start: { date: '2026-07-24', time: '00:00' },
      end: { date: '2026-07-25', time: '00:00' },
      constraintLevel: 'hard',
      sourceRef: 'break-24',
    }));
  });

  it('removes excluded dates from recurring fixed reservations', () => {
    const graph = taskGraph();
    graph.tasks.push({
      id: 'task-dinner',
      category: 'non_study',
      title: '夕食',
      source: source('task-dinner'),
      createdRevision: 1,
    });
    graph.temporalConstraints = [{
      id: 'dinner-time',
      taskId: 'task-dinner',
      targetFactId: 'task-dinner',
      kind: 'fixed_interval',
      dateExpression: 'this_week',
      namedTimePeriod: null,
      startTime: '18:00',
      endTime: '19:00',
      precision: 'exact',
      constraintLevel: 'hard',
      source: source('dinner-time'),
      createdRevision: 1,
    }];
    graph.taskDateRules = [{
      id: 'skip-dinner-25',
      taskId: 'task-dinner',
      targetFactId: 'task-dinner',
      kind: 'excluded_date',
      dateExpression: '2026-07-25',
      constraintLevel: 'hard',
      source: source('skip-dinner-25'),
      createdRevision: 1,
    }];

    const result = compileGenericSchedulerInput({
      graph,
      context: {
        ...context,
        planningStartDate: '2026-07-20',
        planningEndDate: '2026-07-26',
      },
    });

    expect(result.status).toBe('ready');
    const dinnerDates = result.input?.fixedTaskReservations
      .filter((reservation) => reservation.taskId === 'task-dinner')
      .map((reservation) => reservation.start.date);
    expect(dinnerDates).not.toContain('2026-07-25');
    expect(dinnerDates).toHaveLength(6);
  });
});
