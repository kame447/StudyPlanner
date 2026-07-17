import { addDays, startOfWeek } from '../../../lib/date';
import type { BeginWeeklyPlanningCommand, NormalizedSetPendingPlanningRangeCommand, SetExamScopeCommand, SetPlanningRangeCommand } from './weeklyPlanningCommandTypes';
import {
  isDateWithinWindow,
  isIsoCalendarDate,
  isValidPlanningDurationDays,
} from './weeklyPlanningDateValidation';
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

function endDateTimeForDuration(startDate: string, durationDays: number): string | undefined {
  if (!isIsoCalendarDate(startDate) || !isValidPlanningDurationDays(durationDays)) {
    return undefined;
  }
  const endDate = addDays(startDate, durationDays - 1);
  return isIsoCalendarDate(endDate)
    ? formatDateTime(endDate, '24:00')
    : undefined;
}

function rangeFromStartDate(params: {
  startDate: string;
  startTime?: string;
  durationDays: number;
  sourceText: string;
  confidence?: 'explicit' | 'inferred';
}): SetPlanningRangeCommand['range'] | undefined {
  const endDateTime = endDateTimeForDuration(params.startDate, params.durationDays);
  if (!endDateTime) return undefined;
  return {
    startDateTime: formatDateTime(params.startDate, params.startTime ?? '00:00'),
    endDateTime,
    sourceText: params.sourceText,
    calendarDayCount: params.durationDays,
    confidence: params.confidence ?? 'explicit',
  };
}

function stripQuotedSegments(text: string): string {
  return text
    .replace(/「[^」]*」/g, '')
    .replace(/『[^』]*』/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/'[^']*'/g, '');
}

function hasReportedOrExampleContext(text: string): boolean {
  const thirdPartySubject = /(?:先生|友達|母|父|弟|妹|兄|姉|彼|彼女|第三者|本人|[^、。\s]+(?:さん|くん|ちゃん))/;
  return new RegExp(`${thirdPartySubject.source}.*(?:言って|話して|希望して|したいそう|とのこと)`).test(text)
    || /(?:例文|引用|という(?:文|表現)|と書いて|文法|学習内容|教材|問題文)/.test(text);
}

function blocksCommonPendingPartialAnswer(text: string): boolean {
  return hasReportedOrExampleContext(text)
    || /[「」『』"]/.test(text);
}

function blocksStartDateAnswer(text: string): boolean {
  return blocksCommonPendingPartialAnswer(text)
    || /(?:提出日|締切|期限|固定予定)/.test(text);
}

function blocksDurationAnswer(text: string): boolean {
  return blocksCommonPendingPartialAnswer(text)
    || /(?:終わらせ|かかる|必要|所要時間)/.test(text);
}

function isBareStartDateAnswer(text: string): boolean {
  return /^\s*\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s*から)?(?:\s*です)?\s*$/.test(
    normalizeIntakeText(text),
  );
}

function isBareDurationAnswer(text: string): boolean {
  return /^\s*(?:(?:一|1)\s*週間|7\s*日間?)(?:\s*です)?\s*$/.test(
    normalizeIntakeText(text),
  );
}

function isCombinedStartAndDurationAnswer(text: string): boolean {
  return /^\s*\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s*から)?\s*(?:(?:一|1)\s*週間|7\s*日間?)(?:\s*です)?\s*$/.test(
    normalizeIntakeText(text),
  );
}

function isBareWeekdayStartAnswer(text: string): boolean {
  return /^\s*[月火水木金土日](?:曜(?:日)?)?\s*から(?:\s*です)?\s*$/.test(
    normalizeIntakeText(text),
  );
}

function acceptsStartDateAnswer(text: string, expectedSlot?: string): boolean {
  if (blocksStartDateAnswer(text)) return false;
  return isBareStartDateAnswer(text)
    || isCombinedStartAndDurationAnswer(text)
    || isBareWeekdayStartAnswer(text)
    || (
      expectedSlot === 'planning_start_date'
      && /(?:計画|予定).*(?:開始|始め).*\d{1,2}\s*月\s*\d{1,2}\s*日/.test(
        normalizeIntakeText(text),
      )
    );
}

function acceptsDurationAnswer(text: string, expectedSlot?: string): boolean {
  if (blocksDurationAnswer(text)) return false;
  return isBareDurationAnswer(text)
    || isCombinedStartAndDurationAnswer(text)
    || (
      expectedSlot === 'planning_duration'
      && /(?:計画|予定).*(?:(?:一|1)\s*週間|7\s*日間?)/.test(
        normalizeIntakeText(text),
      )
    );
}

function hasOneWeekDuration(text: string): boolean {
  return /(?:一|1)\s*週間|7\s*日間?/.test(normalizeIntakeText(text));
}

function hasPlanningRequestSignal(text: string): boolean {
  const normalizedText = normalizeIntakeText(text);
  return /(?:予定|計画|スケジュール)/.test(normalizedText)
    && /(?:立て|作|組|決め|したい|お願い)/.test(normalizedText);
}

function isSummerVacationNegated(text: string): boolean {
  return /夏休み\s*(?:ではなく|じゃなく|でなく|ではない|じゃない)/.test(
    normalizeIntakeText(text),
  );
}

function hasNextWeekPlanningRangeIntent(text: string): boolean {
  const normalizedText = normalizeIntakeText(text);
  if (hasReportedOrExampleContext(normalizedText)) {
    return false;
  }
  const directText = stripQuotedSegments(normalizedText);
  return /来週.*(?:計画|予定|スケジュール)/.test(directText)
    || (isSummerVacationNegated(directText)
      && /来週(?:\s*(?:に|へ))?\s*(?:したい|する|します|でお願いします)/.test(
        directText,
      ));
}

function hasSummerVacationPlanningRangeIntent(text: string): boolean {
  const normalizedText = normalizeIntakeText(text);
  return !isSummerVacationNegated(normalizedText)
    && hasPlanningRequestSignal(normalizedText)
    && /夏休み(?:の(?:(?:一|1)\s*週間|予定|計画|スケジュール)|中|期間|に|で|から)/.test(
      normalizedText,
    );
}

function isBareSummerVacationRangeAnswer(text: string): boolean {
  return /^夏休み(?:の(?:一|1)\s*週間)?(?:です|でお願いします)?$/.test(
    normalizeIntakeText(text).trim(),
  );
}

function parseExplicitDate(
  text: string,
  context: WeeklyPlanningIntakeContext,
): string | undefined {
  const match = normalizeIntakeText(text).match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*から)?/);
  if (!match) return undefined;

  const selectedYear = Number(context.selectedDate.slice(0, 4));
  const month = Number(match[1]);
  const day = Number(match[2]);
  const dateForYear = (year: number) =>
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const thisYear = dateForYear(selectedYear);
  const candidate = thisYear < context.selectedDate
    ? dateForYear(selectedYear + 1)
    : thisYear;
  return isIsoCalendarDate(candidate) ? candidate : undefined;
}

export function nextWeekScope(
  context: WeeklyPlanningIntakeContext,
): Extract<PendingPlanningRangeClarification['scope'], { kind: 'next_week' }> {
  const nextWeekStart = addDays(startOfWeek(context.selectedDate), 7);
  return {
    kind: 'next_week',
    label: '来週',
    windowStartDate: nextWeekStart,
    windowEndDate: addDays(nextWeekStart, 6),
  };
}

function parseWeekdayStart(text: string): number | undefined {
  const normalizedText = normalizeIntakeText(text);
  const withoutExplicitMonthDays = normalizedText.replace(
    /\d{1,2}\s*月\s*\d{1,2}\s*日/g,
    '',
  );
  const match = withoutExplicitMonthDays.match(/([月火水木金土日])(?:曜(?:日)?)?\s*から/);
  return match ? WEEKDAY_INDEX[match[1]] : undefined;
}

function resolveWeekdayInScope(
  weekdayIndex: number,
  scope: PendingPlanningRangeClarification['scope'],
): string | undefined {
  if (!scope.windowStartDate || !scope.windowEndDate) return undefined;

  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(scope.windowStartDate, offset);
    if (date > scope.windowEndDate) return undefined;
    if (offset === weekdayIndex) return date;
  }

  return undefined;
}

function parsePendingPlanningRange(
  text: string,
  context: WeeklyPlanningIntakeContext,
  options?: {
    allowBareNamedFuturePeriodAnswer?: boolean;
    pending?: PendingPlanningRangeClarification;
    expectedSlot?: string;
  },
): NormalizedSetPendingPlanningRangeCommand | undefined {
  const normalizedText = normalizeIntakeText(text);
  const currentPending = options?.pending;

  if (currentPending) {
    const explicitDate = acceptsStartDateAnswer(text, options?.expectedSlot)
      ? parseExplicitDate(normalizedText, context)
      : undefined;
    if (explicitDate) {
      const explicitDateAllowed = isDateWithinWindow(explicitDate, currentPending.scope);

      if (!explicitDateAllowed) {
        return undefined;
      }

      if (currentPending.planningStartDate === undefined) {
        return {
          type: 'set_pending_planning_range',
          pending: {
            ...currentPending,
            planningStartDate: explicitDate,
            sourceText: text,
          },
          sourceText: text,
          confidence: 'high',
        };
      }
    }

    if (
      acceptsDurationAnswer(text, options?.expectedSlot)
      && hasOneWeekDuration(normalizedText)
      && currentPending.durationDays === undefined
    ) {
      return {
        type: 'set_pending_planning_range',
        pending: {
          ...currentPending,
          durationDays: 7,
          sourceText: text,
        },
        sourceText: text,
        confidence: 'high',
      };
    }
  }

  const acceptsSummerVacation = hasSummerVacationPlanningRangeIntent(normalizedText)
    || (options?.allowBareNamedFuturePeriodAnswer === true
      && currentPending === undefined
      && isBareSummerVacationRangeAnswer(normalizedText));

  if (acceptsSummerVacation) {
    const durationDays = hasOneWeekDuration(normalizedText) ? 7 : undefined;
    return {
      type: 'set_pending_planning_range',
      pending: {
        scope: { kind: 'named_future_period', label: '夏休み' },
        ...(durationDays ? { durationDays } : {}),
        sourceText: text,
      },
      sourceText: text,
      confidence: 'high',
    };
  }

  if (!hasOneWeekDuration(normalizedText) && !hasNextWeekPlanningRangeIntent(normalizedText)) {
    return undefined;
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
  expectedSlot?: string,
): SetPlanningRangeCommand['range'] | undefined {
  const normalizedText = normalizeIntakeText(text);

  if (pending) {
    const durationDays = acceptsDurationAnswer(text, expectedSlot)
      && hasOneWeekDuration(normalizedText)
      ? 7
      : pending.durationDays;
    const explicitDate = acceptsStartDateAnswer(text, expectedSlot)
      ? parseExplicitDate(normalizedText, context)
      : undefined;
    const weekdayIndex = acceptsStartDateAnswer(text, expectedSlot)
      ? parseWeekdayStart(normalizedText)
      : undefined;
    const weekdayStartDate = weekdayIndex === undefined
      ? undefined
      : resolveWeekdayInScope(weekdayIndex, pending.scope);
    const startDate = explicitDate
      ?? weekdayStartDate
      ?? pending.planningStartDate;

    if (!startDate || !durationDays || !isDateWithinWindow(startDate, pending.scope)) {
      return undefined;
    }

    return rangeFromStartDate({
      startDate,
      durationDays,
      sourceText: text,
    });
  }

  const durationDays = hasOneWeekDuration(normalizedText) ? 7 : undefined;
  if (!durationDays) return undefined;

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

export function parseBeginWeeklyPlanningCommand(
  text: string,
): BeginWeeklyPlanningCommand | undefined {
  const normalizedText = normalizeIntakeText(text);
  if (/(?:消し|削除|変更|変え)/.test(normalizedText)) {
    return undefined;
  }

  if (
    !/(?:予定|計画|スケジュール)/.test(normalizedText)
    || !/(?:立て|作|組|決め)/.test(normalizedText)
    || !/(?:たい|よう|ます|て)/.test(normalizedText)
  ) {
    return undefined;
  }

  return {
    type: 'begin_weekly_planning',
    sourceText: text,
    confidence: 'high',
  };
}

export function parseSetPendingPlanningRangeCommand(
  text: string,
  context: WeeklyPlanningIntakeContext,
  options?: {
    allowBareNamedFuturePeriodAnswer?: boolean;
    pending?: PendingPlanningRangeClarification;
    expectedSlot?: string;
  },
): NormalizedSetPendingPlanningRangeCommand | undefined {
  const range = parseWeeklyPlanningRange(
    text,
    context,
    options?.pending,
    options?.expectedSlot,
  );
  return range ? undefined : parsePendingPlanningRange(text, context, options);
}

export function parseSetPlanningRangeCommand(
  text: string,
  context: WeeklyPlanningIntakeContext,
  pending?: PendingPlanningRangeClarification,
  expectedSlot?: string,
): SetPlanningRangeCommand | undefined {
  const range = parseWeekendPlanningRange(text, context)
    ?? parseWeeklyPlanningRange(
      text,
      context,
      pending,
      expectedSlot,
    );

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
