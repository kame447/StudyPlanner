import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV2,
  type AvailabilityDeclarationFact,
} from './weeklyPlanningFactGraphV2';
import { resolveWeeklyPlanningAvailability } from './weeklyPlanningAvailabilityResolver';
import {
  resolveWeeklyPlanningDateExpressionsV5,
} from './weeklyPlanningResolvedDateExpressionsV5';

function source(id: string) {
  return {
    conversationId: 'availability-recurrence-conversation',
    turnId: 'turn-1',
    semanticLocalId: id,
    sourceText: id,
    origin: 'user' as const,
  };
}

function declaration(days: string[]): AvailabilityDeclarationFact {
  return {
    id: 'availability-custom',
    kind: 'unavailable',
    dateExpression: null,
    namedTimePeriod: null,
    startTime: '18:00',
    endTime: '20:00',
    recurrenceKind: 'custom',
    days,
    constraintLevel: 'hard',
    resolutionStatus: 'unresolved',
    source: source('availability-custom'),
    createdRevision: 1,
  };
}

const context = {
  ownerId: 'owner-1',
  currentDate: '2026-08-26',
  planningStartDate: '2026-08-24',
  planningEndDate: '2026-08-30',
  timeZone: 'Asia/Tokyo',
} as const;

function resolve(days: string[]) {
  const graph = {
    ...createEmptyWeeklyPlanningFactGraphV2(),
    revision: 1,
    availabilityDeclarations: [declaration(days)],
  };
  const resolvedDateExpressions = resolveWeeklyPlanningDateExpressionsV5({
    graph,
    currentDate: context.currentDate,
  });
  return resolveWeeklyPlanningAvailability({
    graph,
    context,
    resolvedDateExpressions,
  });
}

describe('weekly planning availability recurrence calendar integration', () => {
  it('uses canonical custom weekdays from the shared recurrence calendar', () => {
    const result = resolve(['wed', 'fri', 'sun']);

    expect(result.readiness).toBe('ready');
    expect(result.issues).toEqual([]);
    expect(result.windows.map((window) => window.start.date)).toEqual([
      '2026-08-26',
      '2026-08-28',
      '2026-08-30',
    ]);
  });

  it('keeps a non-canonical weekday blocking instead of inventing a meaning', () => {
    const result = resolve(['wed', '水曜']);

    expect(result.readiness).toBe('needs_resolution');
    expect(result.windows).toEqual([]);
    expect(result.issues).toContainEqual({
      code: 'invalid_weekday',
      sourceFactId: 'availability-custom',
      blocking: true,
      details: { day: '水曜' },
    });
  });
});
