import { describe, expect, it } from 'vitest';
import {
  createDefaultPomodoroSettings,
  getPomodoroProgress,
  isValidPomodoroSetCount,
  resolvePomodoroSettings,
} from './pomodoroSession';

const minute = 60_000;

describe('Pomodoro session settings', () => {
  it('retains the 25/5 preset and automatic planned or unlimited unplanned baseline', () => {
    const settings = createDefaultPomodoroSettings();
    expect(settings).toEqual({ preset: '25-5', setCount: null });
    expect(resolvePomodoroSettings(settings, null)).toEqual({
      focusMs: 25 * minute, breakMs: 5 * minute, cycleMs: 30 * minute,
      totalSets: null, targetDurationMs: null, stopAfterMs: null,
    });
    expect(resolvePomodoroSettings(settings, 61 * minute).totalSets).toBe(3);
    expect(resolvePomodoroSettings(settings, 0).totalSets).toBe(1);
  });

  it('derives automatic sets from the selected 50/10 cycle and honors explicit sets', () => {
    expect(resolvePomodoroSettings({ preset: '50-10', setCount: null }, 61 * minute)).toEqual({
      focusMs: 50 * minute, breakMs: 10 * minute, cycleMs: 60 * minute,
      totalSets: 2, targetDurationMs: 120 * minute, stopAfterMs: null,
    });
    expect(resolvePomodoroSettings({ preset: '50-10', setCount: 3 }, 30 * minute).totalSets).toBe(3);
    expect(resolvePomodoroSettings({ preset: '50-10', setCount: 1 }, null).targetDurationMs).toBe(60 * minute);
  });

  it.each([0, -1, 1.5, 13, NaN, Infinity])('rejects an invalid explicit set count %s', setCount => {
    expect(isValidPomodoroSetCount(setCount)).toBe(false);
    expect(() => resolvePomodoroSettings({ preset: '25-5', setCount }, null)).toThrow();
  });

  it.each([1, 2, 12])('accepts an explicit set count %s', setCount => {
    expect(isValidPomodoroSetCount(setCount)).toBe(true);
    expect(resolvePomodoroSettings({ preset: '25-5', setCount }, null).totalSets).toBe(setCount);
  });

  it('takes a value snapshot so later settings changes cannot retime an active cycle', () => {
    const settings = createDefaultPomodoroSettings();
    const active = resolvePomodoroSettings(settings, 90 * minute);
    settings.preset = '50-10'; settings.setCount = 1;
    expect(active).toEqual({ focusMs: 25 * minute, breakMs: 5 * minute, cycleMs: 30 * minute, totalSets: 3, targetDurationMs: 90 * minute, stopAfterMs: null });
    expect(getPomodoroProgress(26 * minute, active).phaseRemainingMs).toBe(4 * minute);
  });
});

describe.each([
  { preset: '25-5' as const, focus: 25, rest: 5 },
  { preset: '50-10' as const, focus: 50, rest: 10 },
])('$preset phase lifecycle', ({ preset, focus, rest }) => {
  const config = resolvePomodoroSettings({ preset, setCount: 2 }, null);
  const focusMs = focus * minute;
  const cycleMs = (focus + rest) * minute;

  it('starts at the complete focus duration with no elapsed progress', () => {
    expect(getPomodoroProgress(0, config)).toEqual({
      phase: 'focus', elapsedMs: 0, isComplete: false, phaseElapsedMs: 0, phaseDurationMs: focusMs,
      phaseRemainingMs: focusMs, progressDegrees: 0, currentSet: 1,
      completedSets: 0, goalReached: false,
    });
  });

  it('transitions exactly at focus and rest boundaries without losing one millisecond', () => {
    expect(getPomodoroProgress(focusMs - 1, config)).toMatchObject({ phase: 'focus', phaseRemainingMs: 1, currentSet: 1 });
    expect(getPomodoroProgress(focusMs, config)).toMatchObject({ phase: 'break', phaseRemainingMs: rest * minute, progressDegrees: 0, currentSet: 1 });
    expect(getPomodoroProgress(cycleMs - 1, config)).toMatchObject({ phase: 'break', phaseRemainingMs: 1, currentSet: 1, completedSets: 0 });
    expect(getPomodoroProgress(cycleMs, config)).toMatchObject({ phase: 'focus', phaseRemainingMs: focusMs, currentSet: 2, completedSets: 1, goalReached: false });
  });

  it('completes a one-set session only after its break and caps delayed measurement', () => {
    const oneSet = resolvePomodoroSettings({ preset, setCount: 1 }, null);
    expect(getPomodoroProgress(focusMs, oneSet).goalReached).toBe(false);
    expect(getPomodoroProgress(cycleMs - 1, oneSet).goalReached).toBe(false);
    expect(getPomodoroProgress(cycleMs, oneSet)).toMatchObject({ goalReached: true, completedSets: 1, currentSet: 1, phase: 'complete', isComplete: true, elapsedMs: cycleMs, phaseRemainingMs: 0, progressDegrees: 360 });
    expect(getPomodoroProgress(cycleMs + minute, oneSet)).toMatchObject({ goalReached: true, phase: 'complete', elapsedMs: cycleMs, phaseRemainingMs: 0 });
  });

  it('caps a delayed background tick at the exact multi-set completion boundary', () => {
    expect(getPomodoroProgress(2 * cycleMs - 1, config)).toMatchObject({ isComplete: false, phase: 'break', phaseRemainingMs: 1, currentSet: 2 });
    expect(getPomodoroProgress(2 * cycleMs, config)).toMatchObject({ isComplete: true, phase: 'complete', elapsedMs: 2 * cycleMs, completedSets: 2, phaseRemainingMs: 0 });
    expect(getPomodoroProgress(3 * cycleMs + minute, config)).toEqual(getPomodoroProgress(2 * cycleMs, config));
  });

  it('preserves manual continuation after an automatic planned goal', () => {
    const automatic = resolvePomodoroSettings({ preset, setCount: null }, 2 * cycleMs);
    const elapsed = 3 * cycleMs + focusMs + 2 * minute;
    expect(automatic.stopAfterMs).toBeNull();
    expect(getPomodoroProgress(elapsed, automatic)).toMatchObject({
      phase: 'break', elapsedMs: elapsed, isComplete: false, phaseRemainingMs: (rest - 2) * minute,
      currentSet: 2, completedSets: 3, goalReached: true,
    });
  });

  it('keeps unplanned unlimited progress uncapped and treats a negative elapsed as not started', () => {
    const unlimited = resolvePomodoroSettings({ preset, setCount: null }, null);
    expect(getPomodoroProgress(20 * cycleMs, unlimited)).toMatchObject({ currentSet: 21, completedSets: 20, goalReached: false });
    expect(getPomodoroProgress(-minute, config)).toEqual(getPomodoroProgress(0, config));
  });
});
