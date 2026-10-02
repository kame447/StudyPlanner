import { describe, expect, it } from 'vitest';
import {
  findPeriodNumberForTemplate,
  getPeriodTimeStatus,
  hasValidPeriodTime,
  templateVisibleInAlternatingWeek,
} from './timetableViewModel';
import type { ScheduleTemplateAlternatingWeek } from '../types/domain';

describe('timetable period validity', () => {
  it.each([
    [null, null],
    [null, '10:00'],
    ['09:00', null],
    ['', '10:00'],
    ['09:00', ''],
    ['', ''],
  ])('reports partial for %j–%j', (startTime, endTime) => {
    const period = { startTime, endTime };
    expect(getPeriodTimeStatus(period)).toBe('partial');
    expect(hasValidPeriodTime(period)).toBe(false);
  });

  it.each([
    ['09:00', '10:00', 'valid'],
    ['00:00', '00:01', 'valid'],
    ['23:00', '24:00', 'valid'],
    ['09:00', '09:00', 'invalid'],
    ['10:00', '09:00', 'invalid'],
    ['23:00', '00:00', 'invalid'],
    ['00:00', '00:00', 'invalid'],
    ['bad', '01:00', 'valid'],
    ['01:00', 'bad', 'invalid'],
    ['bad', 'bad', 'invalid'],
    ['09:', '10:00', 'valid'],
  ])('preserves %s–%s as %s', (startTime, endTime, expected) => {
    const period = { startTime, endTime };
    expect(getPeriodTimeStatus(period)).toBe(expected);
    expect(hasValidPeriodTime(period)).toBe(expected === 'valid');
  });
});

describe('timetable period matching', () => {
  const morning = { periodNumber: 1, startTime: '09:00', endTime: '10:00' };
  const later = { periodNumber: 2, startTime: '11:00', endTime: '12:00' };

  it('prefers an existing explicit number over an exact time match, even for an incomplete period', () => {
    expect(findPeriodNumberForTemplate(
      { periodNumber: 3, startTime: morning.startTime, endTime: morning.endTime },
      [morning, { periodNumber: 3, startTime: null, endTime: null }],
    )).toBe(3);
  });

  it('falls back from an absent explicit number to the first exact time match', () => {
    expect(findPeriodNumberForTemplate(
      { ...morning, periodNumber: 99 },
      [{ ...morning, periodNumber: 4 }, morning],
    )).toBe(4);
  });

  it('accepts an exact time match before checking period validity', () => {
    expect(findPeriodNumberForTemplate(
      { startTime: '12:00', endTime: '11:00' },
      [morning, { periodNumber: 3, startTime: '12:00', endTime: '11:00' }],
    )).toBe(3);
  });

  it('preserves null time-key matching for incomplete ranges', () => {
    expect(findPeriodNumberForTemplate(
      { startTime: '', endTime: '12:00' },
      [morning, { periodNumber: 3, startTime: '13:00', endTime: null }],
    )).toBe(3);
  });

  it('uses the nearest valid start time, ignoring the end-time distance', () => {
    expect(findPeriodNumberForTemplate(
      { startTime: '10:45', endTime: '10:50' },
      [morning, later],
    )).toBe(2);
  });

  it('preserves input order on an exact distance tie without mutating periods', () => {
    const periods = Object.freeze([Object.freeze(later), Object.freeze(morning)]);
    expect(findPeriodNumberForTemplate({ startTime: '10:00', endTime: '13:00' }, periods)).toBe(2);
    expect(periods).toEqual([later, morning]);
    expect(findPeriodNumberForTemplate({ startTime: '10:00', endTime: '13:00' }, [morning, later])).toBe(1);
  });

  it('excludes incomplete, reversed, and equal-time periods from nearest matching', () => {
    expect(findPeriodNumberForTemplate(
      { startTime: '10:00', endTime: '13:00' },
      [
        { periodNumber: 3, startTime: '10:00', endTime: null },
        { periodNumber: 4, startTime: '10:00', endTime: '09:00' },
        { periodNumber: 5, startTime: '10:00', endTime: '10:00' },
        later,
      ],
    )).toBe(2);
  });

  it('returns null when neither an exact match nor a valid period exists', () => {
    const template = { startTime: '10:00', endTime: '13:00' };
    expect(findPeriodNumberForTemplate(template, [])).toBeNull();
    expect(findPeriodNumberForTemplate(template, [
      { periodNumber: 3, startTime: null, endTime: null },
      { periodNumber: 4, startTime: '12:00', endTime: '11:00' },
    ])).toBeNull();
  });

  it.each(['00:00', 'bad', '09'])('uses the zero fallback when matching template start %j', (startTime) => {
    expect(findPeriodNumberForTemplate(
      { startTime, endTime: '03:00' },
      [morning, { periodNumber: 3, startTime: '00:00', endTime: '01:00' }],
    )).toBe(3);
  });

  it('does not treat a zero period number as an explicit match', () => {
    expect(findPeriodNumberForTemplate(
      { ...morning, periodNumber: 0 },
      [{ ...later, periodNumber: 0 }, morning],
    )).toBe(1);
  });
});

describe('timetable alternating-week visibility', () => {
  it.each<[ScheduleTemplateAlternatingWeek | undefined, boolean, boolean]>([
    [undefined, true, true],
    ['both', true, true],
    ['a', true, false],
    ['b', false, true],
  ])('filters scope %j only when alternating weeks are enabled', (alternatingWeek, visibleInA, visibleInB) => {
    const template = { alternatingWeek, weekInterval: 2, active: false };
    expect(templateVisibleInAlternatingWeek(template, true, 'a')).toBe(visibleInA);
    expect(templateVisibleInAlternatingWeek(template, true, 'b')).toBe(visibleInB);
    expect(templateVisibleInAlternatingWeek(template, false, 'a')).toBe(true);
    expect(templateVisibleInAlternatingWeek(template, false, 'b')).toBe(true);
  });
});
