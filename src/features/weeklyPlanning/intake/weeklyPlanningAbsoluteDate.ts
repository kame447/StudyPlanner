import { isIsoCalendarDate } from './weeklyPlanningDateValidation';
import { normalizeIntakeText } from './weeklyPlanningTextParsing';

const KANJI_CALENDAR_DIGITS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const CALENDAR_NUMBER_PATTERN = '[0-9]{1,2}|[一二三四五六七八九十]{1,3}';
const ABSOLUTE_MONTH_DAY_PATTERN_SOURCE =
  `(${CALENDAR_NUMBER_PATTERN})\\s*月\\s*(${CALENDAR_NUMBER_PATTERN})\\s*日`;

export interface AbsoluteMonthDayToken {
  rawText: string;
  month: number | undefined;
  day: number | undefined;
}

function parseKanjiCalendarNumber(token: string): number | undefined {
  if (/^\d{1,2}$/.test(token)) return Number(token);
  if (token === '十') return 10;

  const match = token.match(/^([一二三])?十([一二三四五六七八九])?$/);
  if (match) {
    const tens = match[1] ? KANJI_CALENDAR_DIGITS[match[1]] : 1;
    const ones = match[2] ? KANJI_CALENDAR_DIGITS[match[2]] : 0;
    return tens * 10 + ones;
  }

  return KANJI_CALENDAR_DIGITS[token];
}

function absoluteMonthDayPattern(flags?: string): RegExp {
  return new RegExp(ABSOLUTE_MONTH_DAY_PATTERN_SOURCE, flags);
}

export function findAbsoluteMonthDayToken(text: string): AbsoluteMonthDayToken | undefined {
  const match = normalizeIntakeText(text).match(absoluteMonthDayPattern());
  if (!match) return undefined;

  return {
    rawText: match[0],
    month: parseKanjiCalendarNumber(match[1]),
    day: parseKanjiCalendarNumber(match[2]),
  };
}

export function hasAbsoluteMonthDayToken(text: string): boolean {
  return Boolean(findAbsoluteMonthDayToken(text));
}

export function stripAbsoluteMonthDayTokens(text: string): string {
  return normalizeIntakeText(text).replace(absoluteMonthDayPattern('g'), '');
}

export function resolveAbsoluteMonthDayDate(
  text: string,
  selectedDate: string,
): string | undefined {
  const token = findAbsoluteMonthDayToken(text);
  if (!token || token.month === undefined || token.day === undefined) return undefined;
  if (token.month < 1 || token.month > 12 || token.day < 1 || token.day > 31) {
    return undefined;
  }
  if (!isIsoCalendarDate(selectedDate)) return undefined;

  const selectedYear = Number(selectedDate.slice(0, 4));
  const dateForYear = (year: number) =>
    `${year}-${String(token.month).padStart(2, '0')}-${String(token.day).padStart(2, '0')}`;
  const thisYear = dateForYear(selectedYear);
  const candidate = thisYear < selectedDate
    ? dateForYear(selectedYear + 1)
    : thisYear;

  return isIsoCalendarDate(candidate) ? candidate : undefined;
}

export function isPlanningRangeConsistentWithAbsoluteDateSource(params: {
  sourceText: string;
  selectedDate: string;
  startDateTime?: string;
}): boolean {
  if (!hasAbsoluteMonthDayToken(params.sourceText)) return true;

  const absoluteDate = resolveAbsoluteMonthDayDate(params.sourceText, params.selectedDate);
  return Boolean(
    absoluteDate
    && params.startDateTime
    && params.startDateTime.slice(0, 10) === absoluteDate,
  );
}
