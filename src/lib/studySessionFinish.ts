import { getElapsedMs, type TrackerState } from './actualTracking';
import { getPomodoroCompletedAt, getPomodoroProgress, type ResolvedPomodoroSettings } from './pomodoroSession';
import { sessionCrossesLocalDate } from './studySessionTarget';

// Finishing projects a timer into a recordable measurement. Keep the stored
// range separate from wall-clock completion: pauses and delayed ticks can make
// them cross different local dates. UI state and persistence remain callers' work.
export function getStudySessionFinishMeasurement(
  tracker: TrackerState,
  finishedAt: number,
  pomodoro: ResolvedPomodoroSettings | null,
  completedAt: number | null,
) {
  if (tracker.anchorMs === null) return null;
  const anchorMs = tracker.anchorMs;
  const pomodoroCompletedAt = completedAt
    ?? (pomodoro ? getPomodoroCompletedAt(tracker, pomodoro, finishedAt) : null);
  const measuredMs = getElapsedMs(tracker, finishedAt);
  const elapsedMs = Math.max(pomodoro ? getPomodoroProgress(measuredMs, pomodoro).elapsedMs : measuredMs, 1000);
  const storedDurationMs = Math.max(elapsedMs, 60_000);
  return {
    anchorMs,
    elapsedMs,
    storedDurationMs,
    pomodoroCompletedAt,
    crossesLocalDate: sessionCrossesLocalDate(anchorMs, storedDurationMs)
      || sessionCrossesLocalDate(anchorMs, (pomodoroCompletedAt ?? finishedAt) - anchorMs),
  };
}
