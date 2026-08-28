import { describe, expect, it } from 'vitest';
import {
  normalizeWeeklyPlanningUserContextPartialDatesV5,
  resolveWeeklyPlanningUserContextPartialDateV5,
} from './weeklyPlanningUserContextPartialDateNormalizationV5';

function documentWithDate(dateExpression: string, kind = 'goal_event'): string {
  return JSON.stringify({
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [{
      localId: 'context-event',
      kind,
      label: '試験',
      value: null,
      dateExpression,
      sourceText: '試験があります',
    }],
    uncertainties: [],
    corrections: [],
    decisions: [],
  });
}

describe('Stable V5 durable goal-event partial date normalization', () => {
  it('resolves structured, compact, and custom-wrapped month expressions', () => {
    expect(resolveWeeklyPlanningUserContextPartialDateV5('year:2027;month:01')).toEqual({
      start: '2027-01-01',
      end: '2027-01-31',
    });
    expect(resolveWeeklyPlanningUserContextPartialDateV5('2027-01')).toEqual({
      start: '2027-01-01',
      end: '2027-01-31',
    });
    expect(resolveWeeklyPlanningUserContextPartialDateV5('2027-02-late')).toEqual({
      start: '2027-02-21',
      end: '2027-02-28',
    });
    expect(resolveWeeklyPlanningUserContextPartialDateV5('custom:2028-02-late')).toEqual({
      start: '2028-02-21',
      end: '2028-02-29',
    });
  });

  it('canonicalizes provider-interpreted goal-event periods to ISO date ranges', () => {
    const result = normalizeWeeklyPlanningUserContextPartialDatesV5(
      documentWithDate('2027-02-late'),
    );
    const parsed = JSON.parse(result.rawResponse) as {
      userContextFacts: Array<{ dateExpression: string }>;
    };

    expect(parsed.userContextFacts[0]?.dateExpression).toBe('2027-02-21/2027-02-28');
    expect(result.repairs).toEqual([
      'user-context-partial-date-canonicalized:0:2027-02-21/2027-02-28',
    ]);
  });

  it('leaves invalid or non-goal-event expressions untouched', () => {
    const invalid = normalizeWeeklyPlanningUserContextPartialDatesV5(
      documentWithDate('2027-13'),
    );
    expect(invalid.repairs).toEqual([]);
    expect(invalid.rawResponse).toBe(documentWithDate('2027-13'));

    const concern = normalizeWeeklyPlanningUserContextPartialDatesV5(
      documentWithDate('2027-01', 'concern'),
    );
    expect(concern.repairs).toEqual([]);
  });
});
