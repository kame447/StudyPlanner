import type { Plan } from '../../../types/domain';
import type { PlanningRange } from '../intake/weeklyPlanningIntakeTypes';

function dateOnly(value: string | undefined): string | undefined {
  return value?.slice(0, 10);
}

function formatDate(date: string): string {
  const [, month = '', day = ''] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
}

function formatPlan(plan: Plan): string {
  return `${formatDate(plan.date)} ${plan.startTime}〜${plan.endTime}「${plan.title}」`;
}

export function createKnownFixedEventSummaries(
  plans: readonly Plan[],
  range: PlanningRange | undefined,
  maxItems = 3,
): string[] {
  const startDate = dateOnly(range?.startDateTime);
  const endDate = dateOnly(range?.endDateTime);
  if (!startDate || !endDate || maxItems <= 0) return [];

  const matching = plans
    .filter((plan) => plan.date >= startDate && plan.date <= endDate)
    .sort((left, right) =>
      left.date.localeCompare(right.date)
      || left.startTime.localeCompare(right.startTime)
      || left.endTime.localeCompare(right.endTime)
      || left.title.localeCompare(right.title),
    );
  const summaries = matching.slice(0, maxItems).map(formatPlan);
  const remaining = matching.length - summaries.length;
  return remaining > 0 ? [...summaries, `ほか${remaining}件`] : summaries;
}
