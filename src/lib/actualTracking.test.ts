import { describe, expect, it } from 'vitest';
import {
  buildMeasuredRange,
  createInitialTracker,
  startTracker,
  pauseTracker,
  resumeTracker,
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


describe('study timer transitions', () => {
  it('starts only once and ignores a resume or pause before starting', () => {
    const idle = createInitialTracker();
    expect(pauseTracker(idle, 1000)).toBe(idle);
    expect(resumeTracker(idle, 1000)).toBe(idle);
    const started = startTracker(idle, 1000);
    expect(started).toEqual({ anchorMs: 1000, runningFromMs: 1000, elapsedBeforeMs: 0 });
    expect(startTracker(started, 9000)).toBe(started);
  });

  it('repeated pause and resume exclude pauses without losing a running segment', () => {
    let tracker = startTracker(createInitialTracker(), 1000);
    tracker = pauseTracker(tracker, 11000);
    expect(pauseTracker(tracker, 21000)).toBe(tracker);
    tracker = resumeTracker(tracker, 31000);
    expect(resumeTracker(tracker, 41000)).toBe(tracker);
    expect(getElapsedMs(tracker, 51000)).toBe(30000);
    tracker = pauseTracker(tracker, 51000);
    tracker = resumeTracker(tracker, 71000);
    expect(getElapsedMs(tracker, 81000)).toBe(40000);
    expect(tracker.anchorMs).toBe(1000);
  });

  it('counts the full delayed running span and starts a fresh session on reset', () => {
    const running = startTracker(createInitialTracker(), 1000);
    expect(getElapsedMs(pauseTracker(running, 7201000), 9999999)).toBe(7200000);
    const reset = createInitialTracker();
    expect(reset).toEqual({ anchorMs: null, runningFromMs: null, elapsedBeforeMs: 0 });
    expect(startTracker(reset, 9000000)).toEqual({ anchorMs: 9000000, runningFromMs: 9000000, elapsedBeforeMs: 0 });
  });
});
