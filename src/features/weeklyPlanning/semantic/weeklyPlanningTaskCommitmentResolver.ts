import type { RecurrenceFact } from './weeklyPlanningFactGraph';
import type { TemporalConstraintFactV2 } from './weeklyPlanningFactGraphV2';
import {
  addCalendarDays,
  intersectCalendarDates,
  isValidCalendarDate,
  listCalendarDatesInclusive,
  resolveCanonicalDateExpression,
} from './weeklyPlanningCalendarResolver';
import {
  resolveWeeklyPlanningCalendarRecurrenceDatesV5,
} from './weeklyPlanningRecurrenceCalendarV5';

export interface WeeklyPlanningTaskCommitmentGraphView {
  readonly revision: number;
  readonly temporalConstraints: ReadonlyArray<TemporalConstraintFactV2>;
  readonly recurrences: ReadonlyArray<RecurrenceFact>;
}

export interface TaskCommitmentLocalPoint {
  date: string;
  time: string;
}

export interface TaskCommitmentReservation {
  id: string;
  taskId: string;
  temporalConstraintFactId: string;
  start: TaskCommitmentLocalPoint;
  end: TaskCommitmentLocalPoint;
  timeZone: string;
  constraintLevel: 'hard';
  sourceKind: 'user_commitment';
  sourceRef: string;
  graphRevision: number;
}

export interface TaskCommitmentResolutionContext {
  currentDate: string;
  planningStartDate: string;
  planningEndDate: string;
  timeZone: string;
}

export type TaskCommitmentResolutionIssueCode =
  | 'invalid_planning_date_range'
  | 'unsupported_commitment_date_expression'
  | 'missing_commitment_date_scope'
  | 'ambiguous_commitment_recurrence'
  | 'invalid_commitment_weekday'
  | 'invalid_commitment_interval'
  | 'unknown_commitment_constraint_level'
  | 'soft_fixed_interval_not_allowed'
  | 'commitment_outside_planning_window';

export interface TaskCommitmentResolutionIssue {
  code: TaskCommitmentResolutionIssueCode;
  temporalConstraintFactId: string;
  taskId: string;
  blocking: boolean;
  details?: Record<string, string | number | boolean | null>;
}

export interface TaskCommitmentResolutionResult {
  reservations: TaskCommitmentReservation[];
  issues: TaskCommitmentResolutionIssue[];
  readiness: 'ready' | 'needs_resolution' | 'empty';
}

const CLOCK_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function datesFromRecurrence(params: {
  recurrence: RecurrenceFact;
  planningDates: string[];
  constraint: TemporalConstraintFactV2;
  issues: TaskCommitmentResolutionIssue[];
}): string[] {
  const resolution = resolveWeeklyPlanningCalendarRecurrenceDatesV5({
    kind: params.recurrence.kind,
    days: params.recurrence.days,
    dates: params.planningDates,
  });
  for (const day of resolution.invalidDays) {
    params.issues.push({
      code: 'invalid_commitment_weekday',
      temporalConstraintFactId: params.constraint.id,
      taskId: params.constraint.taskId,
      blocking: true,
      details: { day },
    });
  }
  return resolution.calendarDates ?? [];
}

function resolveDates(params: {
  graph: WeeklyPlanningTaskCommitmentGraphView;
  constraint: TemporalConstraintFactV2;
  context: TaskCommitmentResolutionContext;
  planningDates: string[];
  issues: TaskCommitmentResolutionIssue[];
}): string[] {
  const recurrences = params.graph.recurrences.filter((recurrence) =>
    recurrence.taskId === params.constraint.taskId
    && recurrence.targetFactId === params.constraint.taskId);
  if (recurrences.length > 1) {
    params.issues.push({
      code: 'ambiguous_commitment_recurrence',
      temporalConstraintFactId: params.constraint.id,
      taskId: params.constraint.taskId,
      blocking: true,
      details: { recurrenceCount: recurrences.length },
    });
    return [];
  }

  let dates: string[] | null = recurrences.length === 1
    ? datesFromRecurrence({
        recurrence: recurrences[0],
        planningDates: params.planningDates,
        constraint: params.constraint,
        issues: params.issues,
      })
    : null;

  if (params.constraint.dateExpression) {
    const resolution = resolveCanonicalDateExpression({
      expression: params.constraint.dateExpression,
      currentDate: params.context.currentDate,
    });
    if (resolution.status !== 'resolved') {
      params.issues.push({
        code: 'unsupported_commitment_date_expression',
        temporalConstraintFactId: params.constraint.id,
        taskId: params.constraint.taskId,
        blocking: true,
        details: {
          expression: params.constraint.dateExpression,
          resolutionStatus: resolution.status,
        },
      });
      return [];
    }
    const expressionDates = listCalendarDatesInclusive(
      resolution.range.start,
      resolution.range.end,
    ) ?? [];
    if (dates) {
      const expressionSet = new Set(expressionDates);
      dates = dates.filter((date) => expressionSet.has(date));
    } else {
      dates = expressionDates;
    }
  }

  if (!dates) {
    if (params.planningDates.length === 1) return [...params.planningDates];
    params.issues.push({
      code: 'missing_commitment_date_scope',
      temporalConstraintFactId: params.constraint.id,
      taskId: params.constraint.taskId,
      blocking: true,
    });
    return [];
  }

  const inWindow = intersectCalendarDates(
    dates,
    params.context.planningStartDate,
    params.context.planningEndDate,
  ) ?? [];
  if (dates.length > 0 && inWindow.length === 0) {
    params.issues.push({
      code: 'commitment_outside_planning_window',
      temporalConstraintFactId: params.constraint.id,
      taskId: params.constraint.taskId,
      blocking: false,
    });
  }
  return inWindow;
}

function createEndPoint(
  date: string,
  startTime: string,
  endTime: string,
): TaskCommitmentLocalPoint | null {
  if (endTime < startTime) {
    const nextDate = addCalendarDays(date, 1);
    return nextDate ? { date: nextDate, time: endTime } : null;
  }
  return { date, time: endTime };
}

export function resolveWeeklyPlanningTaskCommitments(params: {
  graph: WeeklyPlanningTaskCommitmentGraphView;
  context: TaskCommitmentResolutionContext;
}): TaskCommitmentResolutionResult {
  const planningDates = listCalendarDatesInclusive(
    params.context.planningStartDate,
    params.context.planningEndDate,
  );
  if (!planningDates || !isValidCalendarDate(params.context.currentDate)) {
    return {
      reservations: [],
      issues: [{
        code: 'invalid_planning_date_range',
        temporalConstraintFactId: 'planning-context',
        taskId: 'planning-context',
        blocking: true,
      }],
      readiness: 'needs_resolution',
    };
  }

  const issues: TaskCommitmentResolutionIssue[] = [];
  const reservations: TaskCommitmentReservation[] = [];
  for (const constraint of params.graph.temporalConstraints) {
    if (constraint.kind !== 'fixed_interval') continue;
    if (constraint.constraintLevel === 'unknown') {
      issues.push({
        code: 'unknown_commitment_constraint_level',
        temporalConstraintFactId: constraint.id,
        taskId: constraint.taskId,
        blocking: true,
      });
      continue;
    }
    if (constraint.constraintLevel === 'soft') {
      issues.push({
        code: 'soft_fixed_interval_not_allowed',
        temporalConstraintFactId: constraint.id,
        taskId: constraint.taskId,
        blocking: true,
      });
      continue;
    }
    if (
      !constraint.startTime
      || !constraint.endTime
      || !CLOCK_PATTERN.test(constraint.startTime)
      || !CLOCK_PATTERN.test(constraint.endTime)
      || constraint.startTime === constraint.endTime
    ) {
      issues.push({
        code: 'invalid_commitment_interval',
        temporalConstraintFactId: constraint.id,
        taskId: constraint.taskId,
        blocking: true,
      });
      continue;
    }

    const dates = resolveDates({
      graph: params.graph,
      constraint,
      context: params.context,
      planningDates,
      issues,
    });
    for (const date of dates) {
      const end = createEndPoint(date, constraint.startTime, constraint.endTime);
      if (!end) {
        issues.push({
          code: 'invalid_commitment_interval',
          temporalConstraintFactId: constraint.id,
          taskId: constraint.taskId,
          blocking: true,
        });
        continue;
      }
      reservations.push({
        id: `wpcr_${stableHash([
          constraint.id,
          constraint.taskId,
          date,
          constraint.startTime,
          end.date,
          end.time,
        ].join('|'))}`,
        taskId: constraint.taskId,
        temporalConstraintFactId: constraint.id,
        start: { date, time: constraint.startTime },
        end,
        timeZone: params.context.timeZone,
        constraintLevel: 'hard',
        sourceKind: 'user_commitment',
        sourceRef: constraint.id,
        graphRevision: params.graph.revision,
      });
    }
  }

  const blocking = issues.some((issue) => issue.blocking);
  return {
    reservations,
    issues,
    readiness: reservations.length === 0
      ? blocking
        ? 'needs_resolution'
        : 'empty'
      : blocking
        ? 'needs_resolution'
        : 'ready',
  };
}
