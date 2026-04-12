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
  expandPlansForDate,
  expandPlansForDateRange,
  getActualOccurrenceKey,
} from './planRecurrence';
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
  const actualByOccurrenceKey = buildActualByOccurrenceKey(actuals);

  return dates.map((date) => {
    const dayPlans = expandPlansForDate(plans, date).filter(isStudyTimePlan);
    return {
      date,
      minutes: calculateActualStudyMinutes(dayPlans, actualByOccurrenceKey),
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

  const actualByOccurrenceKey = buildActualByOccurrenceKey(actuals);
  const dayCount =
    Math.floor(
      (new Date(`${endDate}T00:00:00`).getTime() -
        new Date(`${startDate}T00:00:00`).getTime()) /
        (24 * 60 * 60 * 1000),
    ) + 1;

  return Array.from({ length: dayCount }, (_, index) => {
    const date = addDays(startDate, index);
    const dayPlans = expandPlansForDate(plans, date).filter(isStudyTimePlan);

    return {
      date,
      minutes: calculateActualStudyMinutes(dayPlans, actualByOccurrenceKey),
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

  const actualByOccurrenceKey = buildActualByOccurrenceKey(actuals);
  const totals = new Map<string, number>();
  const visiblePlans = expandPlansForDateRange(plans, startDate, endDate).filter(isStudyTimePlan);

  visiblePlans.forEach((plan) => {
    const actual = actualByOccurrenceKey.get(buildPlanOccurrenceKey(plan.id, plan.date));

    if (!actual) {
      return;
    }

    const weekStart = startOfWeek(plan.date);
    totals.set(weekStart, (totals.get(weekStart) ?? 0) + getActualMinutes(actual));
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

  const actualByOccurrenceKey = buildActualByOccurrenceKey(actuals);
  const totals = new Map<string, number>();
  const visiblePlans = expandPlansForDateRange(
    plans,
    normalizedStart,
    addDays(addMonths(normalizedEnd, 1), -1),
  ).filter(isStudyTimePlan);

  visiblePlans.forEach((plan) => {
    const monthStart = startOfMonth(plan.date);

    if (monthStart.localeCompare(normalizedStart) < 0 || monthStart.localeCompare(normalizedEnd) > 0) {
      return;
    }

    const actual = actualByOccurrenceKey.get(buildPlanOccurrenceKey(plan.id, plan.date));

    if (!actual) {
      return;
    }

    totals.set(monthStart, (totals.get(monthStart) ?? 0) + getActualMinutes(actual));
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
  actualByOccurrenceKey: Map<string, Actual>,
): number {
  const rangePlans = expandPlansForDateRange(plans, startDate, endDate).filter(isStudyTimePlan);

  return calculateActualStudyMinutes(rangePlans, actualByOccurrenceKey);
}

export function buildRollingWeeklyStudySeries(
  selectedDate: string,
  plans: Plan[],
  actuals: Actual[],
  weekCount = 6,
): StudyPeriodTotal[] {
  const currentWeekStart = startOfWeek(selectedDate);
  const actualByOccurrenceKey = buildActualByOccurrenceKey(actuals);

  return Array.from({ length: weekCount }, (_, index) => {
    const weekStart = addDays(currentWeekStart, (index - (weekCount - 1)) * 7);
    const weekEnd = addDays(weekStart, 6);

    return {
      startDate: weekStart,
      endDate: weekEnd,
      minutes: calculateStudyMinutesInRange(weekStart, weekEnd, plans, actualByOccurrenceKey),
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
  const actualByOccurrenceKey = buildActualByOccurrenceKey(actuals);

  return Array.from({ length: monthCount }, (_, index) => {
    const monthStart = addMonths(currentMonthStart, index - (monthCount - 1));
    const monthEnd = addDays(addMonths(monthStart, 1), -1);

    return {
      startDate: monthStart,
      endDate: monthEnd,
      minutes: calculateStudyMinutesInRange(monthStart, monthEnd, plans, actualByOccurrenceKey),
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
  const actualByOccurrenceKey = buildActualByOccurrenceKey(actuals);
  const dayPlans = expandPlansForDate(plans, selectedDate).filter(isStudyTimePlan);
  return calculateActualStudyMinutes(dayPlans, actualByOccurrenceKey);
}

export function calculateCumulativeStudyMinutes(
  plans: Plan[],
  actuals: Actual[],
): number {
  if (plans.length === 0) {
    return 0;
  }

  const actualByOccurrenceKey = buildActualByOccurrenceKey(actuals);
  const occurrenceDates = actuals.map((actual) => actual.occurrenceDate);

  if (occurrenceDates.length === 0) {
    return 0;
  }

  const startDate = occurrenceDates.reduce((min, date) => (date < min ? date : min), occurrenceDates[0]);
  const endDate = occurrenceDates.reduce((max, date) => (date > max ? date : max), occurrenceDates[0]);
  const studyPlans = expandPlansForDateRange(plans, startDate, endDate).filter(isStudyTimePlan);
  return calculateActualStudyMinutes(studyPlans, actualByOccurrenceKey);
}

export function buildWeeklySubjectTotals(
  selectedDate: string,
  plans: Plan[],
  actuals: Actual[],
): StudySubjectTotal[] {
  const weekDates = new Set(getWeekDates(selectedDate));
  const visiblePlans = expandPlansForDateRange(plans, getWeekDates(selectedDate)[0], getWeekDates(selectedDate)[6]).filter(isStudyTimePlan);
  const planByOccurrenceKey = new Map(
    visiblePlans.map((plan) => [buildPlanOccurrenceKey(plan.id, plan.date), plan]),
  );
  const totals = new Map<string, number>();

  actuals.forEach((actual) => {
    const plan = planByOccurrenceKey.get(getActualOccurrenceKey(actual));

    if (!plan || !isStudyTimePlan(plan) || !weekDates.has(plan.date)) {
      return;
    }

    const subject = resolveStudySubject(plan, actual);
    totals.set(subject, (totals.get(subject) ?? 0) + getActualMinutes(actual));
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

  const occurrenceDates = actuals.map((actual) => actual.occurrenceDate);
  const startDate = occurrenceDates.reduce((min, date) => (date < min ? date : min), occurrenceDates[0]);
  const endDate = occurrenceDates.reduce((max, date) => (date > max ? date : max), occurrenceDates[0]);
  const visiblePlans = expandPlansForDateRange(plans, startDate, endDate);
  const planByOccurrenceKey = new Map(
    visiblePlans.map((plan) => [buildPlanOccurrenceKey(plan.id, plan.date), plan]),
  );

  return sortByDateTime(
    actuals.flatMap((actual) => {
      const plan = planByOccurrenceKey.get(getActualOccurrenceKey(actual));

      if (!plan || !isStudyTimePlan(plan)) {
        return [];
      }

      return [
        {
          id: actual.id,
          planId: plan.id,
          date: plan.date,
          startTime: actual.actualStartTime,
          endTime: actual.actualEndTime,
          title: actual.title?.trim() || plan.title,
          subject: resolveStudySubject(plan, actual),
          minutes: getActualMinutes(actual),
        },
      ];
    }),
  ).reverse();
}
