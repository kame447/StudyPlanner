import { describe, expect, it } from 'vitest';
import { createInitialTracker, pauseTracker, resumeTracker, startTracker } from './actualTracking';
import { resolvePomodoroSettings } from './pomodoroSession';
import { getStudySessionFinishMeasurement } from './studySessionFinish';

const minute = 60_000;
const at = (hour: number, minute = 0) => new Date(2026, 9, 20, hour, minute).getTime();
const finite = resolvePomodoroSettings({ preset: '25-5', setCount: 1 }, null);

describe('study session finish measurement', () => {
  it('does not manufacture a record before explicit start', () => {
    expect(getStudySessionFinishMeasurement(createInitialTracker(), at(12), null, null)).toBeNull();
  });

  it.each([0, 500, 1000, 59_000, 60_000, 90_000])('keeps the timer and stored-range floors distinct at %i ms', duration => {
    const tracker = startTracker(createInitialTracker(), at(12));
    expect(getStudySessionFinishMeasurement(tracker, at(12) + duration, null, null)).toEqual({
      anchorMs: at(12), elapsedMs: Math.max(duration, 1000), storedDurationMs: Math.max(duration, minute),
      pomodoroCompletedAt: null, crossesLocalDate: false,
    });
    expect(tracker).toEqual({ anchorMs: at(12), runningFromMs: at(12), elapsedBeforeMs: 0 });
  });

  it('uses the finite completion instant, not a next-day finish click', () => {
    const tracker = startTracker(createInitialTracker(), at(22));
    expect(getStudySessionFinishMeasurement(tracker, at(32), finite, null)).toMatchObject({
      elapsedMs: 30 * minute, pomodoroCompletedAt: at(22, 30), crossesLocalDate: false,
    });
  });

  it('preserves an already observed completion instant on a paused timer', () => {
    const tracker = { anchorMs: at(22), runningFromMs: null, elapsedBeforeMs: 30 * minute };
    expect(getStudySessionFinishMeasurement(tracker, at(32), finite, at(22, 30))).toMatchObject({
      elapsedMs: 30 * minute, pomodoroCompletedAt: at(22, 30), crossesLocalDate: false,
    });
  });

  it('excludes pauses from measurement but includes them when classifying the actual completion date', () => {
    let tracker = startTracker(createInitialTracker(), at(23));
    tracker = pauseTracker(tracker, at(23, 10));
    tracker = resumeTracker(tracker, at(24, 10));
    expect(getStudySessionFinishMeasurement(tracker, at(25), finite, null)).toMatchObject({
      elapsedMs: 30 * minute, storedDurationMs: 30 * minute,
      pomodoroCompletedAt: at(24, 30), crossesLocalDate: true,
    });
  });

  it('retains date adjustment when the minimum stored minute crosses midnight', () => {
    const anchor = at(24) - 500;
    const tracker = startTracker(createInitialTracker(), anchor);
    expect(getStudySessionFinishMeasurement(tracker, anchor, null, null)).toMatchObject({
      elapsedMs: 1000, storedDurationMs: minute, crossesLocalDate: true,
    });
  });

  it('does not cap the automatic planned goal or unlimited Pomodoro mode', () => {
    const tracker = startTracker(createInitialTracker(), at(12));
    for (const plannedMs of [null, 30 * minute]) {
      const automatic = resolvePomodoroSettings({ preset: '25-5', setCount: null }, plannedMs);
      expect(getStudySessionFinishMeasurement(tracker, at(13), automatic, null)).toMatchObject({
        elapsedMs: 60 * minute, pomodoroCompletedAt: null,
      });
    }
  });

  it('keeps a paused round-trip measurement stable without counting the time spent editing', () => {
    const tracker = pauseTracker(startTracker(createInitialTracker(), at(12)), at(12, 10));
    const initial = getStudySessionFinishMeasurement(tracker, at(12, 10), null, null);
    expect(getStudySessionFinishMeasurement(tracker, at(13), null, null)).toEqual(initial);
  });
});
