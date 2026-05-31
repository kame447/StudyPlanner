import { describe, expect, it } from 'vitest';
import {
  calculateAutoEndTimeForCreate,
  calculateShiftedEndTimeForEdit,
  calculateTimeRangeDurationMinutes,
  formatMinutesToTime,
  minutesBetween,
  parseTimeToMinutes,
} from './date';

describe('time range utilities', () => {
  it('treats start 00:00 as day start and end 00:00 as day end', () => {
    expect(parseTimeToMinutes('00:00', 'start')).toBe(0);
    expect(parseTimeToMinutes('00:00', 'end')).toBe(24 * 60);
    expect(formatMinutesToTime(24 * 60, 'end')).toBe('24:00');
  });

  it('does not allow 24:00 as a start boundary', () => {
    expect(formatMinutesToTime(24 * 60, 'start')).toBe('23:59');
    expect(formatMinutesToTime(24 * 60, 'end')).toBe('24:00');
  });

  it('calculates create end times near the selected start time', () => {
    expect(calculateAutoEndTimeForCreate(parseTimeToMinutes('21:00'))).toBe('22:00');
    expect(calculateAutoEndTimeForCreate(parseTimeToMinutes('13:30'))).toBe('14:30');
    expect(calculateAutoEndTimeForCreate(parseTimeToMinutes('23:30'))).toBe('24:00');
    expect(calculateAutoEndTimeForCreate(parseTimeToMinutes('00:00'))).toBe('01:00');
  });

  it('preserves edit durations while clamping at 24:00', () => {
    expect(
      calculateShiftedEndTimeForEdit(
        parseTimeToMinutes('10:00'),
        calculateTimeRangeDurationMinutes('09:00', '13:00'),
      ),
    ).toBe('14:00');
    expect(
      calculateShiftedEndTimeForEdit(
        parseTimeToMinutes('19:00'),
        calculateTimeRangeDurationMinutes('18:30', '20:00'),
      ),
    ).toBe('20:30');
    expect(
      calculateShiftedEndTimeForEdit(
        parseTimeToMinutes('22:00'),
        calculateTimeRangeDurationMinutes('23:00', '00:00'),
      ),
    ).toBe('23:00');
    expect(
      calculateShiftedEndTimeForEdit(
        parseTimeToMinutes('22:00'),
        calculateTimeRangeDurationMinutes('20:00', '23:00'),
      ),
    ).toBe('24:00');
  });

  it('validates end-of-day ranges without wrapping earlier end times', () => {
    expect(minutesBetween('00:00', '01:00')).toBe(60);
    expect(minutesBetween('23:00', '00:00')).toBe(60);
    expect(minutesBetween('00:00', '00:00')).toBe(24 * 60);
    expect(minutesBetween('00:00', '24:00')).toBe(24 * 60);
    expect(minutesBetween('10:00', '09:00')).toBeLessThan(0);
    expect(minutesBetween('18:00', '17:59')).toBeLessThan(0);
  });

  it('keeps the only valid end near midnight at 24:00', () => {
    expect(calculateAutoEndTimeForCreate(parseTimeToMinutes('23:55'))).toBe('24:00');
    expect(
      calculateShiftedEndTimeForEdit(
        parseTimeToMinutes('23:55'),
        calculateTimeRangeDurationMinutes('23:00', '00:00'),
      ),
    ).toBe('24:00');
  });
});
