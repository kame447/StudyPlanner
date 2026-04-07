import { addDays, getWeekDates, minutesBetween, sortByDateTime } from './date';
import type { Actual, Plan } from '../types/domain';

export interface StudyDailyTotal {
  date: string;
  minutes: number;
}

export interface StudySubjectTotal {
  subject: string;
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
