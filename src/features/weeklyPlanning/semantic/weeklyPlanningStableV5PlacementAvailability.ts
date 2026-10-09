import { getRecurrenceWeekday } from '../../../lib/planRecurrence';
import { buildTimetableImportCandidates } from '../../../lib/timetableImport';
import { createScheduleOccurrenceProjection } from '../../../domain/scheduleOccurrence';
import type { MonthEvent, Plan, ScheduleTemplate } from '../../../types/domain';
import type { GenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import type { WeeklyPlanningPlacementNotBeforeV5 } from './weeklyPlanningStableV5PlacementPolicy';

export interface MinuteInterval {
  date: string;
  start: number;
  end: number;
}

export interface PlacementWindow {
  start: number;
  end: number;
}

export const DEFAULT_PLACEMENT_DAY_START = '09:00';
export const DEFAULT_PLACEMENT_DAY_END = '22:00';

const EXISTING_PLAN_BUFFER_MINUTES = 10;
const MINUTES_PER_DAY = 24 * 60;
const PLACEMENT_CLOCK = /^\d{2}:\d{2}$/;

export function minutesFromPlacementTime(time: string): number {
  if (time === '24:00') return MINUTES_PER_DAY;
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

export function placementTimeFromMinutes(value: number): string {
  const minutes = Math.max(0, Math.min(value, MINUTES_PER_DAY));
  if (minutes === MINUTES_PER_DAY) return '24:00';
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function intervalsOverlap(
  left: MinuteInterval,
  right: MinuteInterval,
): boolean {
  return left.date === right.date && left.start < right.end && right.start < left.end;
}

function clipInterval(interval: MinuteInterval): MinuteInterval | null {
  const start = Math.max(0, Math.min(interval.start, MINUTES_PER_DAY));
  const end = Math.max(0, Math.min(interval.end, MINUTES_PER_DAY));
  return end > start ? { ...interval, start, end } : null;
}

function addCrossDateInterval(params: {
  dates: readonly string[];
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  target: MinuteInterval[];
}): void {
  if (params.startDate === params.endDate) {
    if (!params.dates.includes(params.startDate)) return;
    const interval = clipInterval({
      date: params.startDate,
      start: minutesFromPlacementTime(params.startTime),
      end: minutesFromPlacementTime(params.endTime),
    });
    if (interval) params.target.push(interval);
    return;
  }

  params.dates.forEach((date) => {
    if (date < params.startDate || date > params.endDate) return;
    const interval = clipInterval({
      date,
      start: date === params.startDate ? minutesFromPlacementTime(params.startTime) : 0,
      end: date === params.endDate ? minutesFromPlacementTime(params.endTime) : MINUTES_PER_DAY,
    });
    if (interval) params.target.push(interval);
  });
}

function existingPlanIntervals(
  plans: readonly Plan[],
  dates: readonly string[],
): MinuteInterval[] {
  const dateSet = new Set(dates);
  return plans.flatMap((plan) => {
    if (!dateSet.has(plan.date)) return [];
    const interval = clipInterval({
      date: plan.date,
      start: minutesFromPlacementTime(plan.startTime) - EXISTING_PLAN_BUFFER_MINUTES,
      end: minutesFromPlacementTime(plan.endTime) + EXISTING_PLAN_BUFFER_MINUTES,
    });
    return interval ? [interval] : [];
  });
}

/**
 * A persisted MonthEvent is the user's own busy time exactly like a Plan row, independent of whether the
 * reading carries a constraint-source request. Recurrence, multi-day spans and 24:00 come from the shared
 * occurrence projection (`busy ?? true`, owner-checked); a foreign-owner event is ignored, never an error.
 */
function monthEventIntervals(params: {
  ownerId?: string;
  monthEvents?: readonly MonthEvent[];
  dates: readonly string[];
}): MinuteInterval[] {
  if (!params.ownerId || !params.monthEvents?.length || params.dates.length === 0) return [];
  const ownerId = params.ownerId;
  const sorted = [...params.dates].sort();
  const projection = createScheduleOccurrenceProjection({
    ownerId,
    startDate: sorted[0],
    endDate: sorted[sorted.length - 1],
    plans: [],
    monthEvents: params.monthEvents.filter((event) => event.userId === ownerId),
    scheduleTemplates: [],
  });
  const intervals: MinuteInterval[] = [];
  projection.occurrences
    // A date-only event (no clock times) is a zero-length point in the canonical projection, not a block:
    // it is not busy time here (explicit, instead of leaning on NaN arithmetic).
    .filter((occurrence) => occurrence.source.backingKind === 'month-event' && occurrence.busy
      && PLACEMENT_CLOCK.test(occurrence.start.time) && PLACEMENT_CLOCK.test(occurrence.end.time))
    .forEach((occurrence) => addCrossDateInterval({
      dates: params.dates,
      startDate: occurrence.start.date,
      startTime: placementTimeFromMinutes(minutesFromPlacementTime(occurrence.start.time) - EXISTING_PLAN_BUFFER_MINUTES),
      endDate: occurrence.end.date,
      endTime: placementTimeFromMinutes(minutesFromPlacementTime(occurrence.end.time) + EXISTING_PLAN_BUFFER_MINUTES),
      target: intervals,
    }));
  return intervals;
}

function timetableIntervals(params: {
  templates: readonly ScheduleTemplate[];
  termId?: string;
  dates: readonly string[];
}): MinuteInterval[] {
  const termId = params.termId ?? 'default';
  const templates = params.templates.filter(
    (template) => (template.termId || 'default') === termId,
  );
  return params.dates.flatMap((date) =>
    buildTimetableImportCandidates({
      templates,
      date,
      weekday: getRecurrenceWeekday(date),
      termId,
    }).flatMap((candidate) => {
      const interval = clipInterval({
        date,
        start: minutesFromPlacementTime(candidate.startTime) - EXISTING_PLAN_BUFFER_MINUTES,
        end: minutesFromPlacementTime(candidate.endTime) + EXISTING_PLAN_BUFFER_MINUTES,
      });
      return interval ? [interval] : [];
    }),
  );
}

function hardConstraintIntervals(params: {
  input: GenericSchedulerInput;
  dates: readonly string[];
}): MinuteInterval[] {
  const intervals: MinuteInterval[] = [];
  params.input.fixedTaskReservations.forEach((reservation) => addCrossDateInterval({
    dates: params.dates,
    startDate: reservation.start.date,
    startTime: reservation.start.time,
    endDate: reservation.end.date,
    endTime: reservation.end.time,
    target: intervals,
  }));
  params.input.availabilityWindows
    .filter((window) =>
      window.constraintLevel === 'hard'
      && (window.kind === 'occupied' || window.kind === 'unavailable'))
    .forEach((window) => addCrossDateInterval({
      dates: params.dates,
      startDate: window.start.date,
      startTime: window.start.time,
      endDate: window.end.date,
      endTime: window.end.time,
      target: intervals,
    }));
  return intervals;
}

export function buildPlacementBusyIntervals(params: {
  input: GenericSchedulerInput;
  dates: readonly string[];
  plans: readonly Plan[];
  ownerId?: string;
  monthEvents?: readonly MonthEvent[];
  scheduleTemplates: readonly ScheduleTemplate[];
  timetableTermId?: string;
}): MinuteInterval[] {
  return [
    ...hardConstraintIntervals({ input: params.input, dates: params.dates }),
    ...existingPlanIntervals(params.plans, params.dates),
    ...monthEventIntervals({ ownerId: params.ownerId, monthEvents: params.monthEvents, dates: params.dates }),
    ...timetableIntervals({
      templates: params.scheduleTemplates,
      termId: params.timetableTermId,
      dates: params.dates,
    }),
  ];
}

export function clampPlacementWindowsToNotBefore(params: {
  date: string;
  windows: readonly PlacementWindow[];
  notBefore?: WeeklyPlanningPlacementNotBeforeV5;
}): PlacementWindow[] {
  if (!params.notBefore) return params.windows.map((window) => ({ ...window }));
  if (params.date < params.notBefore.date) return [];
  if (params.date > params.notBefore.date) return params.windows.map((window) => ({ ...window }));
  const cutoff = minutesFromPlacementTime(params.notBefore.time);
  return params.windows.flatMap((window) => {
    const start = Math.max(window.start, cutoff);
    return window.end > start ? [{ start, end: window.end }] : [];
  });
}

export function buildPlacementWindowsByDate(params: {
  input: GenericSchedulerInput;
  dates: string[];
  dayStartTime: string;
  dayEndTime: string;
  notBefore?: WeeklyPlanningPlacementNotBeforeV5;
}): Map<string, PlacementWindow[]> {
  const defaultWindow = {
    start: minutesFromPlacementTime(params.dayStartTime),
    end: minutesFromPlacementTime(params.dayEndTime),
  };
  const result = new Map<string, PlacementWindow[]>();
  params.dates.forEach((date) => result.set(date, clampPlacementWindowsToNotBefore({
    date,
    windows: [defaultWindow],
    notBefore: params.notBefore,
  })));

  const hardAvailable = buildHardAvailableWindowsByDate(params);
  for (const [date, windows] of hardAvailable) {
    result.set(date, windows);
  }
  return result;
}

export function buildHardAvailableWindowsByDate(params: {
  input: GenericSchedulerInput;
  dates: readonly string[];
  notBefore?: WeeklyPlanningPlacementNotBeforeV5;
}): Map<string, PlacementWindow[]> {
  const dateSet = new Set(params.dates);
  const result = new Map<string, PlacementWindow[]>();
  params.input.availabilityWindows
    .filter((window) =>
      window.constraintLevel === 'hard'
      && window.kind === 'available')
    .forEach((window) => {
      const intervals: MinuteInterval[] = [];
      addCrossDateInterval({
        dates: params.dates,
        startDate: window.start.date, startTime: window.start.time,
        endDate: window.end.date, endTime: window.end.time,
        target: intervals,
      });
      if (intervals.length === 0 && window.start.date === window.end.date && dateSet.has(window.start.date)) {
        result.set(window.start.date, []);
      }
      for (const interval of intervals) {
        const clipped = clampPlacementWindowsToNotBefore({
          date: interval.date, windows: [{ start: interval.start, end: interval.end }], notBefore: params.notBefore,
        });
        result.set(interval.date, [...(result.get(interval.date) ?? []), ...clipped]);
      }
    });
  for (const [date, windows] of result) {
    result.set(date, windows.sort((left, right) => left.start - right.start));
  }
  return result;
}
