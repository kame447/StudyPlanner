import { getRecurrenceWeekday } from '../../../lib/planRecurrence';
import { buildTimetableImportCandidates } from '../../../lib/timetableImport';
import type { Plan, ScheduleTemplate } from '../../../types/domain';
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
  scheduleTemplates: readonly ScheduleTemplate[];
  timetableTermId?: string;
}): MinuteInterval[] {
  return [
    ...hardConstraintIntervals({ input: params.input, dates: params.dates }),
    ...existingPlanIntervals(params.plans, params.dates),
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

  const hardAvailable = params.input.availabilityWindows.filter((window) =>
    window.constraintLevel === 'hard'
    && window.kind === 'available'
    && window.start.date === window.end.date);
  hardAvailable.forEach((window, windowIndex) => {
    const start = minutesFromPlacementTime(window.start.time);
    const end = minutesFromPlacementTime(window.end.time);
    if (end <= start) {
      result.set(window.start.date, []);
      return;
    }
    const clipped = clampPlacementWindowsToNotBefore({
      date: window.start.date,
      windows: [{ start, end }],
      notBefore: params.notBefore,
    });
    const previous = result.get(window.start.date);
    const hasPriorHardWindow = hardAvailable
      .slice(0, windowIndex)
      .some((candidate) => candidate.start.date === window.start.date);
    result.set(
      window.start.date,
      hasPriorHardWindow ? [...(previous ?? []), ...clipped] : clipped,
    );
  });
  for (const [date, windows] of result) {
    result.set(date, windows.sort((left, right) => left.start - right.start));
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
      && window.kind === 'available'
      && window.start.date === window.end.date
      && dateSet.has(window.start.date))
    .forEach((window) => {
      const start = minutesFromPlacementTime(window.start.time);
      const end = minutesFromPlacementTime(window.end.time);
      if (end <= start) return;
      const clipped = clampPlacementWindowsToNotBefore({
        date: window.start.date,
        windows: [{ start, end }],
        notBefore: params.notBefore,
      });
      result.set(window.start.date, [
        ...(result.get(window.start.date) ?? []),
        ...clipped,
      ]);
    });
  for (const [date, windows] of result) {
    result.set(date, windows.sort((left, right) => left.start - right.start));
  }
  return result;
}
