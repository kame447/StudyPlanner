import { addDays } from './date';
import type { Plan, MonthEventRepeat, Actual } from '../types/domain';

export const PLAN_REPEAT_OPTIONS: Array<{
  value: MonthEventRepeat;
  label: string;
}> = [
  { value: 'none', label: '繰り返しなし' },
  { value: 'daily', label: '毎日' },
  { value: 'weekly', label: '毎週' },
  { value: 'monthly', label: '毎月' },
  { value: 'yearly', label: '毎年' },
];

function toDate(dateString: string): Date {
  return new Date(`${dateString}T00:00:00`);
}

export function getPlanRepeatLabel(repeat: MonthEventRepeat): string {
  return (
    PLAN_REPEAT_OPTIONS.find((option) => option.value === repeat)?.label ??
    '繰り返しなし'
  );
}

export function buildPlanOccurrenceKey(planId: string, occurrenceDate: string): string {
  return `${planId}::${occurrenceDate}`;
}

export function getPlanOccurrenceDate(plan: Plan): string {
  return plan.occurrenceDate ?? plan.date;
}

export function getActualOccurrenceKey(actual: Actual): string {
  return buildPlanOccurrenceKey(actual.planId, actual.occurrenceDate);
}

export function doesPlanOccurOnDate(plan: Plan, targetDate: string): boolean {
  if (targetDate.localeCompare(plan.date) < 0) {
    return false;
  }

  if (plan.repeatUntil && targetDate.localeCompare(plan.repeatUntil) > 0) {
    return false;
  }

  if (plan.excludedDates.includes(targetDate)) {
    return false;
  }

  if (plan.repeat === 'none') {
    return plan.date === targetDate;
  }

  const baseDate = toDate(plan.date);
  const date = toDate(targetDate);

  if (plan.repeat === 'daily') {
    return true;
  }

  if (plan.repeat === 'weekly') {
    return baseDate.getDay() === date.getDay();
  }

  if (plan.repeat === 'monthly') {
    return baseDate.getDate() === date.getDate();
  }

  return (
    baseDate.getMonth() === date.getMonth() &&
    baseDate.getDate() === date.getDate()
  );
}

export function resolvePlanOccurrence(plan: Plan, occurrenceDate: string): Plan {
  return {
    ...plan,
    sourceDate: plan.sourceDate ?? plan.date,
    date: occurrenceDate,
    occurrenceDate,
    occurrenceKey: buildPlanOccurrenceKey(plan.id, occurrenceDate),
  };
}

export function expandPlansForDate(plans: Plan[], targetDate: string): Plan[] {
  return plans
    .filter((plan) => doesPlanOccurOnDate(plan, targetDate))
    .map((plan) => resolvePlanOccurrence(plan, targetDate));
}

export function expandPlansForDateRange(
  plans: Plan[],
  startDate: string,
  endDate: string,
): Plan[] {
  const occurrences: Plan[] = [];
  let cursor = startDate;

  while (cursor.localeCompare(endDate) <= 0) {
    occurrences.push(...expandPlansForDate(plans, cursor));
    cursor = addDays(cursor, 1);
  }

  return occurrences;
}
