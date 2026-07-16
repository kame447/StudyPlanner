import { addDays } from '../../../lib/date';
import { expandPlansForDateRange } from '../../../lib/planRecurrence';
import type { Plan } from '../../../types/domain';
import type { PlanningRange } from '../intake/weeklyPlanningIntakeTypes';

function dateOnly(value: string | undefined): string | undefined {
  return value?.slice(0, 10);
}

function normalizedBoundary(value: string | undefined, edge: 'start' | 'end'): string | undefined {
  if (!value) return undefined;
  const date = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const time = value.includes('T') ? value.slice(11, 19) : '';
  if (time.length >= 5) {
    return date + 'T' + time.slice(0, 5) + ':00';
  }
  return edge === 'start' ? date + 'T00:00:00' : date + 'T23:59:59';
}

function occurrenceStart(plan: Plan): string {
  return plan.date + 'T' + plan.startTime.slice(0, 5) + ':00';
}

function occurrenceEnd(plan: Plan): string {
  const start = plan.startTime.slice(0, 5);
  const end = plan.endTime.slice(0, 5);
  const endDate = end <= start && end !== '24:00' ? addDays(plan.date, 1) : plan.date;
  return endDate + 'T' + end + ':00';
}

function overlapsRange(plan: Plan, start: string, end: string): boolean {
  return occurrenceEnd(plan) > start && occurrenceStart(plan) < end;
}

function sortOccurrences(left: Plan, right: Plan): number {
  return left.date.localeCompare(right.date)
    || left.startTime.localeCompare(right.startTime)
    || left.endTime.localeCompare(right.endTime)
    || left.title.localeCompare(right.title)
    || left.id.localeCompare(right.id);
}

function formatDate(date: string): string {
  const [, month = '', day = ''] = date.split('-');
  return Number(month) + '/' + Number(day);
}

function formatPlan(plan: Plan): string {
  return formatDate(plan.date) + ' ' + plan.startTime + '〜' + plan.endTime + '「' + plan.title + '」';
}

export function createKnownFixedEventOccurrences(
  plans: readonly Plan[],
  range: PlanningRange | undefined,
): Plan[] {
  const start = normalizedBoundary(range?.startDateTime, 'start');
  const end = normalizedBoundary(range?.endDateTime, 'end');
  const startDate = dateOnly(start);
  const endDate = dateOnly(end);
  if (!start || !end || !startDate || !endDate || end <= start) return [];

  return expandPlansForDateRange([...plans], startDate, endDate)
    .filter((plan) => overlapsRange(plan, start, end))
    .sort(sortOccurrences);
}

export function createKnownFixedEventSummaries(
  plans: readonly Plan[],
  range: PlanningRange | undefined,
  maxItems = 3,
): string[] {
  if (maxItems <= 0) return [];
  const matching = createKnownFixedEventOccurrences(plans, range);
  const summaries = matching.slice(0, maxItems).map(formatPlan);
  const remaining = matching.length - summaries.length;
  return remaining > 0 ? [...summaries, 'ほか' + remaining + '件'] : summaries;
}
