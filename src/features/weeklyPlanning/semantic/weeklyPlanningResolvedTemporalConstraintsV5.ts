import {
  canonicalWeekdayIndex,
  type CalendarDateRange,
  type CalendarWeekStartsOn,
} from './weeklyPlanningCalendarResolver';
import {
  resolvedWeeklyPlanningDateExpressionForFactV5,
  resolveWeeklyPlanningDateExpressionsV5,
  type WeeklyPlanningDateExpressionGraphViewV5,
  type WeeklyPlanningResolvedDateExpressionsV5,
} from './weeklyPlanningResolvedDateExpressionsV5';

export interface WeeklyPlanningTemporalConstraintGraphViewV5
  extends WeeklyPlanningDateExpressionGraphViewV5 {
  readonly workloads: ReadonlyArray<{
    taskId: string;
    componentId: string | null;
  }>;
  readonly temporalConstraints: ReadonlyArray<{
    id: string;
    taskId: string;
    targetFactId: string;
    kind: string;
    constraintLevel?: string;
    dateExpression: string | null;
    namedTimePeriod: string | null;
    startTime: string | null;
    endTime: string | null;
  }>;
}

export interface WeeklyPlanningResolvedHardDateBoundV5 {
  taskId: string;
  targetFactId: string;
  startDate: string | null;
  endDate: string | null;
  sourceFactIds: string[];
}

/** A restriction on existing placements, never a source of available time or occurrences. */
export interface WeeklyPlanningResolvedHardClockBoundV5 {
  taskId: string;
  targetFactId: string;
  sourceFactId: string;
  kind: 'earliest_start' | 'latest_end' | 'deadline';
  minute: number;
  anchorDate: string | null;
}

export type WeeklyPlanningResolvedPreferredDateScopeV5 =
  | { kind: 'all' }
  | { kind: 'range'; startDate: string; endDate: string }
  | { kind: 'weekday'; weekday: number };

export interface WeeklyPlanningResolvedPreferredWindowV5 {
  taskId: string;
  targetFactId: string;
  sourceFactId: string;
  dateScope: WeeklyPlanningResolvedPreferredDateScopeV5;
  window: {
    startMinute: number;
    endMinute: number;
  } | null;
}

export interface WeeklyPlanningResolvedTemporalConstraintsV5 {
  referenceDate: string;
  weekStartsOn: CalendarWeekStartsOn;
  hardDateBounds: WeeklyPlanningResolvedHardDateBoundV5[];
  hardClockBounds: WeeklyPlanningResolvedHardClockBoundV5[];
  preferredWindows: WeeklyPlanningResolvedPreferredWindowV5[];
}

export interface WeeklyPlanningSchedulerHardDateBoundV5 {
  taskId: string;
  targetFactId: string;
  startDate: string | null;
  endDate: string | null;
  sourceFactIds: string[];
}

export interface WeeklyPlanningSchedulerPreferredPlacementV5 {
  taskId: string;
  targetFactId: string;
  dates: string[];
  window: {
    startMinute: number;
    endMinute: number;
  } | null;
  sourceFactId: string;
}

export const WEEKLY_PLANNING_NAMED_TIME_PERIODS_V5: Record<
  string,
  { startTime: string; endTime: string }
> = {
  morning: { startTime: '06:00', endTime: '12:00' },
  afternoon: { startTime: '12:00', endTime: '17:00' },
  evening: { startTime: '17:00', endTime: '21:00' },
  night: { startTime: '21:00', endTime: '24:00' },
  before_sleep: { startTime: '21:00', endTime: '24:00' },
};

function laterDate(left: string | null, right: string): string {
  return left === null || right > left ? right : left;
}

function earlierDate(left: string | null, right: string): string {
  return left === null || right < left ? right : left;
}

export function weeklyPlanningTemporalConstraintAppliesToTargetV5(params: {
  constraintTaskId: string;
  constraintTargetFactId: string;
  taskId: string;
  targetFactId: string;
}): boolean {
  return params.constraintTaskId === params.taskId
    && (
      params.constraintTargetFactId === params.targetFactId
      || params.constraintTargetFactId === params.taskId
    );
}

function schedulerTargets(
  graph: WeeklyPlanningTemporalConstraintGraphViewV5,
): Array<{ taskId: string; targetFactId: string }> {
  const seen = new Set<string>();
  const result: Array<{ taskId: string; targetFactId: string }> = [];
  for (const workload of graph.workloads) {
    const targetFactId = workload.componentId ?? workload.taskId;
    const key = `${workload.taskId}\u0000${targetFactId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ taskId: workload.taskId, targetFactId });
  }
  return result;
}

function resolvedHardConstraintDate(params: {
  constraint: WeeklyPlanningTemporalConstraintGraphViewV5['temporalConstraints'][number];
  resolvedDateExpressions: WeeklyPlanningResolvedDateExpressionsV5;
}): string | null {
  const resolved = resolvedWeeklyPlanningDateExpressionForFactV5({
    resolved: params.resolvedDateExpressions,
    factId: params.constraint.id,
  });
  if (resolved?.status !== 'resolved' || !resolved.range) return null;
  if (params.constraint.kind === 'earliest_start') return resolved.range.start;
  if (
    params.constraint.kind === 'deadline'
    || params.constraint.kind === 'latest_end'
  ) {
    return resolved.range.end;
  }
  return null;
}

function resolveHardDateBounds(params: {
  graph: WeeklyPlanningTemporalConstraintGraphViewV5;
  resolvedDateExpressions: WeeklyPlanningResolvedDateExpressionsV5;
}): WeeklyPlanningResolvedHardDateBoundV5[] {
  return schedulerTargets(params.graph).flatMap((target) => {
    let startDate: string | null = null;
    let endDate: string | null = null;
    const sourceFactIds: string[] = [];
    for (const constraint of params.graph.temporalConstraints) {
      if (
        constraint.constraintLevel !== 'hard'
        || !weeklyPlanningTemporalConstraintAppliesToTargetV5({
          constraintTaskId: constraint.taskId,
          constraintTargetFactId: constraint.targetFactId,
          taskId: target.taskId,
          targetFactId: target.targetFactId,
        })
      ) {
        continue;
      }
      const date = resolvedHardConstraintDate({
        constraint,
        resolvedDateExpressions: params.resolvedDateExpressions,
      });
      if (!date) continue;
      if (constraint.kind === 'earliest_start') {
        startDate = laterDate(startDate, date);
      } else {
        endDate = earlierDate(endDate, date);
      }
      sourceFactIds.push(constraint.id);
    }
    if (startDate === null && endDate === null) return [];
    return [{
      ...target,
      startDate,
      endDate,
      sourceFactIds: [...new Set(sourceFactIds)].sort(),
    }];
  });
}

export function resolveWeeklyPlanningPreferredDateScopeV5(params: {
  constraintId: string;
  expression: string | null;
  resolvedDateExpressions: WeeklyPlanningResolvedDateExpressionsV5;
}): WeeklyPlanningResolvedPreferredDateScopeV5 | null {
  if (!params.expression) return { kind: 'all' };
  const weekday = canonicalWeekdayIndex(params.expression);
  if (weekday !== null) return { kind: 'weekday', weekday };
  if (params.expression.startsWith('custom:')) return null;
  const resolved = resolvedWeeklyPlanningDateExpressionForFactV5({
    resolved: params.resolvedDateExpressions,
    factId: params.constraintId,
  });
  if (resolved?.status !== 'resolved' || !resolved.range) return null;
  return {
    kind: 'range',
    startDate: resolved.range.start,
    endDate: resolved.range.end,
  };
}

function clockMinute(value: string): number | null {
  if (value === '24:00') return 24 * 60;
  const match = /^(?:([01]\d|2[0-3])):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function resolveHardClockBounds(params: {
  graph: WeeklyPlanningTemporalConstraintGraphViewV5;
  resolvedDateExpressions: WeeklyPlanningResolvedDateExpressionsV5;
}): WeeklyPlanningResolvedHardClockBoundV5[] {
  const bounds: WeeklyPlanningResolvedHardClockBoundV5[] = [];
  for (const constraint of params.graph.temporalConstraints) {
    if (constraint.constraintLevel !== 'hard'
      || (constraint.kind !== 'earliest_start'
        && constraint.kind !== 'latest_end' && constraint.kind !== 'deadline')) continue;
    // C2 handles only an explicit one-sided clock. Other accepted shapes remain a documented release gap;
    // do not partially reinterpret a named period or the opposite endpoint as this supported shape.
    if (constraint.namedTimePeriod !== null
      || (constraint.kind === 'earliest_start' ? constraint.endTime !== null : constraint.startTime !== null)) continue;
    const clock = constraint.kind === 'earliest_start' ? constraint.startTime : constraint.endTime;
    if (!clock) continue;
    const minute = clockMinute(clock);
    if (minute === null) continue;
    const anchorDate = resolvedHardConstraintDate({
      constraint, resolvedDateExpressions: params.resolvedDateExpressions,
    });
    // An unresolved supplied date must not become an every-day restriction.
    if (constraint.dateExpression && !anchorDate) continue;
    if (constraint.kind === 'deadline' && !anchorDate) continue;
    // Preserve the accepted target even before work is produced (e.g. a provisional timebox).
    bounds.push({ taskId: constraint.taskId, targetFactId: constraint.targetFactId,
      sourceFactId: constraint.id, kind: constraint.kind, minute, anchorDate });
  }
  return bounds;
}

/** Re-apply existing interpretations to current scheduler targets; never resolve calendar expressions here. */
export function materializeWeeklyPlanningHardTemporalBoundsV5(params: {
  graph: WeeklyPlanningTemporalConstraintGraphViewV5;
  resolvedDateExpressions: WeeklyPlanningResolvedDateExpressionsV5;
}): Pick<WeeklyPlanningResolvedTemporalConstraintsV5, 'hardDateBounds' | 'hardClockBounds'> {
  return {
    hardDateBounds: resolveHardDateBounds(params),
    hardClockBounds: resolveHardClockBounds(params),
  };
}

/** Resolve the typed time independently of whether schedulable work exists yet. */
export function resolveWeeklyPlanningPreferredTimeWindowV5(params: {
  constraint: WeeklyPlanningTemporalConstraintGraphViewV5['temporalConstraints'][number];
  namedTimePeriods?: Partial<Record<string, { startTime: string; endTime: string }>>;
}): WeeklyPlanningResolvedPreferredWindowV5['window'] | undefined {
  let startTime: string | null = null;
  let endTime: string | null = null;
  if (params.constraint.startTime || params.constraint.endTime) {
    // Typed one-sided bounds cover the rest of that day, as availability does.
    startTime = params.constraint.startTime ?? '00:00';
    endTime = params.constraint.endTime ?? '24:00';
  } else if (params.constraint.namedTimePeriod) {
    const named = (params.namedTimePeriods ?? WEEKLY_PLANNING_NAMED_TIME_PERIODS_V5)[params.constraint.namedTimePeriod];
    if (!named) return undefined;
    startTime = named.startTime;
    endTime = named.endTime;
  } else {
    return null;
  }

  const startMinute = clockMinute(startTime);
  const endMinute = clockMinute(endTime);
  if (startMinute === null || endMinute === null || endMinute <= startMinute) {
    return undefined;
  }
  return { startMinute, endMinute };
}

function resolvePreferredWindows(params: {
  graph: WeeklyPlanningTemporalConstraintGraphViewV5;
  resolvedDateExpressions: WeeklyPlanningResolvedDateExpressionsV5;
  namedTimePeriods: Partial<Record<string, { startTime: string; endTime: string }>>;
}): WeeklyPlanningResolvedPreferredWindowV5[] {
  const result: WeeklyPlanningResolvedPreferredWindowV5[] = [];
  for (const target of schedulerTargets(params.graph)) {
    for (const constraint of params.graph.temporalConstraints) {
      if (
        constraint.kind !== 'preferred_window'
        || !weeklyPlanningTemporalConstraintAppliesToTargetV5({
          constraintTaskId: constraint.taskId,
          constraintTargetFactId: constraint.targetFactId,
          taskId: target.taskId,
          targetFactId: target.targetFactId,
        })
      ) {
        continue;
      }
      const dateScope = resolveWeeklyPlanningPreferredDateScopeV5({
        constraintId: constraint.id,
        expression: constraint.dateExpression,
        resolvedDateExpressions: params.resolvedDateExpressions,
      });
      if (!dateScope) continue;
      const window = resolveWeeklyPlanningPreferredTimeWindowV5({
        constraint,
        namedTimePeriods: params.namedTimePeriods,
      });
      if (window === undefined) continue;
      result.push({
        ...target,
        sourceFactId: constraint.id,
        dateScope,
        window,
      });
    }
  }
  return result;
}

export function resolveWeeklyPlanningTemporalConstraintsV5(params: {
  graph: WeeklyPlanningTemporalConstraintGraphViewV5;
  currentDate: string;
  weekStartsOn?: CalendarWeekStartsOn;
  namedTimePeriods?: Partial<Record<string, { startTime: string; endTime: string }>>;
  resolvedDateExpressions?: WeeklyPlanningResolvedDateExpressionsV5;
}): WeeklyPlanningResolvedTemporalConstraintsV5 {
  const resolvedDateExpressions = params.resolvedDateExpressions
    ?? resolveWeeklyPlanningDateExpressionsV5({
      graph: params.graph,
      currentDate: params.currentDate,
      weekStartsOn: params.weekStartsOn,
    });
  const namedTimePeriods = params.namedTimePeriods ?? WEEKLY_PLANNING_NAMED_TIME_PERIODS_V5;
  return {
    referenceDate: resolvedDateExpressions.referenceDate,
    weekStartsOn: resolvedDateExpressions.weekStartsOn,
    ...materializeWeeklyPlanningHardTemporalBoundsV5({ graph: params.graph, resolvedDateExpressions }),
    preferredWindows: resolvePreferredWindows({
      graph: params.graph,
      resolvedDateExpressions,
      namedTimePeriods,
    }),
  };
}

function inResolvedDateScope(
  date: string,
  scope: WeeklyPlanningResolvedPreferredDateScopeV5,
): boolean {
  if (scope.kind === 'all') return true;
  if (scope.kind === 'range') {
    return date >= scope.startDate && date <= scope.endDate;
  }
  const dateValue = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(dateValue.getTime()) && dateValue.getUTCDay() === scope.weekday;
}

export function materializeWeeklyPlanningPreferredDatesV5(params: {
  dateScope: WeeklyPlanningResolvedPreferredDateScopeV5;
  dates: readonly string[];
}): string[] {
  return params.dates.filter((date) => inResolvedDateScope(date, params.dateScope));
}

export function materializeWeeklyPlanningSchedulerPreferredPlacementsV5(params: {
  resolved: WeeklyPlanningResolvedTemporalConstraintsV5;
  dates: readonly string[];
}): WeeklyPlanningSchedulerPreferredPlacementV5[] {
  return params.resolved.preferredWindows.flatMap((preferred) => {
    const dates = materializeWeeklyPlanningPreferredDatesV5({
      dates: params.dates, dateScope: preferred.dateScope,
    });
    if (dates.length === 0) return [];
    return [{
      taskId: preferred.taskId,
      targetFactId: preferred.targetFactId,
      dates,
      window: preferred.window,
      sourceFactId: preferred.sourceFactId,
    }];
  });
}

export function hardDateBoundForTargetV5(params: {
  bounds: readonly WeeklyPlanningSchedulerHardDateBoundV5[];
  taskId: string;
  targetFactId: string;
}): WeeklyPlanningSchedulerHardDateBoundV5 | undefined {
  return params.bounds.find((bound) =>
    bound.taskId === params.taskId && bound.targetFactId === params.targetFactId);
}

export function filterWeeklyPlanningDatesByHardBoundV5(params: {
  dates: readonly string[];
  bound: Pick<WeeklyPlanningSchedulerHardDateBoundV5, 'startDate' | 'endDate'> | undefined;
}): string[] {
  if (!params.bound) return [...params.dates];
  return params.dates.filter((date) =>
    (!params.bound?.startDate || date >= params.bound.startDate)
    && (!params.bound?.endDate || date <= params.bound.endDate));
}

export function resolvedHardDateRangeForTargetV5(params: {
  resolved: WeeklyPlanningResolvedTemporalConstraintsV5;
  taskId: string;
  targetFactId: string;
}): CalendarDateRange | null {
  const bound = hardDateBoundForTargetV5({
    bounds: params.resolved.hardDateBounds,
    taskId: params.taskId,
    targetFactId: params.targetFactId,
  });
  if (!bound?.startDate || !bound.endDate) return null;
  return { start: bound.startDate, end: bound.endDate };
}
