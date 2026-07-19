import { addDays } from '../../../lib/date';
import {
  endOfWeeklyPlanningWeek,
  nextWeekdayOnOrAfter,
  resolveWeekendRange,
  startOfWeeklyPlanningWeek,
} from '../personalization/weeklyPlanningWeek';
import type { BeginWeeklyPlanningCommand, NormalizedSetPendingPlanningRangeCommand, SetExamScopeCommand, SetPlanningRangeCommand } from './weeklyPlanningCommandTypes';
import {
  isDateWithinWindow,
  isIsoCalendarDate,
  isOrderedPlanningDateTimeRange,
  isValidPlanningDateTime,
  isValidPlanningDurationDays,
} from './weeklyPlanningDateValidation';
import type { ExamPrepScope, PendingPlanningRangeClarification, StudyScopeUnit, WeeklyPlanningIntakeContext } from './weeklyPlanningIntakeTypes';
import {
  normalizeIntakeText,
  parseSmallInteger,
  splitIntakeSegments,
  uniqueList,
} from './weeklyPlanningTextParsing';
import {
  hasAbsoluteMonthDayToken,
  resolveAbsoluteMonthDayDate,
  stripAbsoluteMonthDayTokens,
} from './weeklyPlanningAbsoluteDate';

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

  const weekend = resolveWeekendRange(context.selectedDate);
  const startHour = Number(startMatch[1]);
  const startTime = String(startHour).padStart(2, '0') + ':00';

  return {
    startDateTime: formatDateTime(context.selectedDate, startTime),
    endDateTime: formatDateTime(weekend.endDate, '24:00'),
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

function parseTodayPlanningRange(
  text: string,
  context: WeeklyPlanningIntakeContext,
  expectedSlot?: string,
): SetPlanningRangeCommand['range'] | undefined {
  const normalizedText = stripQuotedSegments(normalizeIntakeText(text)).trim();
  if (hasReportedOrExampleContext(normalizedText)) return undefined;

  const explicitTodayRequest = /今日(?:の)?(?:勉強|学習)?(?:の)?(?:予定|計画|スケジュール)/.test(
    normalizedText,
  ) && /(?:立て|作|組|決め|お願い|して)/.test(normalizedText);
  const bareTodayAnswer = expectedSlot === 'planning_period'
    && /^今日(?:です|でお願いします|にします)?$/.test(normalizedText);
  if (!explicitTodayRequest && !bareTodayAnswer) return undefined;

  const startDateTime = currentDateTime(context);
  const date = startDateTime.slice(0, 10);
  return {
    startDateTime,
    endDateTime: formatDateTime(date, '24:00'),
    sourceText: text,
    calendarDayCount: 1,
    confidence: 'explicit',
  };
}

type NamedPlanningRangeKind = 'this_week' | 'next_week' | 'weekend';

function inclusiveCalendarDayCount(
  startDate: string,
  endDate: string,
): number | undefined {
  if (!isIsoCalendarDate(startDate) || !isIsoCalendarDate(endDate)) {
    return undefined;
  }

  for (let offset = 0; offset <= 14; offset += 1) {
    if (addDays(startDate, offset) === endDate) {
      return offset + 1;
    }
  }

  return undefined;
}

function rangeThroughEndDate(params: {
  context: WeeklyPlanningIntakeContext;
  endDate: string;
  sourceText: string;
  startDate?: string;
  startTime?: string;
}): SetPlanningRangeCommand['range'] | undefined {
  const startDate = params.startDate ?? params.context.selectedDate;
  const calendarDayCount = inclusiveCalendarDayCount(startDate, params.endDate);
  if (!calendarDayCount) return undefined;

  return {
    startDateTime: formatDateTime(
      startDate,
      params.startTime
        ?? (startDate === params.context.selectedDate ? currentTime(params.context) : '00:00'),
    ),
    endDateTime: formatDateTime(params.endDate, '24:00'),
    sourceText: params.sourceText,
    calendarDayCount,
    confidence: 'explicit',
  };
}

function parseNamedPlanningRangeKind(
  text: string,
  expectedSlot?: string,
): NamedPlanningRangeKind | undefined {
  const normalizedText = normalizeIntakeText(text);
  if (hasReportedOrExampleContext(normalizedText)) return undefined;

  const directText = stripQuotedSegments(normalizedText).trim();
  const bareMatch = directText.match(
    /^(今週|来週|週末)(?:\s*(?:です|でお願いします|にします|だって))?$/,
  );
  if (expectedSlot !== 'planning_period' || !bareMatch) {
    return undefined;
  }

  if (/週末/.test(directText)) return 'weekend';
  if (/来週/.test(directText)) return 'next_week';
  if (/今週/.test(directText)) return 'this_week';
  return undefined;
}

function parseNamedPlanningRange(
  text: string,
  context: WeeklyPlanningIntakeContext,
  expectedSlot?: string,
): SetPlanningRangeCommand['range'] | undefined {
  const kind = parseNamedPlanningRangeKind(text, expectedSlot);
  if (!kind) return undefined;

  const weekStart = startOfWeeklyPlanningWeek(context.selectedDate, context.weekStartsOn);
  const weekEnd = endOfWeeklyPlanningWeek(context.selectedDate, context.weekStartsOn);

  if (kind === 'next_week') {
    const startDate = addDays(weekStart, 7);
    return rangeThroughEndDate({
      context,
      startDate,
      startTime: '00:00',
      endDate: addDays(startDate, 6),
      sourceText: text,
    });
  }

  if (kind === 'weekend') {
    const weekend = resolveWeekendRange(context.selectedDate);
    return rangeThroughEndDate({
      context,
      startDate: weekend.startDate,
      endDate: weekend.endDate,
      sourceText: text,
    });
  }

  return rangeThroughEndDate({
    context,
    endDate: weekEnd,
    sourceText: text,
  });
}


type ResolvedPlanningStartDateTime = {
  date: string;
  dateTime: string;
};

function addMinutesToPlanningDateTime(
  value: string,
  minutes: number,
): string | undefined {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
  if (!match || !isValidPlanningDateTime(value)) return undefined;

  const [year, month, day] = match[1].split('-').map(Number);
  const date = new Date(Date.UTC(
    year,
    month - 1,
    day,
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
  ));
  date.setUTCMinutes(date.getUTCMinutes() + minutes);
  const datePart = date.toISOString().slice(0, 10);
  const timePart = String(date.getUTCHours()).padStart(2, '0')
    + ':' + String(date.getUTCMinutes()).padStart(2, '0');
  return formatDateTime(datePart, timePart);
}

function parseClockTime(text: string): string | undefined {
  const match = text.match(/(午前|午後)?\s*(\d{1,2})\s*時(?:半|(?:\s*(\d{1,2})\s*分))?/);
  if (!match) return undefined;

  let hour = Number(match[2]);
  const minute = match[0].includes('半')
    ? 30
    : match[3] === undefined
      ? 0
      : Number(match[3]);
  if (!Number.isInteger(hour) || hour > 23 || minute > 59) return undefined;

  if (match[1] === '午後' && hour < 12) hour += 12;
  if (match[1] === '午前' && hour === 12) hour = 0;
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
}

function parsePeriodTime(text: string): string | undefined {
  if (/朝/.test(text)) return '08:00';
  if (/昼/.test(text)) return '12:00';
  if (/夜/.test(text)) return '20:00';
  return undefined;
}

function parseRelativeStartDateTime(
  text: string,
  context: WeeklyPlanningIntakeContext,
): ResolvedPlanningStartDateTime | undefined {
  const normalizedText = normalizeIntakeText(text);
  const hourMatch = normalizedText.match(
    /([0-9一二三四五六七八九十]+)\s*時間(?:半|(?:\s*([0-9一二三四五六七八九十]+)\s*分))?\s*後/,
  );
  const minuteMatch = normalizedText.match(
    /([0-9一二三四五六七八九十]+)\s*分\s*後/,
  );
  const minutes = hourMatch
    ? (parseSmallInteger(hourMatch[1]) ?? 0) * 60
      + (hourMatch[0].includes('半')
        ? 30
        : parseSmallInteger(hourMatch[2] ?? '') ?? 0)
    : minuteMatch
      ? parseSmallInteger(minuteMatch[1]) ?? 0
      : undefined;
  if (minutes === undefined || minutes <= 0) return undefined;

  const dateTime = addMinutesToPlanningDateTime(currentDateTime(context), minutes);
  return dateTime
    ? { date: dateTime.slice(0, 10), dateTime }
    : undefined;
}

function nextWeekdayStartDate(
  weekdayIndex: number,
  context: WeeklyPlanningIntakeContext,
): string {
  const startDate = currentDateTime(context).slice(0, 10);
  for (let offset = 0; offset <= 7; offset += 1) {
    const date = addDays(startDate, offset);
    if (date && new Date(date + 'T00:00:00Z').getUTCDay() === (weekdayIndex + 1) % 7) {
      return date;
    }
  }
  return startDate;
}

function parsePlanningStartDateTime(
  text: string,
  context: WeeklyPlanningIntakeContext,
): ResolvedPlanningStartDateTime | undefined {
  const normalizedText = normalizeIntakeText(text);
  if (blocksStartDateAnswer(normalizedText)) return undefined;

  if (/(?:^|\s)(?:今すぐ|すぐ)(?:から)?(?:\s|$)/.test(normalizedText)) {
    const dateTime = currentDateTime(context);
    return isValidPlanningDateTime(dateTime)
      ? { date: dateTime.slice(0, 10), dateTime }
      : undefined;
  }

  const relative = parseRelativeStartDateTime(normalizedText, context);
  if (relative) return relative;

  const dayMatch = normalizedText.match(/^(?:明後日|明日|今日)/)
    ?? normalizedText.match(/(?:^|\s)(今日|明日|明後日)/);
  const containsAbsoluteMonthDay = hasAbsoluteMonthDayToken(normalizedText);
  const weekdayMatch = containsAbsoluteMonthDay
    ? undefined
    : normalizedText.match(
      /([月火水木金土日])(?:曜(?:日)?)?(?:の(朝|昼|夜))?\s*から/,
    );
  const explicitDate = parseExplicitDate(normalizedText, context);
  if (containsAbsoluteMonthDay && !explicitDate) return undefined;
  let date: string | undefined;

  if (dayMatch) {
    const dayText = dayMatch[0].trim();
    const offset = dayText === '明後日' ? 2 : dayText === '明日' ? 1 : 0;
    date = addDays(currentDateTime(context).slice(0, 10), offset);
  } else if (explicitDate) {
    date = explicitDate;
  } else if (weekdayMatch) {
    date = nextWeekdayStartDate(WEEKDAY_INDEX[weekdayMatch[1]], context);
  } else if (parseClockTime(normalizedText) && /から|開始|始め/.test(normalizedText)) {
    date = currentDateTime(context).slice(0, 10);
  }

  if (!date || !isIsoCalendarDate(date)) return undefined;

  const time = parseClockTime(normalizedText)
    ?? parsePeriodTime(normalizedText)
    ?? (dayMatch?.[0].includes('今日') ? currentTime(context) : '00:00');

  return {
    date,
    dateTime: formatDateTime(date, time),
  };
}

function sundayBoundaryEndDate(
  text: string,
  context: WeeklyPlanningIntakeContext,
): string | undefined {
  const normalizedText = stripQuotedSegments(normalizeIntakeText(text)).trim();
  if (!/(?:次の\s*)?日曜(?:日)?\s*まで/.test(normalizedText)) {
    return undefined;
  }

  const thisSunday = nextWeekdayOnOrAfter(context.selectedDate, 0);
  return /次の\s*日曜/.test(normalizedText) && context.selectedDate === thisSunday
    ? addDays(thisSunday, 7)
    : thisSunday;
}

function parseSundayBoundPlanningRange(
  text: string,
  context: WeeklyPlanningIntakeContext,
  _expectedSlot?: string,
): SetPlanningRangeCommand['range'] | undefined {
  const normalizedText = normalizeIntakeText(text);
  if (hasReportedOrExampleContext(normalizedText)) return undefined;

  const endDate = sundayBoundaryEndDate(text, context);
  const start = parsePlanningStartDateTime(text, context);
  if (!endDate || !start) return undefined;

  const endDateTime = formatDateTime(endDate, '24:00');
  if (!isOrderedPlanningDateTimeRange({
    startDateTime: start.dateTime,
    endDateTime,
  })) {
    return undefined;
  }

  return rangeThroughEndDate({
    context,
    endDate,
    startDate: start.date,
    startTime: start.dateTime.slice(11, 16),
    sourceText: text,
  });
}

function parseSundayBoundPendingRange(
  text: string,
  context: WeeklyPlanningIntakeContext,
  expectedSlot?: string,
): NormalizedSetPendingPlanningRangeCommand | undefined {
  const normalizedText = normalizeIntakeText(text);
  if (hasReportedOrExampleContext(normalizedText)) return undefined;

  const directText = stripQuotedSegments(normalizedText).trim();
  const isBareAnswer = /^(?:次の\s*)?日曜(?:日)?\s*まで(?:\s*(?:です|でお願いします))?$/.test(
    directText,
  );
  const isPlanningRequest = hasPlanningRequestSignal(directText);
  if (!isPlanningRequest && !(expectedSlot === 'planning_period' && isBareAnswer)) {
    return undefined;
  }

  const endDate = sundayBoundaryEndDate(directText, context);
  if (!endDate) return undefined;

  return {
    type: 'set_pending_planning_range',
    pending: {
      scope: {
        kind: 'named_future_period',
        label: '日曜日まで',
        windowEndDate: endDate,
      },
      planningEndDateTime: formatDateTime(endDate, '24:00'),
      sourceText: text,
    },
    sourceText: text,
    confidence: 'high',
  };
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
  const normalizedText = normalizeIntakeText(text);
  return hasAbsoluteMonthDayToken(normalizedText)
    && /^\s*(?:から)?(?:\s*です)?\s*$/.test(
      stripAbsoluteMonthDayTokens(normalizedText),
    );
}

function isBareDurationAnswer(text: string): boolean {
  return /^\s*(?:(?:一|1)\s*週間|7\s*日間?)(?:\s*です)?\s*$/.test(
    normalizeIntakeText(text),
  );
}

function isCombinedStartAndDurationAnswer(text: string): boolean {
  const normalizedText = normalizeIntakeText(text);
  return hasAbsoluteMonthDayToken(normalizedText)
    && /^\s*(?:から)?\s*(?:(?:一|1)\s*週間|7\s*日間?)(?:\s*です)?\s*$/.test(
      stripAbsoluteMonthDayTokens(normalizedText),
    );
}

function isBareWeekdayStartAnswer(text: string): boolean {
  return /^\s*(?:来週の?)?[月火水木金土日](?:曜(?:日)?)?\s*から(?:\s*(?:(?:一|1)\s*週間|7\s*日間?))?(?:\s*です)?\s*$/.test(
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
      && hasAbsoluteMonthDayToken(text)
      && /(?:計画|予定).*(?:開始|始め)|(?:開始|始め).*(?:計画|予定)/.test(
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
  return resolveAbsoluteMonthDayDate(text, context.selectedDate);
}

export function nextWeekScope(
  context: WeeklyPlanningIntakeContext,
): Extract<PendingPlanningRangeClarification['scope'], { kind: 'next_week' }> {
  const nextWeekStart = addDays(
    startOfWeeklyPlanningWeek(context.selectedDate, context.weekStartsOn),
    7,
  );
  return {
    kind: 'next_week',
    label: '来週',
    windowStartDate: nextWeekStart,
    windowEndDate: addDays(nextWeekStart, 6),
  };
}

function parseWeekdayStart(text: string): number | undefined {
  const withoutExplicitMonthDays = stripAbsoluteMonthDayTokens(text);
  const match = withoutExplicitMonthDays.match(/([月火水木金土日])(?:曜(?:日)?)?\s*から/);
  return match ? WEEKDAY_INDEX[match[1]] : undefined;
}

function resolveWeekdayInScope(
  weekdayIndex: number,
  scope: PendingPlanningRangeClarification['scope'],
  weekStartsOn: WeeklyPlanningIntakeContext['weekStartsOn'],
): string | undefined {
  if (!scope.windowStartDate || !scope.windowEndDate) return undefined;

  const expectedOffset = weekStartsOn === 'sunday'
    ? (weekdayIndex + 1) % 7
    : weekdayIndex;
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(scope.windowStartDate, offset);
    if (date > scope.windowEndDate) return undefined;
    if (offset === expectedOffset) return date;
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

  const sundayPending = parseSundayBoundPendingRange(
    text,
    context,
    options?.expectedSlot,
  );
  if (sundayPending) return sundayPending;

  if (currentPending) {
    const containsAbsoluteMonthDay = hasAbsoluteMonthDayToken(normalizedText);
    const explicitDate = acceptsStartDateAnswer(text, options?.expectedSlot)
      ? parseExplicitDate(normalizedText, context)
      : undefined;
    if (containsAbsoluteMonthDay && !explicitDate) return undefined;
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
    const startDate = weekdayIndex === undefined
      ? undefined
      : resolveWeekdayInScope(weekdayIndex, scope, context.weekStartsOn);

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
    if (pending.planningEndDateTime) {
      const start = parsePlanningStartDateTime(text, context);
      const endDateTime = pending.planningEndDateTime;
      const calendarDayCount = start
        ? inclusiveCalendarDayCount(start.date, endDateTime.slice(0, 10))
        : undefined;
      if (
        !start
        || !calendarDayCount
        || !isOrderedPlanningDateTimeRange({
          startDateTime: start.dateTime,
          endDateTime,
        })
      ) {
        return undefined;
      }
      return {
        startDateTime: start.dateTime,
        endDateTime,
        sourceText: text,
        calendarDayCount,
        confidence: 'explicit',
      };
    }

    const durationDays = acceptsDurationAnswer(text, expectedSlot)
      && hasOneWeekDuration(normalizedText)
      ? 7
      : pending.durationDays;
    const containsAbsoluteMonthDay = hasAbsoluteMonthDayToken(normalizedText);
    const explicitDate = acceptsStartDateAnswer(text, expectedSlot)
      ? parseExplicitDate(normalizedText, context)
      : undefined;
    if (containsAbsoluteMonthDay && !explicitDate) return undefined;
    const weekdayIndex = acceptsStartDateAnswer(text, expectedSlot)
      && !containsAbsoluteMonthDay
      ? parseWeekdayStart(normalizedText)
      : undefined;
    const weekdayStartDate = weekdayIndex === undefined
      ? undefined
      : resolveWeekdayInScope(weekdayIndex, pending.scope, context.weekStartsOn);
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

  const containsAbsoluteMonthDay = hasAbsoluteMonthDayToken(normalizedText);
  const explicitDate = parseExplicitDate(normalizedText, context);
  if (explicitDate) {
    return rangeFromStartDate({ startDate: explicitDate, durationDays, sourceText: text });
  }
  if (containsAbsoluteMonthDay) return undefined;

  if (/来週/.test(normalizedText)) {
    const scope = nextWeekScope(context);
    const weekdayIndex = parseWeekdayStart(normalizedText);
    const startDate = weekdayIndex === undefined
      ? undefined
      : resolveWeekdayInScope(weekdayIndex, scope, context.weekStartsOn);
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
  const range = parseTodayPlanningRange(text, context, expectedSlot)
    ?? parseNamedPlanningRange(text, context, expectedSlot)
    ?? parseSundayBoundPlanningRange(text, context, expectedSlot)
    ?? parseWeekendPlanningRange(text, context)
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

const KNOWN_EXAM_FIELD_TYPO_CORRECTIONS = new Map<string, string>([
  ['ネトワーク', 'ネットワーク'],
  ['デタベース', 'データベース'],
  ['アルゴリズ', 'アルゴリズム'],
  ['オペレーティングシテム', 'オペレーティングシステム'],
]);

function normalizeKnownExamFieldTypo(value: string): string {
  return KNOWN_EXAM_FIELD_TYPO_CORRECTIONS.get(value) ?? value;
}

function correctionRightHandSide(value: string): string {
  const withoutExamPrefix = value.replace(
    /^(?:院試(?:の)?過去問|過去問)\s*[:：]?\s*/,
    '',
  );
  const correction = withoutExamPrefix.match(/(?:ではなく|じゃなく|でなく)\s*(.+)$/);
  return correction?.[1] ?? withoutExamPrefix;
}

function cleanExamFieldCandidate(value: string): string | undefined {
  const cleaned = correctionRightHandSide(value)
    .replace(/^(?:違う[!！]?\s*)/, '')
    .replace(/^(?:対象(?:分野|科目)?|分野|科目)\s*(?:は|が|を)?\s*/, '')
    .replace(/\s*(?:を)?(?:進め|やり|解き|勉強し|学習し)(?:たい|ます|る)?.*$/, '')
    .replace(/\s*(?:だけ)?(?:です|だ|でお願いします)$/, '')
    .trim();
  if (!cleaned || /^(?:院試|過去問|勉強|学習)$/.test(cleaned)) return undefined;
  return normalizeKnownExamFieldTypo(cleaned);
}

function extractInlineExamFields(text: string): string[] {
  const normalizedText = normalizeIntakeText(text).replace(/\s+/g, ' ').trim();
  const combinedSubject = normalizedText.match(
    /(?:違う[!！]?\s*)?(?:(?:院試(?:の)?過去問|過去問)\s*[:：]?\s*)?(?:分野(?:は|が|を)?\s*)?(.+?)\s*で\s*(?:一|1)\s*科目/,
  );
  if (combinedSubject) {
    const combined = cleanExamFieldCandidate(combinedSubject[1]);
    return combined ? [combined] : [];
  }

  const captured = [
    normalizedText.match(
      /(?:院試(?:の)?過去問|過去問)\s*[:：]?\s*(.+?)(?=(?:を)?(?:進め|やり|解き|勉強し|学習し)|$)/,
    )?.[1],
    normalizedText.match(/(?:対象)?分野(?:は|が|を)\s*(.+?)(?=だけ(?:です|だ)?|です|$)/)?.[1],
  ].filter((value): value is string => Boolean(value));

  return uniqueList(captured.flatMap((value) =>
    value
      .split(/\s*(?:、|,|，|／|\/|・|と)\s*/)
      .map(cleanExamFieldCandidate)
      .filter((field): field is string => Boolean(field)),
  ));
}

function extractExamFields(text: string): string[] {
  const sectionFields = normalizeIntakeText(text)
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .map((line) => line.match(/第\s*\d+\s*部\s+(.+)$/)?.[1]?.trim())
    .filter((field): field is string => Boolean(field));
  return sectionFields.length > 0
    ? uniqueList(sectionFields)
    : extractInlineExamFields(text);
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
  const normalizedText = normalizeIntakeText(text);
  if (/(?:1|一)\s*分野\s*(?:あたり|の\s*(?:1|一)?\s*年分)/.test(normalizedText)) {
    return undefined;
  }
  const match = normalizedText.match(/([0-9]+|[一二三四五六七八九十]+)\s*(?:分野|科目)/);
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
  const extractedFields = extractExamFields(text);
  const replacesExistingFields = extractedFields.length > 0
    && /(?:違う|訂正|ではなく|じゃなく|だけ(?:です|だ)?|(?:一|1)\s*科目)/.test(normalizedText);
  const fields = replacesExistingFields
    ? extractedFields
    : uniqueList([...(previousScope?.fields ?? []), ...extractedFields]);
  const parsedTotalFields = parseTotalFields(text);
  const totalFields = parsedTotalFields
    ?? (replacesExistingFields && extractedFields.length > 0
      ? extractedFields.length
      : previousScope?.totalFields);
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
  const fieldDeclaration = /(?:対象)?分野(?:は|が|を)|分野ごと|(?:[0-9]+|[一二三四五六七八九十]+)\s*分野(?!\s*(?:あたり|の\s*(?:1|一)?\s*年分))|(?:[0-9]+|[一二三四五六七八九十]+)\s*科目|第\s*\d+\s*部/.test(normalizedText);
  return /院試|20\d{2}\s*[〜~-]\s*20\d{2}/.test(normalizedText)
    || fieldDeclaration
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
