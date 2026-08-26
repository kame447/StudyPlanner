import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import { compileGenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import { scheduleWeeklyPlanningStableV5Preview } from './weeklyPlanningStableV5PreviewScheduler';

function source(id: string) {
  return {
    conversationId: 'relative-hard-date-reference',
    turnId: 'turn-1',
    semanticLocalId: id,
    sourceText: '相対日付の範囲で毎日1時間やる',
    origin: 'user' as const,
  };
}

function graph(dateExpression = 'tomorrow'): WeeklyPlanningFactGraphV5 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 1,
    tasks: [{
      id: 'task-1',
      category: 'study',
      title: '金フレ',
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
      perOccurrence: true,
      periodExpression: '毎日',
      source: source('workload-1'),
      createdRevision: 1,
    }],
    temporalConstraints: [
      {
        id: 'earliest-start-1',
        taskId: 'task-1',
        targetFactId: 'task-1',
        kind: 'earliest_start',
        constraintLevel: 'hard',
        dateExpression,
        namedTimePeriod: null,
        startTime: null,
        endTime: null,
        precision: 'exact',
        source: source('earliest-start-1'),
        createdRevision: 1,
      },
      {
        id: 'latest-end-1',
        taskId: 'task-1',
        targetFactId: 'task-1',
        kind: 'latest_end',
        constraintLevel: 'hard',
        dateExpression,
        namedTimePeriod: null,
        startTime: null,
        endTime: null,
        precision: 'exact',
        source: source('latest-end-1'),
        createdRevision: 1,
      },
    ],
    recurrences: [{
      id: 'recurrence-1',
      taskId: 'task-1',
      targetFactId: 'task-1',
      kind: 'daily',
      count: null,
      days: [],
      source: source('recurrence-1'),
      createdRevision: 1,
    }],
  };
}

describe('Stable V5 relative hard-date reference', () => {
  it('resolves relative hard bounds from the request date instead of the planning-horizon start', () => {
    const value = graph();
    const compiled = compileGenericSchedulerInput({
      graph: value,
      context: {
        ownerId: 'owner-1',
        currentDate: '2026-08-26',
        planningStartDate: '2026-08-27',
        planningEndDate: '2026-09-02',
        timeZone: 'Asia/Tokyo',
      },
    });

    expect(compiled.status).toBe('ready');
    expect(compiled.input?.movableWorkItems.map((item) => item.requiredDate)).toEqual([
      '2026-08-27',
    ]);

    const scheduled = scheduleWeeklyPlanningStableV5Preview({
      input: compiled.input!,
      graph: value,
    });

    expect(scheduled.status).toBe('ready');
    expect(scheduled.candidates.map((candidate) => candidate.date)).toEqual([
      '2026-08-27',
    ]);
  });

  it('preserves the user week-start convention when resolving relative hard bounds', () => {
    const value = graph('this_week');
    const expectedDates = [
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
    ];
    const compiled = compileGenericSchedulerInput({
      graph: value,
      context: {
        ownerId: 'owner-1',
        currentDate: '2026-08-30',
        planningStartDate: '2026-08-30',
        planningEndDate: '2026-09-05',
        timeZone: 'Asia/Tokyo',
        weekStartsOn: 'sunday',
      },
    });

    expect(compiled.status).toBe('ready');
    expect(compiled.input?.movableWorkItems.map((item) => item.requiredDate)).toEqual(expectedDates);
    expect(compiled.input?.horizon).toMatchObject({
      referenceDate: '2026-08-30',
      weekStartsOn: 'sunday',
    });

    const scheduled = scheduleWeeklyPlanningStableV5Preview({
      input: compiled.input!,
      graph: value,
    });

    expect(scheduled.status).toBe('ready');
    expect(scheduled.candidates.map((candidate) => candidate.date)).toEqual(expectedDates);
  });
});
