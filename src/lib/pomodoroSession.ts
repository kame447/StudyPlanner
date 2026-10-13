import { getElapsedMs, type TrackerState } from './actualTracking';

export type PomodoroPreset = '25-5' | '50-10';

export interface PomodoroSettings {
  preset: PomodoroPreset;
  // null preserves the session's automatic planned goal or unplanned unlimited mode.
  setCount: number | null;
}

export interface ResolvedPomodoroSettings {
  focusMs: number;
  breakMs: number;
  cycleMs: number;
  totalSets: number | null;
  targetDurationMs: number | null;
  // Only an explicit count stops measurement; automatic goals keep legacy behavior.
  stopAfterMs: number | null;
}

export interface PomodoroProgress {
  phase: 'focus' | 'break' | 'complete';
  elapsedMs: number;
  isComplete: boolean;
  phaseElapsedMs: number;
  phaseDurationMs: number;
  phaseRemainingMs: number;
  progressDegrees: number;
  currentSet: number;
  completedSets: number;
  goalReached: boolean;
}

export const POMODORO_MAX_SETS = 12;

export function createDefaultPomodoroSettings(): PomodoroSettings {
  return { preset: '25-5', setCount: null };
}

export function isValidPomodoroSetCount(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= POMODORO_MAX_SETS;
}

export function resolvePomodoroSettings(
  settings: PomodoroSettings,
  plannedMs: number | null,
): ResolvedPomodoroSettings {
  if (settings.setCount !== null && !isValidPomodoroSetCount(settings.setCount)) {
    throw new RangeError('ポモドーロのセット数が範囲外です。');
  }
  const focusMs = (settings.preset === '50-10' ? 50 : 25) * 60_000;
  const breakMs = (settings.preset === '50-10' ? 10 : 5) * 60_000;
  const cycleMs = focusMs + breakMs;
  const totalSets = settings.setCount ?? (plannedMs === null
    ? null : Math.max(1, Math.ceil(plannedMs / cycleMs)));
  return {
    focusMs, breakMs, cycleMs, totalSets,
    targetDurationMs: totalSets === null ? null : totalSets * cycleMs,
    stopAfterMs: settings.setCount === null ? null : settings.setCount * cycleMs,
  };
}

// Derive phase from the active elapsed time so delayed/background ticks do not drift.
// A set includes its break. Explicit counts cap measurement; automatic goals do not.
export function getPomodoroProgress(
  elapsedMs: number,
  settings: ResolvedPomodoroSettings,
): PomodoroProgress {
  const elapsed = Math.max(0, Math.min(elapsedMs, settings.stopAfterMs ?? Number.POSITIVE_INFINITY));
  const isComplete = settings.stopAfterMs !== null && elapsed >= settings.stopAfterMs;
  const elapsedInCycle = elapsed % settings.cycleMs;
  const phase = isComplete ? 'complete' : elapsedInCycle < settings.focusMs ? 'focus' : 'break';
  const phaseElapsedMs = isComplete ? settings.breakMs
    : phase === 'focus' ? elapsedInCycle : elapsedInCycle - settings.focusMs;
  const phaseDurationMs = phase === 'focus' ? settings.focusMs : settings.breakMs;
  const completedSets = Math.floor(elapsed / settings.cycleMs);
  return {
    phase,
    elapsedMs: elapsed,
    isComplete,
    phaseElapsedMs,
    phaseDurationMs,
    phaseRemainingMs: phaseDurationMs - phaseElapsedMs,
    progressDegrees: (phaseElapsedMs / phaseDurationMs) * 360,
    currentSet: Math.min(settings.totalSets ?? Number.POSITIVE_INFINITY, completedSets + 1),
    completedSets,
    goalReached: settings.totalSets !== null && completedSets >= settings.totalSets,
  };
}


// Capture this before freezing the running segment; later Finish clicks may be on another date.
export function getPomodoroCompletedAt(
  tracker: TrackerState,
  settings: ResolvedPomodoroSettings,
  nowMs: number,
): number | null {
  if (tracker.runningFromMs === null || settings.stopAfterMs === null
    || getElapsedMs(tracker, nowMs) < settings.stopAfterMs) return null;
  return tracker.runningFromMs + Math.max(0, settings.stopAfterMs - tracker.elapsedBeforeMs);
}
