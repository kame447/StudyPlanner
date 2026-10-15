import { describe, expect, it } from 'vitest';
import { elapsedEntryMinutes, entryTimeRangeForDate, getEntryDurationMinutes, isValidPlanEntryTimeRange, resolveEntryEndTime } from './entryTimeRange';
import { minutesBetween } from './date';

describe('Plan/Actual overnight interval', () => {
  it.each([
    ['19:00', '20:00', 60], ['23:30', '00:30', 60], ['23:30', '00:00', 30],
    ['23:30', '24:00', 30], ['00:00', '00:00', 1440], ['00:00', '24:00', 1440],
    ['12:30', '12:30', 0], ['23:59', '00:01', 2],
  ])('%s–%s has %i minutes without changing same-day validators', (start, end, duration) => {
    expect(getEntryDurationMinutes(start, end)).toBe(duration);
    expect(minutesBetween('23:30', '00:30')).toBe(-1380);
  });
  it.each([
    ['', '00:30'], ['24:00', '00:30'], ['23:60', '00:30'], ['23:30', '24:01'],
    ['25:00', '00:30'], ['-1:00', '00:30'], ['9:00', '10:00'], ['09:00', 'garbage'],
    ['09:00:00', '10:00'], ['09:00', '10:00 '],
  ])('rejects malformed clocks %s–%s instead of wrapping them', (start, end) => {
    expect(getEntryDurationMinutes(start, end)).toBe(0);
    expect(entryTimeRangeForDate('2026-10-31', start, end, '2026-10-31')).toBeNull();
  });
  it.each([
    ['2026-10-15', '2026-10-16'], ['2026-10-31', '2026-11-01'], ['2026-12-31', '2027-01-01'],
  ])('clips %s overnight into the next day %s without changing its source', (start, next) => {
    expect(entryTimeRangeForDate(start, '23:30', '00:30', start)).toEqual({ startTime: '23:30', endTime: '24:00' });
    expect(entryTimeRangeForDate(start, '23:30', '00:30', next)).toEqual({ startTime: '00:00', endTime: '00:30' });
    expect(entryTimeRangeForDate(start, '23:30', '00:00', next)).toBeNull();
    expect(entryTimeRangeForDate(start, '23:30', '24:00', next)).toBeNull();
    expect(elapsedEntryMinutes(start, '23:30', '00:30', start, '23:45')).toBe(15);
    expect(elapsedEntryMinutes(start, '23:30', '00:30', next, '00:10')).toBe(40);
    expect(elapsedEntryMinutes(start, '23:30', '00:30', next, '10:00')).toBe(60);
  });
  it('keeps class-related plans restricted to valid same-day ranges', () => {
    expect(isValidPlanEntryTimeRange({ startTime: '23:30', endTime: '00:30' })).toBe(true);
    expect(isValidPlanEntryTimeRange({ startTime: '23:30', endTime: '00:30', classTemplateId: 'class' })).toBe(false);
    expect(isValidPlanEntryTimeRange({ startTime: '23:30', endTime: '24:00', classTemplateId: 'class' })).toBe(true);
    expect(isValidPlanEntryTimeRange({ startTime: '23:30', endTime: 'garbage', classTemplateId: 'class' })).toBe(false);
  });
  it('uses validated integer durations and retains the midnight boundary', () => {
    expect(resolveEntryEndTime('23:30', 60)).toBe('00:30');
    expect(resolveEntryEndTime('23:30', 30)).toBe('24:00');
    for (const duration of [0, -1, 1.5, NaN, Infinity, 1440]) expect(resolveEntryEndTime('23:30', duration)).toBeNull();
    expect(resolveEntryEndTime('24:00', 60)).toBeNull();
  });
});
