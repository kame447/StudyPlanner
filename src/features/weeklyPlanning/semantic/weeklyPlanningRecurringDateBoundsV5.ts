import type { CalendarWeekStartsOn } from './weeklyPlanningCalendarResolver';
import {
  resolveCanonicalDateExpression,
} from './weeklyPlanningCalendarResolver';
import type {
  RecurrenceFactV5,
  WorkloadFactV5,
} from './weeklyPlanningFactGraphV5';

interface WeeklyPlanningRecurringTemporalConstraintV5 {
  id: string;
  taskId: string;
  targetFactId: string;
  kind: string;
  constraintLevel?: string;
  dateExpression: string | null;
}

export interface WeeklyPlanningRecurringDateBoundsGraphViewV5 {
  readonly workloads: ReadonlyArray<Pick<
    WorkloadFactV5,
    'id' | 'taskId' | 'componentId' | 'perOccurrence'
  >>;
  readonly recurrences: ReadonlyArray<Pick<
    RecurrenceFactV5,
    'id' | 'taskId' | 'targetFactId' | 'kind'
  >>;
  readonly temporalConstraints: ReadonlyArray<WeeklyPlanningRecurringTemporalConstraintV5>;
}

export interface WeeklyPlanningRecurringDateBoundV5 {
  taskId: string;
  targetFactId: string;
  recurrenceFactId: string;
  startDate: string | null;
  endDate: string | null;
}

function isSimpleExpandedRecurrenceKind(
  kind: RecurrenceFactV5['kind'],
): boolean {
  return kind === 'daily' || kind === 'weekdays' || kind === 'weekends';
}

function resolvedConstraintDate(params: {
  constraint: Pick<WeeklyPlanningRecurringTemporalConstraintV5, 'kind' | 'dateExpression'>;
  currentDate: string;
  weekStartsOn?: CalendarWeekStartsOn;
}): string | null {
  if (!params.constraint.dateExpression) return null;
  const resolved = resolveCanonicalDateExpression({
    expression: params.constraint.dateExpression,
    currentDate: params.currentDate,
    weekStartsOn: params.weekStartsOn,
  });
  if (resolved.status !== 'resolved') return null;
  if (params.constraint.kind === 'earliest_start') return resolved.range.start;
  if (
    params.constraint.kind === 'deadline'
    || params.constraint.kind === 'latest_end'
  ) {
    return resolved.range.end;
  }
  return null;
}

function laterDate(left: string | null, right: string): string {
  return left === null || right > left ? right : left;
}

function earlierDate(left: string | null, right: string): string {
  return left === null || right < left ? right : left;
}

export function resolveWeeklyPlanningRecurringDateBoundsV5(params: {
  graph: WeeklyPlanningRecurringDateBoundsGraphViewV5;
  currentDate: string;
  weekStartsOn?: CalendarWeekStartsOn;
}): WeeklyPlanningRecurringDateBoundV5[] {
  const result: WeeklyPlanningRecurringDateBoundV5[] = [];

  for (const workload of params.graph.workloads) {
    if (!workload.perOccurrence) continue;
    const targetFactId = workload.componentId ?? workload.taskId;
    const matchingRecurrences = params.graph.recurrences.filter((recurrence) =>
      recurrence.taskId === workload.taskId
      && recurrence.targetFactId === targetFactId);
    if (
      matchingRecurrences.length !== 1
      || !isSimpleExpandedRecurrenceKind(matchingRecurrences[0].kind)
    ) {
      continue;
    }

    let startDate: string | null = null;
    let endDate: string | null = null;
    for (const constraint of params.graph.temporalConstraints) {
      if (
        constraint.constraintLevel !== 'hard'
        || constraint.taskId !== workload.taskId
        || constraint.targetFactId !== targetFactId
      ) {
        continue;
      }
      const date = resolvedConstraintDate({
        constraint,
        currentDate: params.currentDate,
        weekStartsOn: params.weekStartsOn,
      });
      if (!date) continue;
      if (constraint.kind === 'earliest_start') {
        startDate = laterDate(startDate, date);
      } else if (
        constraint.kind === 'deadline'
        || constraint.kind === 'latest_end'
      ) {
        endDate = earlierDate(endDate, date);
      }
    }

    result.push({
      taskId: workload.taskId,
      targetFactId,
      recurrenceFactId: matchingRecurrences[0].id,
      startDate,
      endDate,
    });
  }

  return result;
}

export function filterWeeklyPlanningRecurringDatesByHardBoundsV5(params: {
  dates: readonly string[];
  bound: WeeklyPlanningRecurringDateBoundV5 | undefined;
}): string[] {
  const bound = params.bound;
  if (!bound) return [...params.dates];
  return params.dates.filter((date) =>
    (!bound.startDate || date >= bound.startDate)
    && (!bound.endDate || date <= bound.endDate));
}
