import {
  addDays,
  addMonths,
  getWeekDates,
  minutesBetween,
  sortByDateTime,
  startOfMonth,
  startOfWeek,
} from './date';
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

export function buildActualByPlanId(actuals: Actual[]): Map<string, Actual> {
  return new Map(actuals.map((actual) => [actual.planId, actual]));
}

export function getActualMinutes(actual: Actual): number {
  return minutesBetween(actual.actualStartTime, actual.actualEndTime);
}

export function getPlannedMinutes(plan: Plan): number {
  return minutesBetween(plan.startTime, plan.endTime);
}

export function calculateActualStudyMinutes(
  plans: Plan[],
  actualByPlanId: Map<string, Actual>,
): number {
  return plans.reduce((sum, plan) => {
    const actual = actualByPlanId.get(plan.id);
    return sum + (actual ? getActualMinutes(actual) : 0);
  }, 0);
}

export function buildWeeklyStudySeries(
  selectedDate: string,
  plans: Plan[],
  actuals: Actual[],
): StudyDailyTotal[] {
  const dates = getWeekDates(selectedDate);
  const actualByPlanId = buildActualByPlanId(actuals);

  return dates.map((date) => {
    const dayPlans = plans.filter((plan) => isStudyTimePlan(plan) && plan.date === date);
    return {
      date,
      minutes: calculateActualStudyMinutes(dayPlans, actualByPlanId),
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

  const actualByPlanId = buildActualByPlanId(actuals);
  const dayCount =
    Math.floor(
      (new Date(`${endDate}T00:00:00`).getTime() -
        new Date(`${startDate}T00:00:00`).getTime()) /
        (24 * 60 * 60 * 1000),
    ) + 1;

  return Array.from({ length: dayCount }, (_, index) => {
    const date = addDays(startDate, index);
    const dayPlans = plans.filter((plan) => isStudyTimePlan(plan) && plan.date === date);

    return {
      date,
      minutes: calculateActualStudyMinutes(dayPlans, actualByPlanId),
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

  const actualByPlanId = buildActualByPlanId(actuals);
  const totals = new Map<string, number>();

  plans.forEach((plan) => {
    if (
      !isStudyTimePlan(plan) ||
      plan.date.localeCompare(startDate) < 0 ||
      plan.date.localeCompare(endDate) > 0
    ) {
      return;
    }

    const actual = actualByPlanId.get(plan.id);

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

  const actualByPlanId = buildActualByPlanId(actuals);
  const totals = new Map<string, number>();

  plans.forEach((plan) => {
    if (!isStudyTimePlan(plan)) {
      return;
    }

    const monthStart = startOfMonth(plan.date);

    if (monthStart.localeCompare(normalizedStart) < 0 || monthStart.localeCompare(normalizedEnd) > 0) {
      return;
    }

    const actual = actualByPlanId.get(plan.id);

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
  actualByPlanId: Map<string, Actual>,
): number {
  const rangePlans = plans.filter(
    (plan) =>
      isStudyTimePlan(plan) &&
      plan.date.localeCompare(startDate) >= 0 &&
      plan.date.localeCompare(endDate) <= 0,
  );

  return calculateActualStudyMinutes(rangePlans, actualByPlanId);
}

export function buildRollingWeeklyStudySeries(
  selectedDate: string,
  plans: Plan[],
  actuals: Actual[],
  weekCount = 6,
): StudyPeriodTotal[] {
  const currentWeekStart = startOfWeek(selectedDate);
  const actualByPlanId = buildActualByPlanId(actuals);

  return Array.from({ length: weekCount }, (_, index) => {
    const weekStart = addDays(currentWeekStart, (index - (weekCount - 1)) * 7);
    const weekEnd = addDays(weekStart, 6);

    return {
      startDate: weekStart,
      endDate: weekEnd,
      minutes: calculateStudyMinutesInRange(weekStart, weekEnd, plans, actualByPlanId),
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
  const actualByPlanId = buildActualByPlanId(actuals);

  return Array.from({ length: monthCount }, (_, index) => {
    const monthStart = addMonths(currentMonthStart, index - (monthCount - 1));
    const monthEnd = addDays(addMonths(monthStart, 1), -1);

    return {
      startDate: monthStart,
      endDate: monthEnd,
      minutes: calculateStudyMinutesInRange(monthStart, monthEnd, plans, actualByPlanId),
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
  const actualByPlanId = buildActualByPlanId(actuals);
  const dayPlans = plans.filter((plan) => isStudyTimePlan(plan) && plan.date === selectedDate);
  return calculateActualStudyMinutes(dayPlans, actualByPlanId);
}

export function calculateCumulativeStudyMinutes(
  plans: Plan[],
  actuals: Actual[],
): number {
  const actualByPlanId = buildActualByPlanId(actuals);
  const studyPlans = plans.filter(isStudyTimePlan);
  return calculateActualStudyMinutes(studyPlans, actualByPlanId);
}

export function buildWeeklySubjectTotals(
  selectedDate: string,
  plans: Plan[],
  actuals: Actual[],
): StudySubjectTotal[] {
  const weekDates = new Set(getWeekDates(selectedDate));
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const totals = new Map<string, number>();

  actuals.forEach((actual) => {
    const plan = planById.get(actual.planId);

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
  const planById = new Map(plans.map((plan) => [plan.id, plan]));

  return sortByDateTime(
    actuals.flatMap((actual) => {
      const plan = planById.get(actual.planId);

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
