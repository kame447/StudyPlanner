import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV2,
  type AvailabilityDeclarationFact,
  type ConstraintSourceRequestFact,
  type WeeklyPlanningFactGraphV2,
} from './weeklyPlanningFactGraphV2';
import {
  resolveWeeklyPlanningDateExpressionsV5,
} from './weeklyPlanningResolvedDateExpressionsV5';
import {
  resolveWeeklyPlanningAvailability,
  type AvailabilityResolutionContext,
  type ExternalConstraintEvent,
  type ExternalConstraintSourceSnapshot,
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

function declaration(
  partial: Partial<AvailabilityDeclarationFact> = {},
): AvailabilityDeclarationFact {
  return {
    id: 'availability-1',
    kind: 'unavailable',
    dateExpression: null,
    namedTimePeriod: null,
    startTime: null,
    endTime: '18:00',
    recurrenceKind: 'weekdays',
    days: [],
    constraintLevel: 'hard',
    resolutionStatus: 'unresolved',
    source: source('availability-1', '平日は18時まで勉強できない'),
    createdRevision: 1,
    ...partial,
  };
}

function request(
  partial: Partial<ConstraintSourceRequestFact> = {},
): ConstraintSourceRequestFact {
  return {
    id: 'source-request-1',
    kind: 'timetable',
    selector: 'active',
    requestedAction: 'use',
    resolutionStatus: 'unresolved',
    source: source('source-request-1', '時間割も使って'),
    createdRevision: 1,
    ...partial,
  };
}

function graph(params: {
  declarations?: AvailabilityDeclarationFact[];
  requests?: ConstraintSourceRequestFact[];
} = {}): WeeklyPlanningFactGraphV2 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV2(),
    revision: 1,
    availabilityDeclarations: params.declarations ?? [],
    constraintSourceRequests: params.requests ?? [],
  };
}

function context(
  partial: Partial<AvailabilityResolutionContext> = {},
): AvailabilityResolutionContext {
  return {
    ownerId: 'user-1',
    currentDate: '2026-07-22',
    planningStartDate: '2026-07-20',
    planningEndDate: '2026-07-26',
    timeZone: 'Asia/Tokyo',
    namedTimePeriods: {
      morning: { startTime: '08:00', endTime: '12:00' },
    },
    ...partial,
  };
}

function classEvent(
  partial: Partial<ExternalConstraintEvent> = {},
): ExternalConstraintEvent {
  return {
    eventId: 'class-1',
    ownerId: 'user-1',
    start: { date: '2026-07-21', time: '09:00' },
    end: { date: '2026-07-21', time: '10:30' },
    timeZone: 'Asia/Tokyo',
    constraintLevel: 'hard',
    ...partial,
  };
}

function successfulTimetable(
  events: ExternalConstraintEvent[] = [classEvent()],
): ExternalConstraintSourceSnapshot {
  return {
    kind: 'timetable',
    status: 'success',
    ownerId: 'user-1',
    activeSourceId: 'timetable-active-1',
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
    failureKind: 'timeout',
    attemptCount: 3,
  };
}

function resolveAvailability(params: {
  value: WeeklyPlanningFactGraphV2;
  context?: AvailabilityResolutionContext;
  externalSources?: ExternalConstraintSourceSnapshot[];
}) {
  const resolutionContext = params.context ?? context();
  const resolvedDateExpressions = resolveWeeklyPlanningDateExpressionsV5({
    graph: params.value,
    currentDate: resolutionContext.currentDate,
    weekStartsOn: resolutionContext.weekStartsOn,
  });
  return resolveWeeklyPlanningAvailability({
    graph: params.value,
    context: resolutionContext,
    externalSources: params.externalSources,
    resolvedDateExpressions,
  });
}

describe('weekly planning availability resolver', () => {
  it('resolves recurring weekday unavailability without parsing source text', () => {
    const result = resolveAvailability({
      value: graph({ declarations: [declaration()] }),
    });

    expect(result.readiness).toBe('ready');
    expect(result.issues).toEqual([]);
    expect(result.windows).toHaveLength(5);
    expect(result.windows[0]).toMatchObject({
      kind: 'unavailable',
      start: { date: '2026-07-20', time: '00:00' },
      end: { date: '2026-07-20', time: '18:00' },
      timeZone: 'Asia/Tokyo',
      constraintLevel: 'hard',
      sourceKind: 'user_declaration',
      sourceRef: 'availability-1',
    });
  });

  it('resolves named weekend periods only from injected policy', () => {
    const result = resolveAvailability({
      value: graph({
        declarations: [declaration({
          id: 'availability-weekend',
          kind: 'preferred',
          namedTimePeriod: 'morning',
          endTime: null,
          recurrenceKind: 'weekends',
          constraintLevel: 'soft',
        })],
      }),
    });

    expect(result.windows).toHaveLength(2);
    expect(result.windows.map((window) => window.start.date)).toEqual([
      '2026-07-25',
      '2026-07-26',
    ]);
    expect(result.windows[0]).toMatchObject({
      kind: 'preferred',
      start: { time: '08:00' },
      end: { time: '12:00' },
      constraintLevel: 'soft',
    });
  });

  it('blocks unresolved named periods instead of inventing clock times', () => {
    const result = resolveAvailability({
      value: graph({
        declarations: [declaration({
          namedTimePeriod: 'before_sleep',
          endTime: null,
          recurrenceKind: 'daily',
        })],
      }),
      context: context({ namedTimePeriods: {} }),
    });

    expect(result.windows).toEqual([]);
    expect(result.readiness).toBe('needs_resolution');
    expect(result.issues).toContainEqual({
      code: 'named_time_period_unresolved',
      sourceFactId: 'availability-1',
      blocking: true,
      details: { namedTimePeriod: 'before_sleep' },
    });
  });

  it('resolves a canonical tomorrow anchor and open-ended availability', () => {
    const result = resolveAvailability({
      value: graph({
        declarations: [declaration({
          id: 'availability-tomorrow',
          kind: 'available',
          dateExpression: 'tomorrow',
          startTime: '20:00',
          endTime: null,
          recurrenceKind: null,
        })],
      }),
    });

    expect(result.windows).toEqual([
      expect.objectContaining({
        kind: 'available',
        start: { date: '2026-07-23', time: '20:00' },
        end: { date: '2026-07-24', time: '00:00' },
      }),
    ]);
  });

  it('keeps custom date expressions unresolved', () => {
    const result = resolveAvailability({
      value: graph({
        declarations: [declaration({
          dateExpression: 'custom:試験前日',
          recurrenceKind: null,
        })],
      }),
    });

    expect(result.windows).toEqual([]);
    expect(result.issues[0]).toMatchObject({
      code: 'unsupported_date_expression',
      sourceFactId: 'availability-1',
      blocking: true,
      details: { expression: 'custom:試験前日' },
    });
  });

  it('imports a successful owner-bound timetable and selects its source', () => {
    const result = resolveAvailability({
      value: graph({ requests: [request()] }),
      externalSources: [successfulTimetable()],
    });

    expect(result.readiness).toBe('ready');
    expect(result.issues).toEqual([]);
    expect(result.sourceSelections).toEqual([
      expect.objectContaining({
        requestFactId: 'source-request-1',
        kind: 'timetable',
        status: 'selected',
        sourceId: 'timetable-active-1',
        ownerId: 'user-1',
      }),
    ]);
    expect(result.windows).toEqual([
      expect.objectContaining({
        kind: 'occupied',
        sourceKind: 'timetable',
        sourceRef: 'class-1',
        start: { date: '2026-07-21', time: '09:00' },
        end: { date: '2026-07-21', time: '10:30' },
      }),
    ]);
  });

  it('treats success with zero events as a valid empty schedule', () => {
    const result = resolveAvailability({
      value: graph({ requests: [request()] }),
      externalSources: [successfulTimetable([])],
    });

    expect(result.readiness).toBe('ready');
    expect(result.windows).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.sourceSelections).toEqual([
      expect.objectContaining({
        status: 'selected',
        sourceId: 'timetable-active-1',
      }),
    ]);
  });

  it('does not treat a failed fetch as an empty schedule', () => {
    const result = resolveAvailability({
      value: graph({ requests: [request()] }),
      externalSources: [failedTimetable()],
    });

    expect(result.windows).toEqual([]);
    expect(result.sourceSelections).toEqual([]);
    expect(result.readiness).toBe('needs_resolution');
    expect(result.issues).toEqual([{
      code: 'constraint_source_unavailable',
      sourceFactId: 'source-request-1',
      blocking: true,
      details: {
        kind: 'timetable',
        failureKind: 'timeout',
        attemptCount: 3,
      },
    }]);
  });

  it('rejects the whole external source import on owner mismatch', () => {
    const result = resolveAvailability({
      value: graph({ requests: [request()] }),
      externalSources: [successfulTimetable([
        classEvent(),
        classEvent({ eventId: 'class-other-user', ownerId: 'user-2' }),
      ])],
    });

    expect(result.windows).toEqual([]);
    expect(result.sourceSelections).toEqual([]);
    expect(result.issues).toContainEqual({
      code: 'constraint_event_owner_mismatch',
      sourceFactId: 'source-request-1',
      blocking: true,
      details: { eventId: 'class-other-user' },
    });
  });

  it('handles stop_using without fetching or importing events', () => {
    const result = resolveAvailability({
      value: graph({ requests: [request({ requestedAction: 'stop_using' })] }),
      externalSources: [],
    });

    expect(result.windows).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.sourceSelections).toEqual([
      expect.objectContaining({
        status: 'deselected',
        sourceId: null,
      }),
    ]);
  });

  it('deduplicates repeated authoritative events by source identity and interval', () => {
    const event = classEvent();
    const result = resolveAvailability({
      value: graph({ requests: [request()] }),
      externalSources: [successfulTimetable([event, { ...event }])],
    });

    expect(result.windows).toHaveLength(1);
  });

  it('rejects invalid planning dates before resolving any facts', () => {
    const reversed = resolveAvailability({
      value: graph({ declarations: [declaration()] }),
      context: context({
        planningStartDate: '2026-07-27',
        planningEndDate: '2026-07-20',
      }),
    });
    expect(reversed.readiness).toBe('needs_resolution');
    expect(reversed.issues[0].code).toBe('invalid_planning_date_range');

    const impossible = resolveAvailability({
      value: graph({ declarations: [declaration()] }),
      context: context({ currentDate: '2026-02-30' }),
    });
    expect(impossible.readiness).toBe('needs_resolution');
    expect(impossible.issues[0].code).toBe('invalid_planning_date_range');
  });
});
