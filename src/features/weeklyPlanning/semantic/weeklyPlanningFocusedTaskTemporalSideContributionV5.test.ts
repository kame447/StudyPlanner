import { describe, expect, it } from 'vitest';
import {
  FOCUSED_TASK_TEMPORAL_SIDE_CONTRIBUTION_RESPONSE_FORMAT_V5,
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
  it('constrains named periods to the parser-supported canonical vocabulary', () => {
    const schema = FOCUSED_TASK_TEMPORAL_SIDE_CONTRIBUTION_RESPONSE_FORMAT_V5.json_schema.schema;
    const namedTimePeriod = (schema.properties as Record<string, unknown>).namedTimePeriod;
    expect(namedTimePeriod).toEqual({
      anyOf: [
        { type: 'string', enum: [
          'morning', 'afternoon', 'evening', 'night',
          'before_sleep', 'before_meal', 'after_meal',
        ] },
        { type: 'string', pattern: '^custom:.+$' },
        { type: 'null' },
      ],
    });
    expect(parseFocusedTaskTemporalSideContributionDecisionV5(JSON.stringify({
      ...baseDecision, dateExpression: 'tomorrow', namedTimePeriod: 'weekday_evening',
    }))).toBeNull();
  });
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
