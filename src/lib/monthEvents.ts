import {
  addDays,
  minutesFromTime,
  parseTimeToMinutes,
} from './date';
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

function calendarDayNumber(dateString: string): number {
  const [year, month, day] = dateString.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function getMonthEventEndDate(
  event: Pick<MonthEvent, 'date' | 'endDate'>,
): string {
  const candidate = event.endDate?.trim();

  return candidate && candidate.localeCompare(event.date) >= 0
    ? candidate
    : event.date;
}

function getMonthEventSpanDays(
  event: Pick<MonthEvent, 'date' | 'endDate'>,
): number {
  return Math.max(
    0,
    calendarDayNumber(getMonthEventEndDate(event)) - calendarDayNumber(event.date),
  );
}

function isMonthEventOccurrenceStartDate(
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

export function getMonthEventOccurrenceStartDate(
  event: MonthEvent,
  targetDate: string,
): string | null {
  if (!isSameOrAfterDate(targetDate, event.date)) {
    return null;
  }

  const spanDays = getMonthEventSpanDays(event);

  for (let offset = 0; offset <= spanDays; offset += 1) {
    const candidateDate = addDays(targetDate, -offset);

    if (candidateDate.localeCompare(event.date) < 0) {
      break;
    }

    if (
      isMonthEventOccurrenceStartDate(event, candidateDate) &&
      targetDate.localeCompare(addDays(candidateDate, spanDays)) <= 0
    ) {
      return candidateDate;
    }
  }

  return null;
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
  return getMonthEventOccurrenceStartDate(event, targetDate) !== null;
}

export function getPreviousMonthEventOccurrenceDate(
  event: MonthEvent,
  targetDate: string,
): string | null {
  const currentOccurrenceStart = getMonthEventOccurrenceStartDate(event, targetDate);
  let candidateDate = addDays(currentOccurrenceStart ?? targetDate, -1);

  while (candidateDate.localeCompare(event.date) >= 0) {
    if (isMonthEventOccurrenceStartDate(event, candidateDate)) {
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

export function formatMonthEventTimeRange(
  event: Pick<MonthEvent, 'startTime' | 'endTime'>,
) {
  return `${event.startTime}-${event.endTime}`;
}

export function formatMonthEventTimeRangeForDate(
  event: MonthEvent,
  targetDate: string,
): string {
  const occurrenceStart = getMonthEventOccurrenceStartDate(event, targetDate);

  if (!occurrenceStart) {
    return formatMonthEventTimeRange(event);
  }

  const spanDays = getMonthEventSpanDays(event);

  if (spanDays === 0) {
    return formatMonthEventTimeRange(event);
  }

  const isAllDay =
    event.startTime === '00:00' &&
    (event.endTime === '24:00' ||
      event.endTime === '00:00' ||
      event.endTime === '23:59');

  if (isAllDay) {
    return '終日';
  }

  const occurrenceEnd = addDays(occurrenceStart, spanDays);

  if (targetDate === occurrenceStart) {
    return `${event.startTime}〜`;
  }

  if (targetDate === occurrenceEnd) {
    return `〜${event.endTime}`;
  }

  return '終日';
}

export function formatMonthEventDuration(
  event: Pick<MonthEvent, 'date' | 'endDate' | 'startTime' | 'endTime'>,
) {
  return (
    getMonthEventSpanDays(event) * 24 * 60 +
    parseTimeToMinutes(event.endTime, 'end') -
    parseTimeToMinutes(event.startTime, 'start')
  );
}
