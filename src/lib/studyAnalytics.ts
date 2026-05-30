import {
  addDays,
  addMonths,
  getWeekDates,
  minutesBetween,
  sortByDateTime,
  startOfMonth,
  startOfWeek,
} from './date';
import {
  buildPlanOccurrenceKey,
  getActualOccurrenceKey,
} from './planRecurrence';
import {
  isStudyRecordForDisplay,
  normalizeStudyRecordsForDisplay,
  sumStudyRecordMinutes,
} from './studyRecords';
import type { Actual, Plan } from '../types/domain';

export interface StudyDailyTotal {
  date: string;
  minutes: number;
}

export interface StudySubjectTotal {
  subject: string;
  minutes: number;
}

export interface StudyPeriodTotal {
  startDate: string;
  endDate: string;
  minutes: number;
}

export interface StudyTimelineEntry {
  id: string;
  planId: string;
  date: string;
  startTime: string;
  endTime: string;
  title: string;
  subject: string;
  minutes: number;
}

export function isStudyTimePlan(plan: Plan): boolean {
  return plan.type === 'study' || plan.type === 'mock-exam' || plan.type === 'cram-school';
}

export function resolveStudySubject(plan: Plan, actual?: Actual): string {
  return actual?.subject.trim() || plan.subject.trim() || '未設定';
}

export function buildActualByOccurrenceKey(actuals: Actual[]): Map<string, Actual> {
  return new Map(actuals.map((actual) => [getActualOccurrenceKey(actual), actual]));
}

export function getActualMinutes(actual: Actual): number {
  return minutesBetween(actual.actualStartTime, actual.actualEndTime);
}

function buildStudyRecordsInRange(
  startDate: string,
  endDate: string,
  plans: Plan[],
  actuals: Actual[],
) {
  return normalizeStudyRecordsForDisplay({
    actuals,
    plans,
    startDate,
    endDate,
  }).filter(isStudyRecordForDisplay);
}

function calculateNormalizedStudyMinutesInRange(
  startDate: string,
  endDate: string,
  plans: Plan[],
  actuals: Actual[],
): number {
  return sumStudyRecordMinutes(
    buildStudyRecordsInRange(startDate, endDate, plans, actuals),
  );
}

export function getPlannedMinutes(plan: Plan): number {
  return minutesBetween(plan.startTime, plan.endTime);
}

export function calculateActualStudyMinutes(
  plans: Plan[],
  actualByOccurrenceKey: Map<string, Actual>,
): number {
  return plans.reduce((sum, plan) => {
    const actual = actualByOccurrenceKey.get(buildPlanOccurrenceKey(plan.id, plan.date));
    return sum + (actual ? getActualMinutes(actual) : 0);
  }, 0);
}

export function buildWeeklyStudySeries(
  selectedDate: string,
  plans: Plan[],
  actuals: Actual[],
): StudyDailyTotal[] {
  const dates = getWeekDates(selectedDate);

  return dates.map((date) => {
    return {
      date,
      minutes: calculateNormalizedStudyMinutesInRange(date, date, plans, actuals),
    };
  });
}

export function buildRecentDailyStudySeries(
  selectedDate: string,
  plans: Plan[],
  actuals: Actual[],
  dayCount = 7,
): StudyDailyTotal[] {
  return buildDailyStudySeriesInRange(
    addDays(selectedDate, -(dayCount - 1)),
    selectedDate,
    plans,
    actuals,
  );
}

export function buildDailyStudySeriesInRange(
  startDate: string,
  endDate: string,
  plans: Plan[],
  actuals: Actual[],
): StudyDailyTotal[] {
  if (startDate.localeCompare(endDate) > 0) {
    return [];
  }

  const dayCount =
    Math.floor(
      (new Date(`${endDate}T00:00:00`).getTime() -
        new Date(`${startDate}T00:00:00`).getTime()) /
        (24 * 60 * 60 * 1000),
    ) + 1;

  return Array.from({ length: dayCount }, (_, index) => {
    const date = addDays(startDate, index);

    return {
      date,
      minutes: calculateNormalizedStudyMinutesInRange(date, date, plans, actuals),
    };
  });
}

export function buildWeeklyStudySeriesInRange(
  startDate: string,
  endDate: string,
  plans: Plan[],
  actuals: Actual[],
): StudyPeriodTotal[] {
  if (startDate.localeCompare(endDate) > 0) {
    return [];
  }

  const totals = new Map<string, number>();
  buildStudyRecordsInRange(startDate, endDate, plans, actuals).forEach((record) => {
    const weekStart = startOfWeek(record.date);
    totals.set(weekStart, (totals.get(weekStart) ?? 0) + record.durationMinutes);
  });

  const firstWeekStart = startOfWeek(startDate);
  const lastWeekStart = startOfWeek(endDate);
  const weekCount =
    Math.floor(
      (new Date(`${lastWeekStart}T00:00:00`).getTime() -
        new Date(`${firstWeekStart}T00:00:00`).getTime()) /
        (7 * 24 * 60 * 60 * 1000),
    ) + 1;

  return Array.from({ length: weekCount }, (_, index) => {
    const weekStart = addDays(firstWeekStart, index * 7);

    return {
      startDate: weekStart,
      endDate: addDays(weekStart, 6),
      minutes: totals.get(weekStart) ?? 0,
    };
  });
}

export function buildMonthlyStudySeriesInRange(
  startMonthDate: string,
  endMonthDate: string,
  plans: Plan[],
  actuals: Actual[],
): StudyPeriodTotal[] {
  const normalizedStart = startOfMonth(startMonthDate);
  const normalizedEnd = startOfMonth(endMonthDate);

  if (normalizedStart.localeCompare(normalizedEnd) > 0) {
    return [];
  }

  const totals = new Map<string, number>();
  buildStudyRecordsInRange(
    normalizedStart,
    addDays(addMonths(normalizedEnd, 1), -1),
    plans,
    actuals,
  ).forEach((record) => {
    const monthStart = startOfMonth(record.date);
    totals.set(monthStart, (totals.get(monthStart) ?? 0) + record.durationMinutes);
  });

  const monthCount =
    (Number(normalizedEnd.slice(0, 4)) - Number(normalizedStart.slice(0, 4))) * 12 +
    (Number(normalizedEnd.slice(5, 7)) - Number(normalizedStart.slice(5, 7))) +
    1;

  return Array.from({ length: monthCount }, (_, index) => {
    const monthStart = addMonths(normalizedStart, index);

    return {
      startDate: monthStart,
      endDate: addDays(addMonths(monthStart, 1), -1),
      minutes: totals.get(monthStart) ?? 0,
    };
  });
}

function calculateStudyMinutesInRange(
  startDate: string,
  endDate: string,
  plans: Plan[],
  actuals: Actual[],
): number {
  return calculateNormalizedStudyMinutesInRange(startDate, endDate, plans, actuals);
}

export function buildRollingWeeklyStudySeries(
  selectedDate: string,
  plans: Plan[],
  actuals: Actual[],
  weekCount = 6,
): StudyPeriodTotal[] {
  const currentWeekStart = startOfWeek(selectedDate);

  return Array.from({ length: weekCount }, (_, index) => {
    const weekStart = addDays(currentWeekStart, (index - (weekCount - 1)) * 7);
    const weekEnd = addDays(weekStart, 6);

    return {
      startDate: weekStart,
      endDate: weekEnd,
      minutes: calculateStudyMinutesInRange(weekStart, weekEnd, plans, actuals),
    };
  });
}

export function buildRollingMonthlyStudySeries(
  selectedDate: string,
  plans: Plan[],
  actuals: Actual[],
  monthCount = 6,
): StudyPeriodTotal[] {
  const currentMonthStart = startOfMonth(selectedDate);

  return Array.from({ length: monthCount }, (_, index) => {
    const monthStart = addMonths(currentMonthStart, index - (monthCount - 1));
    const monthEnd = addDays(addMonths(monthStart, 1), -1);

    return {
      startDate: monthStart,
      endDate: monthEnd,
      minutes: calculateStudyMinutesInRange(monthStart, monthEnd, plans, actuals),
    };
  });
}

export function calculateWeeklyStudyMinutes(
  selectedDate: string,
  plans: Plan[],
  actuals: Actual[],
): number {
  return buildWeeklyStudySeries(selectedDate, plans, actuals).reduce(
    (sum, entry) => sum + entry.minutes,
    0,
  );
}

export function calculatePreviousWeeklyStudyMinutes(
  selectedDate: string,
  plans: Plan[],
  actuals: Actual[],
): number {
  return calculateWeeklyStudyMinutes(addDays(selectedDate, -7), plans, actuals);
}

export function calculateTodayStudyMinutes(
  selectedDate: string,
  plans: Plan[],
  actuals: Actual[],
): number {
  return calculateNormalizedStudyMinutesInRange(selectedDate, selectedDate, plans, actuals);
}

export function calculateCumulativeStudyMinutes(
  plans: Plan[],
  actuals: Actual[],
): number {
  if (plans.length === 0 && actuals.length === 0) {
    return 0;
  }

  const occurrenceDates = actuals.map((actual) => actual.occurrenceDate);

  if (occurrenceDates.length === 0) {
    return 0;
  }

  const startDate = occurrenceDates.reduce((min, date) => (date < min ? date : min), occurrenceDates[0]);
  const endDate = occurrenceDates.reduce((max, date) => (date > max ? date : max), occurrenceDates[0]);
  return calculateNormalizedStudyMinutesInRange(startDate, endDate, plans, actuals);
}

export function buildWeeklySubjectTotals(
  selectedDate: string,
  plans: Plan[],
  actuals: Actual[],
): StudySubjectTotal[] {
  const weekDates = new Set(getWeekDates(selectedDate));
  const totals = new Map<string, number>();

  buildStudyRecordsInRange(getWeekDates(selectedDate)[0], getWeekDates(selectedDate)[6], plans, actuals).forEach((record) => {
    if (!weekDates.has(record.date)) {
      return;
    }

    totals.set(
      record.subjectLabel,
      (totals.get(record.subjectLabel) ?? 0) + record.durationMinutes,
    );
  });

  return [...totals.entries()]
    .map(([subject, minutes]) => ({ subject, minutes }))
    .sort((left, right) => right.minutes - left.minutes);
}

export function buildStudyTimelineEntries(
  plans: Plan[],
  actuals: Actual[],
): StudyTimelineEntry[] {
  if (actuals.length === 0) {
    return [];
  }

  return sortByDateTime(
    normalizeStudyRecordsForDisplay({ actuals, plans })
      .filter(isStudyRecordForDisplay)
      .map((record) => ({
        id: record.actualId,
        planId: record.planId ?? '',
        date: record.date,
        startTime: record.startTime,
        endTime: record.endTime,
        title: record.title,
        subject: record.subjectLabel,
        minutes: record.durationMinutes,
      })),
  ).reverse();
}
