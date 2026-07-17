export function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function isValidPlanningDurationDays(value: unknown): value is number {
  return Number.isSafeInteger(value)
    && Number(value) >= 1;
}

export function hasCompleteDateWindow(value: {
  windowStartDate?: string;
  windowEndDate?: string;
}): boolean {
  return Boolean(value.windowStartDate) === Boolean(value.windowEndDate);
}

export function isValidDateWindow(value: {
  windowStartDate?: string;
  windowEndDate?: string;
}): boolean {
  if (!hasCompleteDateWindow(value)) {
    return false;
  }
  if (!value.windowStartDate || !value.windowEndDate) {
    return true;
  }
  return isIsoCalendarDate(value.windowStartDate)
    && isIsoCalendarDate(value.windowEndDate)
    && value.windowStartDate <= value.windowEndDate;
}

export function isDateWithinWindow(
  date: string,
  window: { windowStartDate?: string; windowEndDate?: string },
): boolean {
  if (!window.windowStartDate || !window.windowEndDate) {
    return true;
  }
  return date >= window.windowStartDate && date <= window.windowEndDate;
}

function parsePlanningDateTime(value: string): number | undefined {
  if (isIsoCalendarDate(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  }

  const match = value.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})$/,
  );
  if (!match || !isIsoCalendarDate(match[1])) {
    return undefined;
  }

  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  if (minute > 59 || second > 59 || hour > 24) {
    return undefined;
  }
  if (hour === 24 && (minute !== 0 || second !== 0)) {
    return undefined;
  }

  const [year, month, day] = match[1].split('-').map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

export function isValidPlanningDateTime(value: unknown): value is string {
  return typeof value === 'string' && parsePlanningDateTime(value) !== undefined;
}

export function isOrderedPlanningDateTimeRange(value: {
  startDateTime?: string;
  endDateTime?: string;
}): boolean {
  if (!value.startDateTime || !value.endDateTime) {
    return false;
  }
  const start = parsePlanningDateTime(value.startDateTime);
  const end = parsePlanningDateTime(value.endDateTime);
  return start !== undefined && end !== undefined && start < end;
}
