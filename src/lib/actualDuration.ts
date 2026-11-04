import { elapsedEntryMinutes, getEntryDurationMinutes } from './entryTimeRange';
import type { Actual, DurationActual, TimedActual } from '../types/domain';

export const MAX_DURATION_ACTUAL_MINUTES = 1439;

/** An actual that states only a length on a date. It has no clock times and is never placed on a timeline. */
export function isDurationActual(actual: Actual): actual is DurationActual {
  return actual.actualDurationMinutes !== undefined;
}

export function isTimedActual(actual: Actual): actual is TimedActual {
  return !isDurationActual(actual);
}

export function isValidActualDurationMinutes(minutes: unknown): minutes is number {
  return typeof minutes === 'number' && Number.isInteger(minutes) && minutes > 0 && minutes <= MAX_DURATION_ACTUAL_MINUTES;
}

/**
 * The one place an actual's length is read. A time-only actual reports its stored minutes; a timed actual keeps the
 * existing clock arithmetic. An invalid or missing value is 0 (excluded from totals), never a guessed length.
 */
export function getActualDurationMinutes(actual: Actual): number {
  if (isDurationActual(actual)) return isValidActualDurationMinutes(actual.actualDurationMinutes) ? actual.actualDurationMinutes : 0;
  return getEntryDurationMinutes(actual.actualStartTime, actual.actualEndTime);
}

/** Minutes of an actual that count as already done at `nowTime` on `today`. A duration actual has no clock: it counts in full
 *  once its date has arrived and not before. */
export function elapsedActualMinutes(actual: Actual, today: string, nowTime: string): number {
  if (isDurationActual(actual)) return actual.occurrenceDate <= today ? getActualDurationMinutes(actual) : 0;
  return elapsedEntryMinutes(actual.occurrenceDate, actual.actualStartTime, actual.actualEndTime, today, nowTime);
}
