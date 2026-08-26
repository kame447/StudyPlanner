import { describe, expect, it } from 'vitest';
import { resolveWeeklyPlanningAvailabilityWithFullDayRules } from './weeklyPlanningAvailabilityFullDayAdapter';
import type { AvailabilityDeclarationFact } from './weeklyPlanningFactGraphV2';
import { resolveWeeklyPlanningDateExpressionsV5 } from './weeklyPlanningResolvedDateExpressionsV5';

function declaration(
  partial: Partial<AvailabilityDeclarationFact> = {},
): AvailabilityDeclarationFact {
  return {
    id: 'availability-tuesday',
    kind: 'unavailable',
    dateExpression: 'weekday:tuesday',
    namedTimePeriod: null,
    startTime: '18:00',
    endTime: '20:00',
    recurrenceKind: 'weekly',
    days: ['weekday:tuesday'],
    constraintLevel: 'hard',
    resolutionStatus: 'unresolved',
    source: {
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      semanticLocalId: 'availability-tuesday',
      sourceText: '火曜日の18時から20時は予定があるので避けてください',
      origin: 'user',
    },
    createdRevision: 1,
    ...partial,
  };
}

const context = {
  ownerId: 'user-1',
  currentDate: '2026-08-12',
  planningStartDate: '2026-08-17',
  planningEndDate: '2026-08-23',
  timeZone: 'Asia/Tokyo',
} as const;

function resolveAvailability(value: AvailabilityDeclarationFact) {
  const graph = {
    revision: 1,
    availabilityDeclarations: [value],
    constraintSourceRequests: [],
  };
  const resolvedDateExpressions = resolveWeeklyPlanningDateExpressionsV5({
    graph,
    currentDate: context.currentDate,
  });
  return resolveWeeklyPlanningAvailabilityWithFullDayRules({
    graph,
    context,
    externalSources: [],
    resolvedDateExpressions,
  });
}

describe('weeklyPlanningAvailabilityFullDayAdapter', () => {
  it('accepts canonical weekday:<day> values emitted by Stable V5 semantic normalization', () => {
    const result = resolveAvailability(declaration());

    expect(result.readiness).toBe('ready');
    expect(result.issues).toEqual([]);
    expect(result.windows).toEqual([
      expect.objectContaining({
        kind: 'unavailable',
        start: { date: '2026-08-18', time: '18:00' },
        end: { date: '2026-08-18', time: '20:00' },
        constraintLevel: 'hard',
      }),
    ]);
  });

  it('keeps legacy short weekday keys accepted during migration', () => {
    const result = resolveAvailability(declaration({
      dateExpression: null,
      days: ['tue'],
    }));

    expect(result.readiness).toBe('ready');
    expect(result.issues).toEqual([]);
    expect(result.windows[0]?.start.date).toBe('2026-08-18');
  });
});
