import { describe, expect, it } from 'vitest';
import { createInitialTracker, getElapsedMs, pauseTracker, resumeTracker, startTracker } from './actualTracking';
import { createDefaultPomodoroSettings, getPomodoroCompletedAt, getPomodoroProgress, resolvePomodoroSettings } from './pomodoroSession';
import { createStudySessionDraft } from './studySessionTarget';

const minute = 60_000;
const anchor = new Date(2026, 9, 13, 10, 0).getTime();
const details = { title: '数学', subject: '数学', material: null };
const target = { kind: 'unplanned' as const, userId: 'owner' };

describe('Pomodoro elapsed-time and Actual boundary', () => {
  it('excludes repeated pauses across focus/rest boundaries and includes both phases in Actual time', () => {
    const config = resolvePomodoroSettings({ preset: '50-10', setCount: 2 }, null);
    let tracker = startTracker(createInitialTracker(), anchor);
    tracker = pauseTracker(tracker, anchor + 25 * minute);
    tracker = pauseTracker(tracker, anchor + 35 * minute);
    tracker = resumeTracker(tracker, anchor + 45 * minute);
    tracker = resumeTracker(tracker, anchor + 50 * minute);
    expect(getPomodoroProgress(getElapsedMs(tracker, anchor + 70 * minute), config)).toMatchObject({
      phase: 'break', elapsedMs: 50 * minute, phaseRemainingMs: 10 * minute,
    });
    tracker = pauseTracker(tracker, anchor + 75 * minute);
    const paused = getPomodoroProgress(getElapsedMs(tracker, anchor + 95 * minute), config);
    expect(paused).toMatchObject({ phase: 'break', elapsedMs: 55 * minute, phaseRemainingMs: 5 * minute });
    const interimDraft = createStudySessionDraft(target, anchor, paused.elapsedMs, details);
    expect(interimDraft).toMatchObject({ actualStartTime: '10:00', actualEndTime: '10:55' });
    tracker = resumeTracker(tracker, anchor + 95 * minute);
    const final = getPomodoroProgress(getElapsedMs(tracker, anchor + 170 * minute), config);
    expect(final).toMatchObject({ phase: 'complete', elapsedMs: 120 * minute, completedSets: 2, isComplete: true });
    const draft = createStudySessionDraft(target, anchor, final.elapsedMs, details);
    expect(draft).toMatchObject({ actualStartTime: '10:00', actualEndTime: '12:00', planId: null });
  });

  it.each(['25-5', '50-10'] as const)('limits a late Finish measurement to the last break for %s', preset => {
    const config = resolvePomodoroSettings({ preset, setCount: 1 }, null);
    const tracker = startTracker(createInitialTracker(), anchor);
    const finishAt = anchor + 100 * minute;
    const measured = getPomodoroProgress(getElapsedMs(tracker, finishAt), config);
    expect(measured.elapsedMs).toBe(config.cycleMs);
    expect(measured.isComplete).toBe(true);
    const frozen = { ...tracker, runningFromMs: null, elapsedBeforeMs: measured.elapsedMs };
    expect(getElapsedMs(frozen, finishAt + 30 * minute)).toBe(config.cycleMs);
    expect(getPomodoroProgress(getElapsedMs(frozen, finishAt), config)).toEqual(measured);
  });

  it('keeps a fresh session independent of the settings and measurement of a prior one', () => {
    const first = createDefaultPomodoroSettings();
    first.preset = '50-10'; first.setCount = 12;
    const active = startTracker(createInitialTracker(), anchor);
    expect(getElapsedMs(active, anchor + minute)).toBe(minute);
    const nextSettings = createDefaultPomodoroSettings();
    expect(nextSettings).toEqual({ preset: '25-5', setCount: null });
    expect(getElapsedMs(createInitialTracker(), anchor + minute)).toBe(0);
  });
});


describe('Pomodoro completion wall time', () => {
  const config = resolvePomodoroSettings({ preset: '25-5', setCount: 1 }, null);

  it('preserves the exact finish time even when the next tick arrives the next day', () => {
    const evening = new Date(2026, 9, 13, 22, 0).getTime();
    const nextDay = new Date(2026, 9, 14, 12, 0).getTime();
    const tracker = startTracker(createInitialTracker(), evening);
    expect(getPomodoroCompletedAt(tracker, config, nextDay)).toBe(evening + 30 * minute);
  });

  it('includes pauses in wall completion without adding them to Actual duration', () => {
    const evening = new Date(2026, 9, 13, 23, 20).getTime();
    let tracker = startTracker(createInitialTracker(), evening);
    tracker = pauseTracker(tracker, evening + 10 * minute);
    tracker = resumeTracker(tracker, evening + 30 * minute);
    expect(getPomodoroCompletedAt(tracker, config, evening + 49 * minute)).toBeNull();
    expect(getPomodoroCompletedAt(tracker, config, evening + 50 * minute)).toBe(evening + 50 * minute);
    expect(getPomodoroProgress(getElapsedMs(tracker, evening + 50 * minute), config).elapsedMs).toBe(30 * minute);
  });

  it('does not invent completion for idle, paused, unfinished or unlimited timers', () => {
    const running = startTracker(createInitialTracker(), anchor);
    expect(getPomodoroCompletedAt(createInitialTracker(), config, anchor)).toBeNull();
    expect(getPomodoroCompletedAt(running, config, anchor + 29 * minute)).toBeNull();
    expect(getPomodoroCompletedAt(pauseTracker(running, anchor + 29 * minute), config, anchor + 60 * minute)).toBeNull();
    const unlimited = resolvePomodoroSettings(createDefaultPomodoroSettings(), 30 * minute);
    expect(getPomodoroCompletedAt(running, unlimited, anchor + 60 * minute)).toBeNull();
  });
});
