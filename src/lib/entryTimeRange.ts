import { addDays, formatMinutesToTime, minutesBetween, minutesFromTime } from './date';

const MINUTES_PER_DAY = 24 * 60;
const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** Plan/Actual clocks describe at most one overnight interval on their start date.
 * Midnight in the end role retains the existing end-of-day meaning. Other equal
 * clocks have zero duration; malformed clocks must never become overnight data.
 */
export function getEntryDurationMinutes(startTime: string, endTime: string): number {
  if (!CLOCK.test(startTime) || !(CLOCK.test(endTime) || endTime === '24:00')) return 0;
  const start = minutesFromTime(startTime);
  const end = endTime === '00:00' ? MINUTES_PER_DAY : minutesFromTime(endTime);
  const difference = end - start;
  return difference < 0 ? difference + MINUTES_PER_DAY : difference;
}

/** Class-related schedules retain their existing same-day entry contract. */
export function isValidPlanEntryTimeRange(plan: { startTime: string; endTime: string; classTemplateId?: string }): boolean {
  return getEntryDurationMinutes(plan.startTime, plan.endTime) > 0
    && (!plan.classTemplateId || minutesBetween(plan.startTime, plan.endTime) > 0);
}

export function resolveEntryEndTime(startTime: string, durationMinutes: number): string | null {
  if (!CLOCK.test(startTime) || !Number.isInteger(durationMinutes)
    || durationMinutes <= 0 || durationMinutes >= MINUTES_PER_DAY) return null;
  const end = minutesFromTime(startTime) + durationMinutes;
  return formatMinutesToTime(end <= MINUTES_PER_DAY ? end : end - MINUTES_PER_DAY, 'end');
}

/** Presentation only: never persist the clipped clock values or count both days. */
export function entryTimeRangeForDate(
  startDate: string,
  startTime: string,
  endTime: string,
  date: string,
): { startTime: string; endTime: string } | null {
  const duration = getEntryDurationMinutes(startTime, endTime);
  if (duration <= 0) return null;
  const end = minutesFromTime(startTime) + duration;
  if (date === startDate) {
    return { startTime, endTime: formatMinutesToTime(Math.min(end, MINUTES_PER_DAY), 'end') };
  }
  if (end > MINUTES_PER_DAY && date === addDays(startDate, 1)) {
    return { startTime: '00:00', endTime: formatMinutesToTime(end - MINUTES_PER_DAY, 'end') };
  }
  return null;
}

export function elapsedEntryMinutes(
  startDate: string,
  startTime: string,
  endTime: string,
  today: string,
  nowTime: string,
): number {
  const duration = getEntryDurationMinutes(startTime, endTime);
  if (duration <= 0 || startDate > today || !CLOCK.test(nowTime)) return 0;
  if (addDays(startDate, 1) < today) return duration;
  const elapsed = minutesFromTime(nowTime) - minutesFromTime(startTime)
    + (startDate < today ? MINUTES_PER_DAY : 0);
  return Math.max(0, Math.min(duration, elapsed));
}
