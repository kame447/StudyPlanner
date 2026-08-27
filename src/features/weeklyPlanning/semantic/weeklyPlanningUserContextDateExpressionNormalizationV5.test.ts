import { describe, expect, it } from 'vitest';
import { normalizeWeeklyPlanningUserContextDateExpressionsV5 } from './weeklyPlanningUserContextDateExpressionNormalizationV5';

function document(dateExpression: string | null) {
  return JSON.stringify({
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [{
      localId: 'event-1',
      kind: 'goal_event',
      label: '共通テスト',
      value: null,
      dateExpression,
      sourceText: '共通テストは2027年1月',
    }],
    uncertainties: [],
    corrections: [],
    decisions: [],
  });
}

describe('Stable V5 durable event date representation normalization', () => {
  it('preserves a month-precision provider interpretation as custom symbolic date', () => {
    const result = normalizeWeeklyPlanningUserContextDateExpressionsV5(document('2027-01'));
    const parsed = JSON.parse(result.rawResponse) as { userContextFacts: Array<{ dateExpression: string }> };
    expect(parsed.userContextFacts[0]?.dateExpression).toBe('custom:2027-01');
    expect(result.repairs).toEqual(['user-context-date-symbolic-normalized:0']);
  });

  it('does not rewrite an exact canonical date', () => {
    const rawResponse = document('2027-01-16');
    expect(normalizeWeeklyPlanningUserContextDateExpressionsV5(rawResponse)).toEqual({
      rawResponse,
      repairs: [],
    });
  });
});
