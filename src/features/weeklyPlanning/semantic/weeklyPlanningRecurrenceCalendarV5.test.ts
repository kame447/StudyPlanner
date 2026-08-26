import { describe, expect, it } from 'vitest';
import {
  isWeeklyPlanningCalendarExpandableRecurrenceV5,
  resolveWeeklyPlanningCalendarRecurrenceDatesV5,
} from './weeklyPlanningRecurrenceCalendarV5';

const dates = [
  '2026-08-24',
  '2026-08-25',
  '2026-08-26',
  '2026-08-27',
  '2026-08-28',
  '2026-08-29',
  '2026-08-30',
];

describe('weekly planning recurrence calendar semantics', () => {
  it('expands daily, weekdays, and weekends deterministically', () => {
    expect(resolveWeeklyPlanningCalendarRecurrenceDatesV5({
      kind: 'daily',
      days: [],
      dates,
    })).toEqual({ calendarDates: dates, invalidDays: [] });

    expect(resolveWeeklyPlanningCalendarRecurrenceDatesV5({
      kind: 'weekdays',
      days: [],
      dates,
    })).toEqual({
      calendarDates: dates.slice(0, 5),
      invalidDays: [],
    });

    expect(resolveWeeklyPlanningCalendarRecurrenceDatesV5({
      kind: 'weekends',
      days: [],
      dates,
    })).toEqual({
      calendarDates: dates.slice(5),
      invalidDays: [],
    });
  });

  it('uses the same canonical weekday set for weekly and custom recurrences', () => {
    const expected = ['2026-08-26', '2026-08-28', '2026-08-30'];

    expect(resolveWeeklyPlanningCalendarRecurrenceDatesV5({
      kind: 'weekly',
      days: ['wed', 'fri', 'sun'],
      dates,
    })).toEqual({ calendarDates: expected, invalidDays: [] });

    expect(resolveWeeklyPlanningCalendarRecurrenceDatesV5({
      kind: 'custom',
      days: ['wed', 'fri', 'sun'],
      dates,
    })).toEqual({ calendarDates: expected, invalidDays: [] });
  });

  it('keeps count-only frequency recurrence outside calendar expansion', () => {
    for (const days of [[], ['wed', 'fri']]) {
      expect(resolveWeeklyPlanningCalendarRecurrenceDatesV5({
        kind: 'times_per_week',
        days,
        dates,
      })).toEqual({ calendarDates: null, invalidDays: [] });
      expect(isWeeklyPlanningCalendarExpandableRecurrenceV5({
        kind: 'times_per_week',
        days,
      })).toBe(false);
    }
  });

  it('keeps ungrounded weekly and custom recurrence outside calendar expansion', () => {
    for (const kind of ['weekly', 'custom'] as const) {
      expect(resolveWeeklyPlanningCalendarRecurrenceDatesV5({
        kind,
        days: [],
        dates,
      })).toEqual({ calendarDates: null, invalidDays: [] });
      expect(isWeeklyPlanningCalendarExpandableRecurrenceV5({ kind, days: [] })).toBe(false);
    }
  });

  it('reports non-canonical weekday tokens without inventing a meaning', () => {
    expect(resolveWeeklyPlanningCalendarRecurrenceDatesV5({
      kind: 'custom',
      days: ['wed', '水曜', 'sun'],
      dates,
    })).toEqual({
      calendarDates: ['2026-08-26', '2026-08-30'],
      invalidDays: ['水曜'],
    });
    expect(isWeeklyPlanningCalendarExpandableRecurrenceV5({
      kind: 'custom',
      days: ['wed', '水曜', 'sun'],
    })).toBe(false);
  });
});
