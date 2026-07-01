import type { AddUnavailableCommand } from './weeklyPlanningCommandTypes';
import type { WeeklyPlanningIntakeContext } from './weeklyPlanningIntakeTypes';
import { formatHourTime } from './weeklyPlanningTimeParsing';
import { splitIntakeSegments } from './weeklyPlanningTextParsing';

export interface UnavailableDaypartRange {
  label: string;
  start: string;
  end: string;
}

export const WEEKLY_PLANNING_DAYPART_RANGES: UnavailableDaypartRange[] = [
  { label: '\u671d', start: '08:00', end: '10:00' },
  { label: '\u5348\u524d', start: '08:00', end: '12:00' },
  { label: '\u5348\u5f8c', start: '12:00', end: '18:00' },
  { label: '\u5915\u65b9', start: '16:00', end: '19:00' },
  { label: '\u591c', start: '19:00', end: '23:00' },
];

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDaysToDateString(date: string, days: number): string {
  const nextDate = new Date(`${date}T00:00:00.000Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return formatDate(nextDate);
}

export function getPlanningDates(context: WeeklyPlanningIntakeContext): string[] {
  const dayCount = Math.max(1, context.planningDayCount ?? 7);

  return Array.from({ length: dayCount }, (_, index) =>
    addDaysToDateString(context.selectedDate, index),
  );
}

function isDateInPlanningRange(date: string, context: WeeklyPlanningIntakeContext): boolean {
  return getPlanningDates(context).includes(date);
}

function resolveDateFromIsoText(segment: string, context: WeeklyPlanningIntakeContext): string | undefined {
  const match = segment.match(/(20\d{2})-(\d{2})-(\d{2})/);

  if (!match) {
    return undefined;
  }

  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return isDateInPlanningRange(date, context) ? date : undefined;
}

function resolveDateFromJapaneseText(segment: string, context: WeeklyPlanningIntakeContext): string | undefined {
  const match = segment.match(/(\d{1,2})\s*\u6708\s*(\d{1,2})\s*\u65e5/);

  if (!match) {
    return undefined;
  }

  const year = Number(context.selectedDate.slice(0, 4));
  const month = String(Number(match[1])).padStart(2, '0');
  const day = String(Number(match[2])).padStart(2, '0');
  const date = `${year}-${month}-${day}`;
  return isDateInPlanningRange(date, context) ? date : undefined;
}

function resolveDateFromWeekdayText(segment: string, context: WeeklyPlanningIntakeContext): string | undefined {
  const weekdayIndexByText: Array<[RegExp, number]> = [
    [/\u65e5\u66dc|\u65e5\u66dc\u65e5/, 0],
    [/\u6708\u66dc|\u6708\u66dc\u65e5/, 1],
    [/\u706b\u66dc|\u706b\u66dc\u65e5/, 2],
    [/\u6c34\u66dc|\u6c34\u66dc\u65e5/, 3],
    [/\u6728\u66dc|\u6728\u66dc\u65e5/, 4],
    [/\u91d1\u66dc|\u91d1\u66dc\u65e5/, 5],
    [/\u571f\u66dc|\u571f\u66dc\u65e5/, 6],
  ];

  for (const [pattern, targetWeekday] of weekdayIndexByText) {
    if (!pattern.test(segment)) {
      continue;
    }

    return getPlanningDates(context).find((date) => {
      const candidateDate = new Date(`${date}T00:00:00.000Z`);
      return candidateDate.getUTCDay() === targetWeekday;
    });
  }

  return undefined;
}

export function resolveUnavailableDate(segment: string, context: WeeklyPlanningIntakeContext): string | undefined {
  return (
    resolveDateFromIsoText(segment, context) ??
    resolveDateFromJapaneseText(segment, context) ??
    resolveDateFromWeekdayText(segment, context)
  );
}

export function isUncertainAvailabilityExpression(segment: string): boolean {
  return /\u304b\u3082|\u304b\u3082\u3057\u308c|\u305f\u3076\u3093|\u591a\u5206|\u3067\u304d\u308c\u3070|\u907f\u3051\u305f\u3044|\u5fae\u5999|\u5165\u308b\u304b\u3082|\u5165\u308a\u305d\u3046/.test(segment);
}

export function isHardUnavailableExpression(segment: string): boolean {
  return /\u4f7f\u308f\u306a\u3044|\u4f7f\u3048\u306a\u3044|\u7a7a\u3051\u3066|\u5165\u308c\u306a\u3044|\u9664\u5916|\u7121\u7406/.test(segment) &&
    !isUncertainAvailabilityExpression(segment);
}

export function resolveUnavailableDaypartRange(segment: string): UnavailableDaypartRange | undefined {
  return WEEKLY_PLANNING_DAYPART_RANGES.find((range) => segment.includes(range.label));
}

function createAddUnavailableCommand(params: {
  date?: string;
  start: string;
  end: string;
  sourceText: string;
  sourceSegment: string;
}): AddUnavailableCommand {
  return {
    type: 'add_unavailable',
    range: {
      date: params.date,
      start: params.start,
      end: params.end,
      hardness: 'hard',
    },
    sourceText: params.sourceText,
    sourceSegment: params.sourceSegment,
    confidence: 'high',
  };
}

function parseDaypartUnavailableCommand(segment: string, sourceText: string): AddUnavailableCommand | undefined {
  const daypart = resolveUnavailableDaypartRange(segment);
  return daypart
    ? createAddUnavailableCommand({
        start: daypart.start,
        end: daypart.end,
        sourceText,
        sourceSegment: segment,
      })
    : undefined;
}

function parseTimeRangeUnavailableCommand(segment: string, sourceText: string): AddUnavailableCommand | undefined {
  const rangeMatch = segment.match(/(\d{1,2})\s*\u6642\s*(?:\u304b\u3089|[\u301c\u301c~-])\s*(\d{1,2})\s*\u6642/);

  if (rangeMatch) {
    return createAddUnavailableCommand({
      start: formatHourTime(Number(rangeMatch[1])),
      end: formatHourTime(Number(rangeMatch[2])),
      sourceText,
      sourceSegment: segment,
    });
  }

  const afterMatch = segment.match(/(\d{1,2})\s*\u6642\s*\u4ee5\u964d/);
  return afterMatch
    ? createAddUnavailableCommand({
        start: formatHourTime(Number(afterMatch[1])),
        end: '24:00',
        sourceText,
        sourceSegment: segment,
      })
    : undefined;
}

function parseDateUnavailableCommand(
  segment: string,
  context: WeeklyPlanningIntakeContext,
  sourceText: string,
): AddUnavailableCommand | undefined {
  const date = resolveUnavailableDate(segment, context);
  return date
    ? createAddUnavailableCommand({
        date,
        start: '00:00',
        end: '24:00',
        sourceText,
        sourceSegment: segment,
      })
    : undefined;
}

export function parseAddUnavailableCommand(
  segment: string,
  context: WeeklyPlanningIntakeContext,
  sourceText = segment,
): AddUnavailableCommand | undefined {
  if (!isHardUnavailableExpression(segment)) {
    return undefined;
  }

  return (
    parseDateUnavailableCommand(segment, context, sourceText) ??
    parseTimeRangeUnavailableCommand(segment, sourceText) ??
    parseDaypartUnavailableCommand(segment, sourceText)
  );
}

export function parseAddUnavailableCommands(
  text: string,
  context: WeeklyPlanningIntakeContext,
): AddUnavailableCommand[] {
  return splitIntakeSegments(text)
    .map((segment) => parseAddUnavailableCommand(segment, context, text))
    .filter((command): command is AddUnavailableCommand => Boolean(command));
}