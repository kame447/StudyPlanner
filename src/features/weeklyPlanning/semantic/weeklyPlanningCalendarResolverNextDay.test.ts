import { describe, expect, it } from 'vitest';
import {
  isCanonicalDateExpressionSyntax,
  resolveCanonicalDateExpression,
} from './weeklyPlanningCalendarResolver';

describe('Stable V5 next-day canonical vocabulary', () => {
  it('accepts next_day as an unambiguous alias of tomorrow', () => {
    expect(isCanonicalDateExpressionSyntax('next_day')).toBe(true);
    expect(resolveCanonicalDateExpression({
      expression: 'next_day',
      currentDate: '2026-08-03',
    })).toEqual({
      status: 'resolved',
      range: {
        start: '2026-08-04',
        end: '2026-08-04',
      },
    });
  });

  it('keeps day_after_tomorrow distinct from next_day', () => {
    expect(resolveCanonicalDateExpression({
      expression: 'day_after_tomorrow',
      currentDate: '2026-08-03',
    })).toEqual({
      status: 'resolved',
      range: {
        start: '2026-08-05',
        end: '2026-08-05',
      },
    });
  });
});
