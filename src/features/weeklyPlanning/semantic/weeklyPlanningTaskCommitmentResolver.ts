import type {
  RecurrenceFact,
  TemporalConstraintFactV2,
  WeeklyPlanningFactGraphV2,
} from './weeklyPlanningFactGraphV2';

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

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function parseDate(value: string): Date | null {
  if (!ISO_DATE_PATTERN.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, amount: number): string | null {
  const date = parseDate(value);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + amount);
  return formatDate(date);
}

function dateRange(start: string, end: string): string[] | null {
  if (!parseDate(start) || !parseDate(end) || start > end) return null;
  const values: string[] = [];
  let current = start;
  while (current <= end) {
    values.push(current);
    const next = addDays(current, 1);
    if (!next) return null;
    current = next;
  }
  return values;
}

function mondayOfWeek(value: string): string | null {
  const date = parseDate(value);
  if (!date) return null;
  const day = date.getUTCDay();
  return addDays(value, day === 0 ? -6 : 1 - day);
}

function resolveDateExpression(
  expression: string,
  currentDate: string,
): { start: string; end: string } | null {
  if (ISO_DATE_PATTERN.test(expression)) return { start: expression, end: expression };
  if (expression === 'today') return { start: currentDate, end: currentDate };
  if (expression === 'tomorrow') {
    const date = addDays(currentDate, 1);
    return date ? { start: date, end: date } : null;
  }
  if (expression === 'day_after_tomorrow') {
    const date = addDays(currentDate, 2);
    return date ? { start: date, end: date } : null;
  }
  const monday = mondayOfWeek(currentDate);
  if (!monday) return null;
  if (expression === 'this_week') {
    const end = addDays(monday, 6);
    return end ? { start: monday, end } : null;
  }
  if (expression === 'next_week') {
    const start = addDays(monday, 7);
    const end = addDays(monday, 13);
    return start && end ? { start, end } : null;
  }
  return null;
}

function weekday(date: string): number | null {
  return parseDate(date)?.getUTCDay() ?? null;
}

function datesFromRecurrence(params: {
  recurrence: RecurrenceFact;
  planningDates: string[];
  constraint: TemporalConstraintFactV2;
  issues: TaskCommitmentResolutionIssue[];
}): string[] {
  if (params.recurrence.kind === 'daily') return [...params.planningDates];
  if (params.recurrence.kind === 'weekdays') {
    return params.planningDates.filter((date) => {
      const day = weekday(date);
      return day !== null && day >= 1 && day <= 5;
    });
  }
  if (params.recurrence.kind === 'weekends') {
    return params.planningDates.filter((date) => {
      const day = weekday(date);
      return day === 0 || day === 6;
    });
  }

  const indexes = new Set<number>();
  for (const day of params.recurrence.days) {
    const index = WEEKDAY_INDEX[day];
    if (index === undefined) {
      params.issues.push({
        code: 'invalid_commitment_weekday',
        temporalConstraintFactId: params.constraint.id,
        taskId: params.constraint.taskId,
        blocking: true,
        details: { day },
      });
    } else {
      indexes.add(index);
    }
  }
  return params.planningDates.filter((date) => {
    const day = weekday(date);
    return day !== null && indexes.has(day);
  });
}

function resolveDates(params: {
  graph: WeeklyPlanningFactGraphV2;
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
    if (params.constraint.dateExpression.startsWith('custom:')) {
      params.issues.push({
        code: 'unsupported_commitment_date_expression',
        temporalConstraintFactId: params.constraint.id,
        taskId: params.constraint.taskId,
        blocking: true,
        details: { expression: params.constraint.dateExpression },
      });
      return [];
    }
    const range = resolveDateExpression(
      params.constraint.dateExpression,
      params.context.currentDate,
    );
    if (!range) {
      params.issues.push({
        code: 'unsupported_commitment_date_expression',
        temporalConstraintFactId: params.constraint.id,
        taskId: params.constraint.taskId,
        blocking: true,
        details: { expression: params.constraint.dateExpression },
      });
      return [];
    }
    const expressionDates = dateRange(range.start, range.end) ?? [];
    dates = dates
      ? dates.filter((date) => expressionDates.includes(date))
      : expressionDates;
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

  const inWindow = dates.filter((date) =>
    date >= params.context.planningStartDate && date <= params.context.planningEndDate);
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
    const nextDate = addDays(date, 1);
    return nextDate ? { date: nextDate, time: endTime } : null;
  }
  return { date, time: endTime };
}

export function resolveWeeklyPlanningTaskCommitments(params: {
  graph: WeeklyPlanningFactGraphV2;
  context: TaskCommitmentResolutionContext;
}): TaskCommitmentResolutionResult {
  const planningDates = dateRange(
    params.context.planningStartDate,
    params.context.planningEndDate,
  );
  if (!planningDates || !parseDate(params.context.currentDate)) {
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
    if (!constraint.startTime
      || !constraint.endTime
      || !CLOCK_PATTERN.test(constraint.startTime)
      || !CLOCK_PATTERN.test(constraint.endTime)
      || constraint.startTime === constraint.endTime) {
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
