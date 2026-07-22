import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  calendarWeekday,
  intersectCalendarDates,
  isValidCalendarDate,
  listCalendarDatesInclusive,
  mondayOfCalendarWeek,
  resolveCanonicalDateExpression,
} from './weeklyPlanningCalendarResolver';

describe('weekly planning calendar resolver', () => {
  it('validates real calendar dates instead of only matching the shape', () => {
    expect(isValidCalendarDate('2026-07-22')).toBe(true);
    expect(isValidCalendarDate('2028-02-29')).toBe(true);
    expect(isValidCalendarDate('2026-02-29')).toBe(false);
    expect(isValidCalendarDate('2026-04-31')).toBe(false);
    expect(isValidCalendarDate('2026-7-22')).toBe(false);
  });

  it('adds days across month and year boundaries', () => {
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addCalendarDays('2028-02-29', 1)).toBe('2028-03-01');
    expect(addCalendarDays('invalid', 1)).toBeNull();
  });

  it('uses Monday as the weekly planning boundary', () => {
    expect(mondayOfCalendarWeek('2026-07-22')).toBe('2026-07-20');
    expect(mondayOfCalendarWeek('2026-07-26')).toBe('2026-07-20');
    expect(calendarWeekday('2026-07-20')).toBe(1);
  });

  it('resolves canonical relative expressions without re-parsing Japanese', () => {
    expect(resolveCanonicalDateExpression({
      expression: 'today',
      currentDate: '2026-07-22',
    })).toEqual({
      status: 'resolved',
      range: { start: '2026-07-22', end: '2026-07-22' },
    });
    expect(resolveCanonicalDateExpression({
      expression: 'tomorrow',
      currentDate: '2026-07-22',
    })).toEqual({
      status: 'resolved',
      range: { start: '2026-07-23', end: '2026-07-23' },
    });
    expect(resolveCanonicalDateExpression({
      expression: 'this_week',
      currentDate: '2026-07-22',
    })).toEqual({
      status: 'resolved',
      range: { start: '2026-07-20', end: '2026-07-26' },
    });
    expect(resolveCanonicalDateExpression({
      expression: 'next_week',
      currentDate: '2026-07-22',
    })).toEqual({
      status: 'resolved',
      range: { start: '2026-07-27', end: '2026-08-02' },
    });
  });

  it('keeps custom or arbitrary expressions unresolved', () => {
    expect(resolveCanonicalDateExpression({
      expression: 'custom:試験前',
      currentDate: '2026-07-22',
    })).toEqual({ status: 'unsupported_expression', range: null });
    expect(resolveCanonicalDateExpression({
      expression: '来週',
      currentDate: '2026-07-22',
    })).toEqual({ status: 'unsupported_expression', range: null });
  });

  it('rejects impossible absolute dates', () => {
    expect(resolveCanonicalDateExpression({
      expression: '2026-02-30',
      currentDate: '2026-07-22',
    })).toEqual({ status: 'invalid_absolute_date', range: null });
  });

  it('lists and intersects inclusive date ranges', () => {
    expect(listCalendarDatesInclusive('2026-07-20', '2026-07-22')).toEqual([
      '2026-07-20',
      '2026-07-21',
      '2026-07-22',
    ]);
    expect(intersectCalendarDates(
      ['2026-07-19', '2026-07-20', '2026-07-21', '2026-07-27'],
      '2026-07-20',
      '2026-07-26',
    )).toEqual(['2026-07-20', '2026-07-21']);
    expect(listCalendarDatesInclusive('2026-07-22', '2026-07-20')).toBeNull();
  });
});
