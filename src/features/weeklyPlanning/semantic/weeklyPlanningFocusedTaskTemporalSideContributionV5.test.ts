import { describe, expect, it } from 'vitest';
import {
  parseFocusedTaskTemporalSideContributionDecisionV5,
} from './weeklyPlanningFocusedTaskTemporalSideContributionV5';

const baseDecision = {
  decision: 'temporal_constraint',
  kind: 'deadline',
  constraintLevel: 'hard',
  namedTimePeriod: null,
  startTime: null,
  endTime: '13:00',
  precision: 'exact',
} as const;

describe('focused task temporal side-contribution date contract', () => {
  it('accepts canonical relative date tokens', () => {
    const parsed = parseFocusedTaskTemporalSideContributionDecisionV5(
      JSON.stringify({ ...baseDecision, dateExpression: 'tomorrow' }),
    );

    expect(parsed).toMatchObject({
      decision: 'temporal_constraint',
      kind: 'deadline',
      constraintLevel: 'hard',
      dateExpression: 'tomorrow',
      endTime: '13:00',
    });
  });

  it('accepts ISO calendar dates', () => {
    const parsed = parseFocusedTaskTemporalSideContributionDecisionV5(
      JSON.stringify({ ...baseDecision, dateExpression: '2026-08-27' }),
    );

    expect(parsed?.dateExpression).toBe('2026-08-27');
  });

  it('rejects raw natural-language date text at the typed boundary', () => {
    const parsed = parseFocusedTaskTemporalSideContributionDecisionV5(
      JSON.stringify({ ...baseDecision, dateExpression: '明日' }),
    );

    expect(parsed).toBeNull();
  });
});
