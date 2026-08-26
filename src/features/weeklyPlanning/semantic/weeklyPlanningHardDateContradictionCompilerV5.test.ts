import { describe, expect, it } from 'vitest';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './weeklyPlanningActiveSchedulerGraphViewV5';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type PlanningFactLifecycleEntryV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import { compileGenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';

function source(id: string) {
  return {
    conversationId: 'hard-date-contradiction',
    turnId: 'turn-1',
    semanticLocalId: id,
    sourceText: id,
    origin: 'user' as const,
  };
}

function active(factId: string): PlanningFactLifecycleEntryV5 {
  return {
    factId,
    status: 'active',
    createdRevision: 1,
    terminalRevision: null,
    supersededByFactId: null,
  };
}

function graph(perOccurrence: boolean): WeeklyPlanningFactGraphV5 {
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
      perOccurrence,
      periodExpression: perOccurrence ? '毎日' : null,
      source: source('workload-1'),
      createdRevision: 1,
    }],
    temporalConstraints: [
      {
        id: 'earliest-1',
        taskId: 'task-1',
        targetFactId: 'task-1',
        kind: 'earliest_start',
        constraintLevel: 'hard',
        dateExpression: '2026-08-30',
        namedTimePeriod: null,
        startTime: '09:00',
        endTime: null,
        precision: 'exact',
        source: source('earliest-1'),
        createdRevision: 1,
      },
      {
        id: 'deadline-1',
        taskId: 'task-1',
        targetFactId: 'task-1',
        kind: 'deadline',
        constraintLevel: 'hard',
        dateExpression: '2026-08-27',
        namedTimePeriod: null,
        startTime: null,
        endTime: null,
        precision: 'exact',
        source: source('deadline-1'),
        createdRevision: 1,
      },
    ],
    recurrences: perOccurrence
      ? [{
          id: 'recurrence-1',
          taskId: 'task-1',
          targetFactId: 'task-1',
          kind: 'daily',
          count: null,
          days: [],
          source: source('recurrence-1'),
          createdRevision: 1,
        }]
      : [],
    factLifecycles: [
      active('task-1'),
      active('workload-1'),
      active('earliest-1'),
      active('deadline-1'),
      ...(perOccurrence ? [active('recurrence-1')] : []),
    ],
  };
}

function compile(perOccurrence: boolean) {
  return compileGenericSchedulerInput({
    graph: createWeeklyPlanningActiveSchedulerGraphViewV5(graph(perOccurrence)),
    context: {
      ownerId: 'owner-1',
      currentDate: '2026-08-26',
      planningStartDate: '2026-08-26',
      planningEndDate: '2026-09-01',
      timeZone: 'Asia/Tokyo',
    },
  });
}

describe('weekly planning hard date contradiction compiler boundary', () => {
  it.each([false, true])(
    'returns needs_resolution before distribution or placement (perOccurrence=%s)',
    (perOccurrence) => {
      const result = compile(perOccurrence);

      expect(result.status).toBe('needs_resolution');
      expect(result.input).toBeNull();
      expect(result.issues).toContainEqual(expect.objectContaining({
        domain: 'temporal_constraint',
        code: 'contradictory_hard_date_bound',
        blocking: true,
        details: expect.objectContaining({
          taskId: 'task-1',
          targetFactId: 'task-1',
          startDate: '2026-08-30',
          endDate: '2026-08-27',
        }),
      }));
    },
  );
});
