import { addDays, minutesBetween, minutesFromTime } from './date';
import type { MonthEvent, MonthEventRepeat } from '../types/domain';

export const MONTH_EVENT_REPEAT_OPTIONS: Array<{
  value: MonthEventRepeat;
  label: string;
}> = [
  { value: 'none', label: '繰り返しなし' },
  { value: 'daily', label: '毎日' },
  { value: 'weekly', label: '毎週' },
  { value: 'monthly', label: '毎月' },
  { value: 'yearly', label: '毎年' },
];

function toDate(dateString: string): Date {
  return new Date(`${dateString}T00:00:00`);
}

function isSameOrAfterDate(targetDate: string, baseDate: string): boolean {
  return targetDate.localeCompare(baseDate) >= 0;
}

export function getMonthEventRepeatLabel(repeat: MonthEventRepeat): string {
  return (
    MONTH_EVENT_REPEAT_OPTIONS.find((option) => option.value === repeat)?.label ??
    '繰り返しなし'
  );
}

export function doesMonthEventOccurOnDate(
  event: MonthEvent,
  targetDate: string,
): boolean {
  if (!isSameOrAfterDate(targetDate, event.date)) {
    return false;
  }

  if (event.repeatUntil && targetDate.localeCompare(event.repeatUntil) > 0) {
    return false;
  }

  if (event.excludedDates.includes(targetDate)) {
    return false;
  }

  if (event.repeat === 'none') {
    return event.date === targetDate;
  }

  const eventDate = toDate(event.date);
  const date = toDate(targetDate);

  if (event.repeat === 'daily') {
    return true;
  }

  if (event.repeat === 'weekly') {
    return eventDate.getDay() === date.getDay();
  }

  if (event.repeat === 'monthly') {
    return eventDate.getDate() === date.getDate();
  }

  return (
    eventDate.getMonth() === date.getMonth() &&
    eventDate.getDate() === date.getDate()
  );
}

export function getPreviousMonthEventOccurrenceDate(
  event: MonthEvent,
  targetDate: string,
): string | null {
  if (targetDate.localeCompare(event.date) <= 0) {
    return null;
  }

  let candidateDate = addDays(targetDate, -1);

  while (candidateDate.localeCompare(event.date) >= 0) {
    if (doesMonthEventOccurOnDate(event, candidateDate)) {
      return candidateDate;
    }

    candidateDate = addDays(candidateDate, -1);
  }

  return null;
}

export function sortMonthEvents(events: MonthEvent[]): MonthEvent[] {
  return [...events].sort((left, right) => {
    if (left.date === right.date) {
      return minutesFromTime(left.startTime) - minutesFromTime(right.startTime);
    }

    return left.date.localeCompare(right.date);
  });
}

export function formatMonthEventTimeRange(event: Pick<MonthEvent, 'startTime' | 'endTime'>) {
  return `${event.startTime}-${event.endTime}`;
}

export function formatMonthEventDuration(event: Pick<MonthEvent, 'startTime' | 'endTime'>) {
  return minutesBetween(event.startTime, event.endTime);
}
