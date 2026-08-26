import type {
  WeeklyPlanningGroundingRecord,
} from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningWeekStartsOn } from '../personalization/weeklyPlanningWeek';
import {
  addCalendarDays,
  isValidCalendarDate,
  resolveCanonicalDateExpression,
} from '../semantic/weeklyPlanningCalendarResolver';
import type { GenericSchedulerInputContext } from '../semantic/weeklyPlanningGenericSchedulerInput';
import {
  resolveWeeklyPlanningRecurringDateBoundsV5,
  type WeeklyPlanningRecurringDateBoundsGraphViewV5,
} from '../semantic/weeklyPlanningRecurringDateBoundsV5';

const DEFAULT_PLANNING_DAY_COUNT = 7;

export interface WeeklyPlanningTurnRequestContext {
  startedAtIso: string;
  timeZone: string;
  currentDate: string;
  currentTime: string;
  notBeforeDate: string;
  notBeforeTime: string;
  weekStartsOn: WeeklyPlanningWeekStartsOn;
}

export interface WeeklyPlanningTemporalGraphView {
  planningWindows: ReadonlyArray<{
    id: string;
    value: string;
    start: string | null;
    end: string | null;
  }>;
  factLifecycles: ReadonlyArray<{
    factId: string;
    status: string;
  }>;
  workloads?: WeeklyPlanningRecurringDateBoundsGraphViewV5['workloads'];
  recurrences?: WeeklyPlanningRecurringDateBoundsGraphViewV5['recurrences'];
  temporalConstraints?: WeeklyPlanningRecurringDateBoundsGraphViewV5['temporalConstraints'];
}

interface ZonedClockParts {
  date: string;
  time: string;
  hour: number;
  minute: number;
  second: number;
}

function zonedClockParts(date: Date, timeZone: string): ZonedClockParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  const year = value('year');
  const month = value('month');
  const day = value('day');
  const hour = value('hour');
  const minute = value('minute');
  const second = value('second');
  return {
    date: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    hour,
    minute,
    second,
  };
}

function notBeforeTime(params: {
  clock: ZonedClockParts;
  hasSubsecond: boolean;
}): string {
  const mustCeil = params.clock.second > 0 || params.hasSubsecond;
  const minuteOfDay = params.clock.hour * 60 + params.clock.minute + (mustCeil ? 1 : 0);
  if (minuteOfDay >= 24 * 60) return '24:00';
  return `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
}

export function createWeeklyPlanningTurnRequestContext(params: {
  startedAtIso: string;
  timeZone: string;
  weekStartsOn: WeeklyPlanningWeekStartsOn;
}): WeeklyPlanningTurnRequestContext {
  const instant = new Date(params.startedAtIso);
  if (!Number.isFinite(instant.getTime())) {
    throw new Error('Invalid weekly planning request timestamp.');
  }
  const clock = zonedClockParts(instant, params.timeZone);
  return {
    startedAtIso: instant.toISOString(),
    timeZone: params.timeZone,
    currentDate: clock.date,
    currentTime: clock.time,
    notBeforeDate: clock.date,
    notBeforeTime: notBeforeTime({
      clock,
      hasSubsecond: instant.getUTCMilliseconds() > 0,
    }),
    weekStartsOn: params.weekStartsOn,
  };
}

/**
 * Compatibility-only context for direct runtime callers that predate request-clock capture.
 * Production application turns must provide createWeeklyPlanningTurnRequestContext instead.
 */
export function createWeeklyPlanningLegacyRequestContext(params: {
  selectedDate: string;
  timeZone: string;
  weekStartsOn: WeeklyPlanningWeekStartsOn;
}): WeeklyPlanningTurnRequestContext {
  if (!isValidCalendarDate(params.selectedDate)) {
    throw new Error('Invalid weekly planning legacy selected date.');
  }
  return {
    startedAtIso: `${params.selectedDate}T00:00:00.000Z`,
    timeZone: params.timeZone,
    currentDate: params.selectedDate,
    currentTime: '00:00',
    notBeforeDate: params.selectedDate,
    notBeforeTime: '00:00',
    weekStartsOn: params.weekStartsOn,
  };
}

function activeFacts<T extends { id: string }>(
  graph: WeeklyPlanningTemporalGraphView,
  facts: readonly T[],
): T[] {
  if (graph.factLifecycles.length === 0) return [...facts];
  const activeIds = new Set(
    graph.factLifecycles
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.factId),
  );
  return facts.filter((fact) => activeIds.has(fact.id));
}

function activePlanningWindows(graph: WeeklyPlanningTemporalGraphView) {
  return activeFacts(graph, graph.planningWindows);
}

function recurringDateBoundsGraph(
  graph: WeeklyPlanningTemporalGraphView,
): WeeklyPlanningRecurringDateBoundsGraphViewV5 {
  return {
    workloads: activeFacts(graph, graph.workloads ?? []),
    recurrences: activeFacts(graph, graph.recurrences ?? []),
    temporalConstraints: activeFacts(graph, graph.temporalConstraints ?? []),
  };
}

function fallbackPlanningHorizon(params: {
  graph: WeeklyPlanningTemporalGraphView;
  selectedDate: string;
  requestContext: WeeklyPlanningTurnRequestContext;
}): { startDate: string; endDate: string } | null {
  const defaultEndDate = addCalendarDays(
    params.selectedDate,
    DEFAULT_PLANNING_DAY_COUNT - 1,
  );
  if (!defaultEndDate) return null;

  let endDate = defaultEndDate;
  const recurringBounds = resolveWeeklyPlanningRecurringDateBoundsV5({
    graph: recurringDateBoundsGraph(params.graph),
    currentDate: params.requestContext.currentDate,
    weekStartsOn: params.requestContext.weekStartsOn,
  });
  for (const bound of recurringBounds) {
    if (bound.endDate && bound.endDate > endDate) {
      endDate = bound.endDate;
      continue;
    }
    if (!bound.endDate && bound.startDate && bound.startDate > params.selectedDate) {
      const recurringDefaultEnd = addCalendarDays(
        bound.startDate,
        DEFAULT_PLANNING_DAY_COUNT - 1,
      );
      if (recurringDefaultEnd && recurringDefaultEnd > endDate) {
        endDate = recurringDefaultEnd;
      }
    }
  }
  return { startDate: params.selectedDate, endDate };
}

function frozenGroundingRange(params: {
  windowId: string;
  groundingRecords?: readonly WeeklyPlanningGroundingRecord[];
}): { startDate: string; endDate: string } | null {
  const record = [...(params.groundingRecords ?? [])]
    .reverse()
    .find((candidate) =>
      candidate.targetFactId === params.windowId
      && candidate.status !== 'rejected'
      && isValidCalendarDate(candidate.startDate)
      && isValidCalendarDate(candidate.endDate)
      && candidate.startDate <= candidate.endDate);
  return record
    ? { startDate: record.startDate, endDate: record.endDate }
    : null;
}

export function resolveWeeklyPlanningPlanningHorizon(params: {
  graph: WeeklyPlanningTemporalGraphView;
  selectedDate: string;
  requestContext: WeeklyPlanningTurnRequestContext;
  groundingRecords?: readonly WeeklyPlanningGroundingRecord[];
}): { startDate: string; endDate: string } | null {
  const windows = activePlanningWindows(params.graph);
  if (windows.length > 1) return null;
  if (windows.length === 0) {
    return fallbackPlanningHorizon(params);
  }

  const window = windows[0];
  if (window.start && window.end) {
    if (
      isValidCalendarDate(window.start)
      && isValidCalendarDate(window.end)
      && window.start <= window.end
    ) {
      return { startDate: window.start, endDate: window.end };
    }
    return null;
  }

  const frozen = frozenGroundingRange({
    windowId: window.id,
    groundingRecords: params.groundingRecords,
  });
  if (frozen) return frozen;

  const resolution = resolveCanonicalDateExpression({
    expression: window.value.trim(),
    currentDate: params.requestContext.currentDate,
    weekStartsOn: params.requestContext.weekStartsOn,
  });
  return resolution.status === 'resolved'
    ? { startDate: resolution.range.start, endDate: resolution.range.end }
    : null;
}

export function createWeeklyPlanningSchedulerContext(params: {
  ownerId: string;
  horizon: { startDate: string; endDate: string } | null;
  requestContext: WeeklyPlanningTurnRequestContext;
}): GenericSchedulerInputContext {
  return {
    ownerId: params.ownerId,
    currentDate: params.requestContext.currentDate,
    weekStartsOn: params.requestContext.weekStartsOn,
    planningStartDate: params.horizon?.startDate ?? '',
    planningEndDate: params.horizon?.endDate ?? '',
    timeZone: params.requestContext.timeZone,
    namedTimePeriods: {
      morning: { startTime: '06:00', endTime: '12:00' },
      afternoon: { startTime: '12:00', endTime: '17:00' },
      evening: { startTime: '17:00', endTime: '21:00' },
      night: { startTime: '21:00', endTime: '24:00' },
      before_sleep: { startTime: '21:00', endTime: '24:00' },
    },
  };
}
