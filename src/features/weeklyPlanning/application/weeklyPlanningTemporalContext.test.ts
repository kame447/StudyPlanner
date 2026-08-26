import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningTurnRequestContext,
  resolveWeeklyPlanningPlanningHorizon,
} from './weeklyPlanningTemporalContext';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type TemporalConstraintFactV5,
  type WeeklyPlanningFactGraphV5,
} from '../semantic/weeklyPlanningFactGraphV5';

function source(id: string, sourceText: string) {
  return {
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    semanticLocalId: id,
    sourceText,
    origin: 'user' as const,
  };
}

function graphWithWindow(value: string): WeeklyPlanningFactGraphV5 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 1,
    planningWindows: [{
      id: 'window-1',
      kind: 'relative_week',
      value,
      start: null,
      end: null,
      source: source('window-local-1', '来週の予定を立てたい'),
      createdRevision: 1,
    }],
    factLifecycles: [{
      factId: 'window-1',
      status: 'active',
      createdRevision: 1,
      terminalRevision: null,
      supersededByFactId: null,
    }],
  };
}

function graphWithRecurringBound(params: {
  kind: Extract<TemporalConstraintFactV5['kind'], 'earliest_start' | 'deadline' | 'latest_end'>;
  dateExpression: string;
  constraintLevel?: TemporalConstraintFactV5['constraintLevel'];
  constraintStatus?: 'active' | 'removed';
}): WeeklyPlanningFactGraphV5 {
  const constraintStatus = params.constraintStatus ?? 'active';
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: constraintStatus === 'active' ? 1 : 2,
    tasks: [{
      id: 'task-1',
      category: 'study',
      title: '金フレ',
      source: source('task-1', '金フレ'),
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
      source: source('workload-1', '毎日1時間'),
      createdRevision: 1,
    }],
    recurrences: [{
      id: 'recurrence-1',
      taskId: 'task-1',
      targetFactId: 'task-1',
      kind: 'daily',
      count: null,
      days: [],
      source: source('recurrence-1', '毎日'),
      createdRevision: 1,
    }],
    temporalConstraints: [{
      id: 'constraint-1',
      taskId: 'task-1',
      targetFactId: 'task-1',
      kind: params.kind,
      constraintLevel: params.constraintLevel ?? 'hard',
      dateExpression: params.dateExpression,
      namedTimePeriod: null,
      startTime: null,
      endTime: null,
      precision: 'exact',
      source: source('constraint-1', params.dateExpression),
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
      {
        factId: 'recurrence-1',
        status: 'active',
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      },
      {
        factId: 'constraint-1',
        status: constraintStatus,
        createdRevision: 1,
        terminalRevision: constraintStatus === 'active' ? null : 2,
        supersededByFactId: null,
      },
    ],
  };
}

describe('weekly planning temporal context', () => {
  it('captures the user-local request date independently from the displayed calendar date', () => {
    const context = createWeeklyPlanningTurnRequestContext({
      startedAtIso: '2026-08-11T05:55:30.000Z',
      timeZone: 'Asia/Tokyo',
      weekStartsOn: 'monday',
    });

    expect(context).toMatchObject({
      startedAtIso: '2026-08-11T05:55:30.000Z',
      timeZone: 'Asia/Tokyo',
      currentDate: '2026-08-11',
      currentTime: '14:55',
      notBeforeDate: '2026-08-11',
      notBeforeTime: '14:56',
      weekStartsOn: 'monday',
    });
  });

  it('resolves next_week from the request date, not selectedDate', () => {
    const requestContext = createWeeklyPlanningTurnRequestContext({
      startedAtIso: '2026-08-11T05:55:00.000Z',
      timeZone: 'Asia/Tokyo',
      weekStartsOn: 'monday',
    });

    expect(resolveWeeklyPlanningPlanningHorizon({
      graph: graphWithWindow('next_week'),
      selectedDate: '2026-09-10',
      requestContext,
    })).toEqual({ startDate: '2026-08-17', endDate: '2026-08-23' });
  });

  it('honors Sunday-start personalization when grounding next_week', () => {
    const requestContext = createWeeklyPlanningTurnRequestContext({
      startedAtIso: '2026-08-11T05:55:00.000Z',
      timeZone: 'Asia/Tokyo',
      weekStartsOn: 'sunday',
    });

    expect(resolveWeeklyPlanningPlanningHorizon({
      graph: graphWithWindow('next_week'),
      selectedDate: '2026-09-10',
      requestContext,
    })).toEqual({ startDate: '2026-08-16', endDate: '2026-08-22' });
  });

  it('reuses a previously proposed absolute range instead of shifting the same relative fact on a later date', () => {
    const laterRequestContext = createWeeklyPlanningTurnRequestContext({
      startedAtIso: '2026-08-18T05:55:00.000Z',
      timeZone: 'Asia/Tokyo',
      weekStartsOn: 'monday',
    });

    expect(resolveWeeklyPlanningPlanningHorizon({
      graph: graphWithWindow('next_week'),
      selectedDate: '2026-09-10',
      requestContext: laterRequestContext,
      groundingRecords: [{
        id: 'grounding:window-1:2026-08-17:2026-08-23',
        targetFactId: 'window-1',
        interpretationKind: 'relative_date_resolution',
        status: 'proposed',
        sourceExpression: 'next_week',
        startDate: '2026-08-17',
        endDate: '2026-08-23',
        proposedAtTurnId: 'request-1',
        acceptedAtTurnId: null,
      }],
    })).toEqual({ startDate: '2026-08-17', endDate: '2026-08-23' });
  });

  it('uses selectedDate only as the fallback seed when the user has no planning window', () => {
    const requestContext = createWeeklyPlanningTurnRequestContext({
      startedAtIso: '2026-08-11T05:55:00.000Z',
      timeZone: 'Asia/Tokyo',
      weekStartsOn: 'monday',
    });

    expect(resolveWeeklyPlanningPlanningHorizon({
      graph: createEmptyWeeklyPlanningFactGraphV5(),
      selectedDate: '2026-09-10',
      requestContext,
    })).toEqual({ startDate: '2026-09-10', endDate: '2026-09-16' });
  });

  it('extends the fallback horizon through a hard deadline for simple per-occurrence recurrence', () => {
    const requestContext = createWeeklyPlanningTurnRequestContext({
      startedAtIso: '2026-08-26T08:40:00.000Z',
      timeZone: 'Asia/Tokyo',
      weekStartsOn: 'monday',
    });

    expect(resolveWeeklyPlanningPlanningHorizon({
      graph: graphWithRecurringBound({
        kind: 'deadline',
        dateExpression: '2026-09-07',
      }),
      selectedDate: '2026-08-26',
      requestContext,
    })).toEqual({ startDate: '2026-08-26', endDate: '2026-09-07' });
  });

  it('keeps a default seven-day scheduling span after a future hard earliest start', () => {
    const requestContext = createWeeklyPlanningTurnRequestContext({
      startedAtIso: '2026-08-26T08:40:00.000Z',
      timeZone: 'Asia/Tokyo',
      weekStartsOn: 'monday',
    });

    expect(resolveWeeklyPlanningPlanningHorizon({
      graph: graphWithRecurringBound({
        kind: 'earliest_start',
        dateExpression: '2026-09-04',
      }),
      selectedDate: '2026-08-26',
      requestContext,
    })).toEqual({ startDate: '2026-08-26', endDate: '2026-09-10' });
  });

  it('does not extend the fallback horizon for soft or inactive recurring bounds', () => {
    const requestContext = createWeeklyPlanningTurnRequestContext({
      startedAtIso: '2026-08-26T08:40:00.000Z',
      timeZone: 'Asia/Tokyo',
      weekStartsOn: 'monday',
    });

    expect(resolveWeeklyPlanningPlanningHorizon({
      graph: graphWithRecurringBound({
        kind: 'deadline',
        dateExpression: '2026-09-07',
        constraintLevel: 'soft',
      }),
      selectedDate: '2026-08-26',
      requestContext,
    })).toEqual({ startDate: '2026-08-26', endDate: '2026-09-01' });

    expect(resolveWeeklyPlanningPlanningHorizon({
      graph: graphWithRecurringBound({
        kind: 'latest_end',
        dateExpression: '2026-09-07',
        constraintStatus: 'removed',
      }),
      selectedDate: '2026-08-26',
      requestContext,
    })).toEqual({ startDate: '2026-08-26', endDate: '2026-09-01' });
  });

  it('caps the not-before time at 24:00 instead of rolling deictic today into tomorrow', () => {
    const context = createWeeklyPlanningTurnRequestContext({
      startedAtIso: '2026-08-11T14:59:30.000Z',
      timeZone: 'Asia/Tokyo',
      weekStartsOn: 'monday',
    });

    expect(context.currentDate).toBe('2026-08-11');
    expect(context.currentTime).toBe('23:59');
    expect(context.notBeforeDate).toBe('2026-08-11');
    expect(context.notBeforeTime).toBe('24:00');
  });
});
