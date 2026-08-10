export const CANONICAL_RELATIVE_DAY_EXPRESSIONS = [
  'today',
  'tomorrow',
  'next_day',
  'day_after_tomorrow',
] as const;

export type CanonicalRelativeDayExpression =
  (typeof CANONICAL_RELATIVE_DAY_EXPRESSIONS)[number];

export const CANONICAL_RELATIVE_WEEK_EXPRESSIONS = [
  'this_week',
  'next_week',
] as const;

export type CanonicalRelativeWeekExpression =
  (typeof CANONICAL_RELATIVE_WEEK_EXPRESSIONS)[number];

export const CANONICAL_WEEKDAY_DATE_EXPRESSIONS = [
  'weekday:sunday',
  'weekday:monday',
  'weekday:tuesday',
  'weekday:wednesday',
  'weekday:thursday',
  'weekday:friday',
  'weekday:saturday',
] as const;

export type CanonicalWeekdayDateExpression =
  (typeof CANONICAL_WEEKDAY_DATE_EXPRESSIONS)[number];

export const CANONICAL_RELATIVE_DATE_EXPRESSIONS = [
  ...CANONICAL_RELATIVE_DAY_EXPRESSIONS,
  ...CANONICAL_RELATIVE_WEEK_EXPRESSIONS,
] as const;

export type CanonicalRelativeDateExpression =
  (typeof CANONICAL_RELATIVE_DATE_EXPRESSIONS)[number];

export interface CalendarDateRange {
  start: string;
  end: string;
}

export type CalendarDateExpressionResolution =
  | {
      status: 'resolved';
      range: CalendarDateRange;
    }
  | {
      status: 'invalid_current_date' | 'invalid_absolute_date' | 'unsupported_expression';
      range: null;
    };

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CUSTOM_DATE_EXPRESSION_PATTERN = /^custom:.+$/;
const WEEKDAY_INDEX_BY_EXPRESSION: Record<CanonicalWeekdayDateExpression, number> = {
  'weekday:sunday': 0,
  'weekday:monday': 1,
  'weekday:tuesday': 2,
  'weekday:wednesday': 3,
  'weekday:thursday': 4,
  'weekday:friday': 5,
  'weekday:saturday': 6,
};
const WEEKDAY_ALIAS_INDEX: Record<string, number> = {
  'custom:日曜': 0,
  'custom:日曜日': 0,
  'custom:月曜': 1,
  'custom:月曜日': 1,
  'custom:火曜': 2,
  'custom:火曜日': 2,
  'custom:水曜': 3,
  'custom:水曜日': 3,
  'custom:木曜': 4,
  'custom:木曜日': 4,
  'custom:金曜': 5,
  'custom:金曜日': 5,
  'custom:土曜': 6,
  'custom:土曜日': 6,
};

function parseCalendarDate(value: string): Date | null {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function formatCalendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isValidCalendarDate(value: string): boolean {
  return parseCalendarDate(value) !== null;
}

export function canonicalWeekdayIndex(expression: string): number | null {
  if ((CANONICAL_WEEKDAY_DATE_EXPRESSIONS as readonly string[]).includes(expression)) {
    return WEEKDAY_INDEX_BY_EXPRESSION[expression as CanonicalWeekdayDateExpression];
  }
  return WEEKDAY_ALIAS_INDEX[expression] ?? null;
}

export function isCanonicalDateExpressionSyntax(value: string): boolean {
  return (
    isValidCalendarDate(value)
    || (CANONICAL_RELATIVE_DATE_EXPRESSIONS as readonly string[]).includes(value)
    || (CANONICAL_WEEKDAY_DATE_EXPRESSIONS as readonly string[]).includes(value)
    || CUSTOM_DATE_EXPRESSION_PATTERN.test(value)
  );
}

export function compareCalendarDates(left: string, right: string): number {
  return left.localeCompare(right);
}

export function addCalendarDays(value: string, amount: number): string | null {
  const date = parseCalendarDate(value);
  if (!date || !Number.isInteger(amount)) return null;
  date.setUTCDate(date.getUTCDate() + amount);
  return formatCalendarDate(date);
}

export function calendarWeekday(value: string): number | null {
  return parseCalendarDate(value)?.getUTCDay() ?? null;
}

export function mondayOfCalendarWeek(value: string): string | null {
  const weekday = calendarWeekday(value);
  if (weekday === null) return null;
  return addCalendarDays(value, weekday === 0 ? -6 : 1 - weekday);
}

export function listCalendarDatesInclusive(
  start: string,
  end: string,
): string[] | null {
  if (
    !isValidCalendarDate(start)
    || !isValidCalendarDate(end)
    || compareCalendarDates(start, end) > 0
  ) {
    return null;
  }

  const values: string[] = [];
  let current = start;
  while (compareCalendarDates(current, end) <= 0) {
    values.push(current);
    const next = addCalendarDays(current, 1);
    if (!next) return null;
    current = next;
  }
  return values;
}

export function intersectCalendarDates(
  dates: readonly string[],
  start: string,
  end: string,
): string[] | null {
  if (!isValidCalendarDate(start) || !isValidCalendarDate(end) || start > end) {
    return null;
  }
  if (dates.some((date) => !isValidCalendarDate(date))) return null;
  return dates.filter((date) => date >= start && date <= end);
}

export function resolveCanonicalDateExpression(params: {
  expression: string;
  currentDate: string;
}): CalendarDateExpressionResolution {
  if (!isValidCalendarDate(params.currentDate)) {
    return { status: 'invalid_current_date', range: null };
  }

  if (ISO_DATE_PATTERN.test(params.expression)) {
    return isValidCalendarDate(params.expression)
      ? {
          status: 'resolved',
          range: { start: params.expression, end: params.expression },
        }
      : { status: 'invalid_absolute_date', range: null };
  }

  if (params.expression === 'today') {
    return {
      status: 'resolved',
      range: { start: params.currentDate, end: params.currentDate },
    };
  }

  if (
    params.expression === 'tomorrow'
    || params.expression === 'next_day'
    || params.expression === 'day_after_tomorrow'
  ) {
    const offset = params.expression === 'day_after_tomorrow' ? 2 : 1;
    const date = addCalendarDays(params.currentDate, offset);
    return date
      ? { status: 'resolved', range: { start: date, end: date } }
      : { status: 'invalid_current_date', range: null };
  }

  if (params.expression === 'this_week' || params.expression === 'next_week') {
    const monday = mondayOfCalendarWeek(params.currentDate);
    if (!monday) return { status: 'invalid_current_date', range: null };
    const offset = params.expression === 'next_week' ? 7 : 0;
    const start = addCalendarDays(monday, offset);
    const end = addCalendarDays(monday, offset + 6);
    return start && end
      ? { status: 'resolved', range: { start, end } }
      : { status: 'invalid_current_date', range: null };
  }

  const weekdayIndex = canonicalWeekdayIndex(params.expression);
  if (weekdayIndex !== null) {
    const currentWeekday = calendarWeekday(params.currentDate);
    if (currentWeekday === null) return { status: 'invalid_current_date', range: null };
    const offset = (weekdayIndex - currentWeekday + 7) % 7;
    const date = addCalendarDays(params.currentDate, offset);
    return date
      ? { status: 'resolved', range: { start: date, end: date } }
      : { status: 'invalid_current_date', range: null };
  }

  return { status: 'unsupported_expression', range: null };
}
