export interface TrackerState {
  anchorMs: number | null;
  runningFromMs: number | null;
  elapsedBeforeMs: number;
}

export function createInitialTracker(): TrackerState {
  return { anchorMs: null, runningFromMs: null, elapsedBeforeMs: 0 };
}

export function startTracker(tracker: TrackerState, nowMs: number): TrackerState {
  if (tracker.anchorMs !== null) return tracker;
  return { anchorMs: nowMs, runningFromMs: nowMs, elapsedBeforeMs: 0 };
}

export function pauseTracker(tracker: TrackerState, nowMs: number): TrackerState {
  if (tracker.runningFromMs === null) return tracker;
  return { ...tracker, runningFromMs: null, elapsedBeforeMs: getElapsedMs(tracker, nowMs) };
}

export function resumeTracker(tracker: TrackerState, nowMs: number): TrackerState {
  if (tracker.anchorMs === null || tracker.runningFromMs !== null) return tracker;
  return { ...tracker, runningFromMs: nowMs };
}

function formatClockTime(date: Date): string {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function formatDurationDisplay(totalMs: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const hours = Math.floor(safeSeconds / 3600)
    .toString()
    .padStart(2, '0');
  const minutes = Math.floor((safeSeconds % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (safeSeconds % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

export function getElapsedMs(tracker: TrackerState, nowMs: number): number {
  return (
    tracker.elapsedBeforeMs +
    (tracker.runningFromMs !== null ? Math.max(0, nowMs - tracker.runningFromMs) : 0)
  );
}

export function clampTimerMinutes(value: number): number {
  if (Number.isNaN(value)) {
    return 30;
  }

  return Math.min(Math.max(Math.round(value), 1), 1439);
}

export function formatTimerInputValue(totalMinutes: number): string {
  const clampedMinutes = clampTimerMinutes(totalMinutes);
  const hours = Math.floor(clampedMinutes / 60)
    .toString()
    .padStart(2, '0');
  const minutes = (clampedMinutes % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function parseTimerInputValue(
  value: string,
  fallbackMinutes: number,
): number {
  const [hoursText, minutesText] = value.split(':');
  const hours = Number(hoursText);
  const minutes = Number(minutesText);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return clampTimerMinutes(fallbackMinutes);
  }

  return clampTimerMinutes(hours * 60 + minutes);
}

export function buildMeasuredRange(anchorMs: number, durationMs: number) {
  const startAt = new Date(anchorMs);
  const endAt = new Date(anchorMs + durationMs);

  return {
    startTime: formatClockTime(startAt),
    endTime: formatClockTime(endAt),
  };
}
