import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV2,
  type WeeklyPlanningFactGraphV2,
} from './weeklyPlanningFactGraphV2';
import { compileGenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';

function source(id: string) {
  return {
    conversationId: 'request-clock-date-contract',
    turnId: 'turn-1',
    semanticLocalId: id,
    sourceText: id,
    origin: 'user' as const,
  };
}

function graph(): WeeklyPlanningFactGraphV2 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV2(),
    revision: 1,
    tasks: [{
      id: 'task-1',
      category: 'study',
      title: '英単語',
      source: source('task-1'),
      createdRevision: 1,
    }],
    workloads: [{
      id: 'workload-1',
      taskId: 'task-1',
      componentId: null,
      quantityRole: 'target',
      amount: 30,
      unitCode: 'minute',
      unitLabel: '分',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      source: source('workload-1'),
      createdRevision: 1,
    }],
  };
}

const schedulerContext = {
  ownerId: 'owner-1',
  currentDate: '2026-08-26',
  weekStartsOn: 'sunday' as const,
  planningStartDate: '2026-08-30',
  planningEndDate: '2026-09-05',
  timeZone: 'Asia/Tokyo',
};

const sundayStartNextWeek = [
  '2026-08-30',
  '2026-08-31',
  '2026-09-01',
  '2026-09-02',
  '2026-09-03',
  '2026-09-04',
  '2026-09-05',
];

describe('weekly planning request-clock date expression contract', () => {
  it('keeps Sunday-start next_week for task date rules', () => {
    const value = graph();
    value.taskDateRules = [{
      id: 'date-rule-1',
      taskId: 'task-1',
      targetFactId: 'task-1',
      kind: 'allowed_date',
      dateExpression: 'next_week',
      constraintLevel: 'hard',
      source: source('date-rule-1'),
      createdRevision: 1,
    }];

    const result = compileGenericSchedulerInput({ graph: value, context: schedulerContext });

    expect(result.status).toBe('ready');
    expect(result.input?.taskDateEligibilities[0]?.allowedDates).toEqual(sundayStartNextWeek);
  });

  it('keeps Sunday-start next_week for fixed commitments', () => {
    const value = graph();
    value.temporalConstraints = [{
      id: 'commitment-1',
      taskId: 'task-1',
      targetFactId: 'task-1',
      kind: 'fixed_interval',
      constraintLevel: 'hard',
      dateExpression: 'next_week',
      namedTimePeriod: null,
      startTime: '18:00',
      endTime: '19:00',
      precision: 'exact',
      source: source('commitment-1'),
      createdRevision: 1,
    }];

    const result = compileGenericSchedulerInput({ graph: value, context: schedulerContext });

    expect(result.status).toBe('ready');
    expect(result.input?.fixedTaskReservations.map((item) => item.start.date))
      .toEqual(sundayStartNextWeek);
  });

  it('keeps Sunday-start next_week for availability declarations', () => {
    const value = graph();
    value.availabilityDeclarations = [{
      id: 'availability-1',
      kind: 'unavailable',
      dateExpression: 'next_week',
      namedTimePeriod: null,
      startTime: '10:00',
      endTime: '11:00',
      recurrenceKind: null,
      days: [],
      constraintLevel: 'hard',
      resolutionStatus: 'unresolved',
      source: source('availability-1'),
      createdRevision: 1,
    }];

    const result = compileGenericSchedulerInput({ graph: value, context: schedulerContext });

    expect(result.status).toBe('ready');
    expect(result.input?.availabilityWindows.map((item) => item.start.date))
      .toEqual(sundayStartNextWeek);
  });
});
