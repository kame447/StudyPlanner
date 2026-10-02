import { describe, expect, it } from 'vitest';
import { timetableTimeToMinutes } from './timetableTime';

describe('timetableTimeToMinutes', () => {
  it.each([
    ['00:00', 0],
    ['00:01', 1],
    ['09:30', 570],
    ['23:59', 1439],
    ['24:00', 1440],
  ])('converts %s to %i minutes without an end-of-day special case', (time, expected) => {
    expect(timetableTimeToMinutes(time)).toBe(expected);
  });

  it.each(['', '09', 'invalid', 'bad:30', '09:bad', 'Infinity:00', '09:Infinity'])(
    'falls back to zero for missing or non-finite components in %j',
    (time) => {
      expect(timetableTimeToMinutes(time)).toBe(0);
    },
  );

  it.each([
    ['09:', 540],
    [':30', 30],
    [':', 0],
    [' 09 : 30 ', 570],
    ['09:30:bad', 570],
    ['25:70', 1570],
    ['-1:30', -30],
  ])('preserves permissive numeric conversion for %j', (time, expected) => {
    expect(timetableTimeToMinutes(time)).toBe(expected);
  });
});
