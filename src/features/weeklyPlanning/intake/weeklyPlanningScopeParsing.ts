import { addDays, startOfWeek } from '../../../lib/date';
import type { SetExamScopeCommand, SetPlanningRangeCommand } from './weeklyPlanningCommandTypes';
import type { ExamPrepScope, StudyScopeUnit, WeeklyPlanningIntakeContext } from './weeklyPlanningIntakeTypes';
import { normalizeIntakeText, parseSmallInteger, uniqueList } from './weeklyPlanningTextParsing';

function formatDateTime(date: string, time: string): string {
  return `${date}T${time}:00`;
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
  const startTime = `${String(startHour).padStart(2, '0')}:00`;

  return {
    startDateTime: formatDateTime(context.selectedDate, startTime),
    endDateTime: formatDateTime(sunday, '24:00'),
    sourceText: text,
    confidence: 'explicit',
  };
}

export function parseSetPlanningRangeCommand(
  text: string,
  context: WeeklyPlanningIntakeContext,
): SetPlanningRangeCommand | undefined {
  const range = parseWeekendPlanningRange(text, context);

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

function parseTotalYears(text: string): number | undefined {
  const match = normalizeIntakeText(text).match(/([0-9]+|[一二三四五六七八九十]+)\s*年分/);
  return match ? parseSmallInteger(match[1]) : undefined;
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
  return /院試|分野|年分|20\d{2}\s*[〜~-]\s*20\d{2}|第\s*\d+\s*部/.test(normalizedText);
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