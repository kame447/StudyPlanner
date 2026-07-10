import { addDays, startOfWeek } from '../../../lib/date';
import type { SetExamScopeCommand, SetPendingPlanningRangeCommand, SetPlanningRangeCommand } from './weeklyPlanningCommandTypes';
import type { ExamPrepScope, PendingPlanningRangeClarification, StudyScopeUnit, WeeklyPlanningIntakeContext } from './weeklyPlanningIntakeTypes';
import {
  normalizeIntakeText,
  parseSmallInteger,
  splitIntakeSegments,
  uniqueList,
} from './weeklyPlanningTextParsing';

const WEEKDAY_INDEX: Record<string, number> = {
  月: 0,
  火: 1,
  水: 2,
  木: 3,
  金: 4,
  土: 5,
  日: 6,
};

function formatDateTime(date: string, time: string): string {
  return date + 'T' + time + ':00';
}

function parseWeekendPlanningRange(
  text: string,
  context: WeeklyPlanningIntakeContext,
): SetPlanningRangeCommand['range'] | undefined {
  const normalizedText = normalizeIntakeText(text);
  const startMatch = normalizedText.match(/今日(?:の)?\s*(\d{1,2})\s*時/);

  if (!startMatch || !/土日.*(?:終わり|最後)|日曜.*(?:終わり|最後)/.test(normalizedText)) {
    return undefined;
  }

  const weekStart = startOfWeek(context.selectedDate);
  const sunday = addDays(weekStart, 6);
  const startHour = Number(startMatch[1]);
  const startTime = String(startHour).padStart(2, '0') + ':00';

  return {
    startDateTime: formatDateTime(context.selectedDate, startTime),
    endDateTime: formatDateTime(sunday, '24:00'),
    sourceText: text,
    confidence: 'explicit',
  };
}

function currentDateTime(context: WeeklyPlanningIntakeContext): string {
  return context.currentDateTime ?? formatDateTime(context.selectedDate, '00:00');
}

function currentTime(context: WeeklyPlanningIntakeContext): string {
  return currentDateTime(context).slice(11, 16) || '00:00';
}

function endDateTimeForDuration(startDate: string, durationDays: number): string {
  return formatDateTime(addDays(startDate, durationDays - 1), '24:00');
}

function rangeFromStartDate(params: {
  startDate: string;
  startTime?: string;
  durationDays: number;
  sourceText: string;
  confidence?: 'explicit' | 'inferred';
}): SetPlanningRangeCommand['range'] {
  return {
    startDateTime: formatDateTime(params.startDate, params.startTime ?? '00:00'),
    endDateTime: endDateTimeForDuration(params.startDate, params.durationDays),
    sourceText: params.sourceText,
    calendarDayCount: params.durationDays,
    confidence: params.confidence ?? 'explicit',
  };
}

function hasOneWeekDuration(text: string): boolean {
  return /(?:一|1)\s*週間|7\s*日間?/.test(normalizeIntakeText(text));
}

function parseExplicitDate(text: string, context: WeeklyPlanningIntakeContext): string | undefined {
  const match = normalizeIntakeText(text).match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*から)?/);
  if (!match) return undefined;

  const selectedYear = Number(context.selectedDate.slice(0, 4));
  const month = Number(match[1]);
  const day = Number(match[2]);
  const thisYear = selectedYear + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  return thisYear < context.selectedDate
    ? String(selectedYear + 1) + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0')
    : thisYear;
}

function nextWeekScope(context: WeeklyPlanningIntakeContext): PendingPlanningRangeClarification['scope'] {
  const nextWeekStart = addDays(startOfWeek(context.selectedDate), 7);
  return {
    kind: 'next_week',
    label: '来週',
    startDate: nextWeekStart,
    endDate: addDays(nextWeekStart, 6),
  };
}

function parseWeekdayStart(text: string): number | undefined {
  const match = normalizeIntakeText(text).match(/([月火水木金土日])(?:曜(?:日)?)?\s*から/);
  return match ? WEEKDAY_INDEX[match[1]] : undefined;
}

function resolveWeekdayInScope(
  weekdayIndex: number,
  scope: PendingPlanningRangeClarification['scope'],
): string | undefined {
  if (!scope.startDate || !scope.endDate) return undefined;

  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(scope.startDate, offset);
    if (date > scope.endDate) return undefined;
    if (offset === weekdayIndex) return date;
  }

  return undefined;
}

function parsePendingPlanningRange(
  text: string,
  context: WeeklyPlanningIntakeContext,
): SetPendingPlanningRangeCommand | undefined {
  const normalizedText = normalizeIntakeText(text);
  if (!hasOneWeekDuration(normalizedText) && !/来週.*計画/.test(normalizedText)) {
    return undefined;
  }

  if (/夏休み/.test(normalizedText)) {
    return {
      type: 'set_pending_planning_range',
      pending: {
        scope: { kind: 'named_future_period', label: '夏休み' },
        durationDays: 7,
        sourceText: text,
      },
      sourceText: text,
      confidence: 'high',
    };
  }

  if (/来週/.test(normalizedText)) {
    const scope = nextWeekScope(context);
    const weekdayIndex = parseWeekdayStart(normalizedText);
    const startDate = weekdayIndex === undefined ? undefined : resolveWeekdayInScope(weekdayIndex, scope);

    if (startDate) {
      return undefined;
    }

    return {
      type: 'set_pending_planning_range',
      pending: {
        scope,
        durationDays: 7,
        sourceText: text,
      },
      sourceText: text,
      confidence: 'high',
    };
  }

  return undefined;
}

function parseWeeklyPlanningRange(
  text: string,
  context: WeeklyPlanningIntakeContext,
  pending?: PendingPlanningRangeClarification,
): SetPlanningRangeCommand['range'] | undefined {
  const normalizedText = normalizeIntakeText(text);
  const durationDays = hasOneWeekDuration(normalizedText) || pending ? 7 : undefined;
  if (!durationDays) return undefined;

  if (pending) {
    const weekdayIndex = parseWeekdayStart(normalizedText);
    const startDate = weekdayIndex === undefined
      ? parseExplicitDate(normalizedText, context)
      : resolveWeekdayInScope(weekdayIndex, pending.scope);
    return startDate
      ? rangeFromStartDate({ startDate, durationDays: pending.durationDays, sourceText: text })
      : undefined;
  }

  const explicitDate = parseExplicitDate(normalizedText, context);
  if (explicitDate) {
    return rangeFromStartDate({ startDate: explicitDate, durationDays, sourceText: text });
  }

  if (/来週/.test(normalizedText)) {
    const scope = nextWeekScope(context);
    const weekdayIndex = parseWeekdayStart(normalizedText);
    const startDate = weekdayIndex === undefined ? undefined : resolveWeekdayInScope(weekdayIndex, scope);
    return startDate
      ? rangeFromStartDate({ startDate, durationDays, sourceText: text })
      : undefined;
  }

  if (/今日\s*から/.test(normalizedText)) {
    return rangeFromStartDate({ startDate: context.selectedDate, durationDays, sourceText: text });
  }

  if (!/夏休み/.test(normalizedText)) {
    return rangeFromStartDate({
      startDate: currentDateTime(context).slice(0, 10),
      startTime: currentTime(context),
      durationDays,
      sourceText: text,
      confidence: 'inferred',
    });
  }

  return undefined;
}

export function parseSetPendingPlanningRangeCommand(
  text: string,
  context: WeeklyPlanningIntakeContext,
): SetPendingPlanningRangeCommand | undefined {
  const range = parseWeeklyPlanningRange(text, context);
  return range ? undefined : parsePendingPlanningRange(text, context);
}

export function parseSetPlanningRangeCommand(
  text: string,
  context: WeeklyPlanningIntakeContext,
  pending?: PendingPlanningRangeClarification,
): SetPlanningRangeCommand | undefined {
  const range = parseWeekendPlanningRange(text, context) ?? parseWeeklyPlanningRange(text, context, pending);

  return range
    ? {
        type: 'set_planning_range',
        range,
        sourceText: text,
        confidence: 'high',
      }
    : undefined;
}

function extractExamFields(text: string): string[] {
  return normalizeIntakeText(text)
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .map((line) => line.match(/第\s*\d+\s*部\s+(.+)$/)?.[1]?.trim())
    .filter((field): field is string => Boolean(field));
}

function isYearFieldUnitRateSegment(segment: string): boolean {
  return /(?:1|一)?\s*年分(?:は|が|で|に|あたり)?\s*([0-9]+|[一二三四五六七八九十]+)\s*(?:時間|分)/.test(segment)
    || /(?:1|一)\s*分野(?:の)?\s*(?:1|一)\s*年分.*?([0-9]+|[一二三四五六七八九十]+)\s*(?:時間|分)/.test(segment);
}

function parseTotalYears(text: string): number | undefined {
  for (const segment of splitIntakeSegments(text)) {
    if (isYearFieldUnitRateSegment(segment)) {
      continue;
    }

    const match = segment.match(/([0-9]+|[一二三四五六七八九十]+)\s*年分/);
    const totalYears = match ? parseSmallInteger(match[1]) : undefined;

    if (totalYears) {
      return totalYears;
    }
  }

  return undefined;
}

function parseTotalFields(text: string): number | undefined {
  const match = normalizeIntakeText(text).match(/([0-9]+|[一二三四五六七八九十]+)\s*分野/);
  return match ? parseSmallInteger(match[1]) : undefined;
}

function parseYearRange(text: string): ExamPrepScope['yearRange'] | undefined {
  const match = normalizeIntakeText(text).match(/(20\d{2})\s*[〜~-]\s*(20\d{2})/);

  if (!match) {
    return undefined;
  }

  return {
    startYear: Number(match[1]),
    endYear: Number(match[2]),
    sourceText: match[0],
  };
}

function resolveUnitModel(params: {
  examType: string | undefined;
  fields: string[];
  totalYears: number | undefined;
  previousUnitModel: StudyScopeUnit | undefined;
}): StudyScopeUnit | undefined {
  return params.examType || params.fields.length > 0 || params.totalYears
    ? 'year_field_chunk'
    : params.previousUnitModel;
}

function mergeExamPrepScope(
  previousScope: ExamPrepScope | undefined,
  text: string,
): ExamPrepScope | undefined {
  const normalizedText = normalizeIntakeText(text);
  const fields = uniqueList([...(previousScope?.fields ?? []), ...extractExamFields(text)]);
  const totalFields = parseTotalFields(text) ?? previousScope?.totalFields;
  const totalYears = parseTotalYears(text) ?? previousScope?.totalYears;
  const yearRange = parseYearRange(text) ?? previousScope?.yearRange;
  const examType = /院試/.test(normalizedText) ? '院試' : previousScope?.examType;
  const strategyHint = /分野ごと/.test(normalizedText) ? 'field_first' : previousScope?.strategyHint;
  const unitModel = resolveUnitModel({
    examType,
    fields,
    totalYears,
    previousUnitModel: previousScope?.unitModel,
  });

  if (!examType && fields.length === 0 && !totalFields && !totalYears && !previousScope) {
    return undefined;
  }

  return {
    examType,
    fields,
    totalFields,
    totalYears,
    yearRange,
    strategyHint,
    unitModel,
    unitCountHint: totalFields && totalYears ? totalFields * totalYears : previousScope?.unitCountHint,
    rawText: [...(previousScope?.rawText ?? []), text],
  };
}

function hasExamScopeSignal(text: string): boolean {
  const normalizedText = normalizeIntakeText(text);
  return /院試|分野|20\d{2}\s*[〜~-]\s*20\d{2}|第\s*\d+\s*部/.test(normalizedText)
    || Boolean(parseTotalYears(normalizedText));
}

export function parseSetExamScopeCommand(
  text: string,
  previousScope: ExamPrepScope | undefined,
): SetExamScopeCommand | undefined {
  if (!hasExamScopeSignal(text)) {
    return undefined;
  }

  const scope = mergeExamPrepScope(previousScope, text);

  return scope
    ? {
        type: 'set_exam_scope',
        scope,
        sourceText: text,
        confidence: 'high',
      }
    : undefined;
}
