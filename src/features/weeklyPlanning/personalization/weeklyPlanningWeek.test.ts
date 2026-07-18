import { describe, expect, it } from 'vitest';
import {
  endOfWeeklyPlanningWeek,
  nextWeekdayOnOrAfter,
  resolveWeekendRange,
  startOfWeeklyPlanningWeek,
} from './weeklyPlanningWeek';

describe('weekly planning week boundary', () => {
  it('resolves Monday and Sunday based weeks independently', () => {
    expect(startOfWeeklyPlanningWeek('2026-07-18', 'monday')).toBe('2026-07-13');
    expect(endOfWeeklyPlanningWeek('2026-07-18', 'monday')).toBe('2026-07-19');
    expect(startOfWeeklyPlanningWeek('2026-07-18', 'sunday')).toBe('2026-07-12');
    expect(endOfWeeklyPlanningWeek('2026-07-18', 'sunday')).toBe('2026-07-18');
  });

  it('finds Sunday boundaries without depending on the configured week start', () => {
    expect(nextWeekdayOnOrAfter('2026-07-18', 0)).toBe('2026-07-19');
    expect(nextWeekdayOnOrAfter('2026-07-19', 0)).toBe('2026-07-19');
  });

  it('keeps weekend wording as Saturday through Sunday', () => {
    expect(resolveWeekendRange('2026-07-17')).toEqual({
      startDate: '2026-07-18',
      endDate: '2026-07-19',
    });
    expect(resolveWeekendRange('2026-07-19')).toEqual({
      startDate: '2026-07-19',
      endDate: '2026-07-19',
    });
  });
});
