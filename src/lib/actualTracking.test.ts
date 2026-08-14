import { describe, expect, it } from 'vitest';
import {
  buildMeasuredRange,
  clampTimerMinutes,
  formatDurationDisplay,
  formatTimerInputValue,
  getElapsedMs,
  parseTimerInputValue,
} from './actualTracking';

describe('actualTracking', () => {
  it('formats elapsed duration without negative values', () => {
    expect(formatDurationDisplay(3_661_000)).toBe('01:01:01');
    expect(formatDurationDisplay(-1_000)).toBe('00:00:00');
  });

  it('adds running time to previously elapsed time', () => {
    expect(
      getElapsedMs(
        {
          anchorMs: 1_000,
          runningFromMs: 2_000,
          elapsedBeforeMs: 3_000,
        },
        7_000,
      ),
    ).toBe(8_000);
  });

  it('keeps paused trackers at their accumulated elapsed time', () => {
    expect(
      getElapsedMs(
        {
          anchorMs: 1_000,
          runningFromMs: null,
          elapsedBeforeMs: 3_000,
        },
        7_000,
      ),
    ).toBe(3_000);
  });

  it('clamps timer minutes to the supported sub-day range', () => {
    expect(clampTimerMinutes(Number.NaN)).toBe(30);
    expect(clampTimerMinutes(0)).toBe(1);
    expect(clampTimerMinutes(2_000)).toBe(1_439);
  });

  it('formats and parses timer input values consistently', () => {
    expect(formatTimerInputValue(90)).toBe('01:30');
    expect(parseTimerInputValue('01:30', 15)).toBe(90);
    expect(parseTimerInputValue('invalid', 45)).toBe(45);
  });

  it('projects a measured duration into local clock times', () => {
    const start = new Date(2026, 7, 14, 10, 5, 0, 0).getTime();

    expect(buildMeasuredRange(start, 65 * 60 * 1000)).toEqual({
      startTime: '10:05',
      endTime: '11:10',
    });
  });
});
