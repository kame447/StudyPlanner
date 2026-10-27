import type { GenericPlanningWorkItem } from './weeklyPlanningGenericWorkItems';
import type {
  WeeklyPlanningSchedulerPreferredPlacementV5,
} from './weeklyPlanningResolvedTemporalConstraintsV5';
import {
  WEEKLY_PLANNING_NAMED_TIME_PERIODS_V5,
} from './weeklyPlanningResolvedTemporalConstraintsV5';
import {
  clampPlacementWindowsToNotBefore,
  intervalsOverlap,
  minutesFromPlacementTime,
  type MinuteInterval,
  type PlacementWindow,
} from './weeklyPlanningStableV5PlacementAvailability';
import {
  leavesTinyWindowFragmentV5,
  type WeeklyPlanningPlacementNotBeforeV5,
} from './weeklyPlanningStableV5PlacementPolicy';

export interface PreferredPlacement {
  dates: string[];
  window: PlacementWindow | null;
}

const MIN_USEFUL_FRAGMENT_MINUTES = 30;

export function preferredPlacementsForWorkItem(params: {
  placements: readonly WeeklyPlanningSchedulerPreferredPlacementV5[];
  item: GenericPlanningWorkItem;
  dates: string[];
}): PreferredPlacement[] {
  const targetFactId = params.item.componentId ?? params.item.taskId;
  const allowedDates = new Set(params.dates);
  return params.placements
    .filter((placement) =>
      placement.taskId === params.item.taskId
      && placement.targetFactId === targetFactId)
    .flatMap((placement) => {
      const dates = placement.dates.filter((date) => allowedDates.has(date));
      if (dates.length === 0) return [];
      return [{
        dates,
        window: placement.window
          ? {
              start: placement.window.startMinute,
              end: placement.window.endMinute,
            }
          : null,
      }];
    });
}

export function preferredNamedTimePeriodPlacementV5(params: {
  dates: string[];
  namedTimePeriod: string;
  namedTimePeriods?: Partial<Record<string, { startTime: string; endTime: string }>>;
}): PreferredPlacement[] {
  const periods = params.namedTimePeriods ?? WEEKLY_PLANNING_NAMED_TIME_PERIODS_V5;
  const resolved = periods[params.namedTimePeriod];
  if (!resolved || params.dates.length === 0) return [];
  const window = {
    start: minutesFromPlacementTime(resolved.startTime),
    end: minutesFromPlacementTime(resolved.endTime),
  };
  if (window.end <= window.start) return [];
  return [{ dates: [...params.dates], window }];
}

function nextBusyAfter(params: {
  date: string;
  after: number;
  before: number;
  busy: readonly MinuteInterval[];
}): MinuteInterval | undefined {
  return params.busy
    .filter((interval) =>
      interval.date === params.date
      && interval.start >= params.after
      && interval.start < params.before)
    .sort((left, right) => left.start - right.start)[0];
}

function slotInWindow(params: {
  date: string;
  window: PlacementWindow;
  duration: number;
  busy: MinuteInterval[];
  breakMinutes: number;
  avoidTinyFragments: boolean;
}): MinuteInterval | null {
  let cursor = params.window.start;
  const conflicts = params.busy
    .filter((interval) => interval.date === params.date)
    .sort((left, right) => left.start - right.start);

  while (cursor + params.duration <= params.window.end) {
    const candidate = {
      date: params.date,
      start: cursor,
      end: cursor + params.duration,
    };
    const conflict = conflicts.find((interval) => intervalsOverlap(candidate, interval));
    if (conflict) {
      cursor = Math.max(cursor + 1, conflict.end + params.breakMinutes);
      continue;
    }

    const nextBusy = nextBusyAfter({
      date: params.date,
      after: candidate.end,
      before: params.window.end,
      busy: conflicts,
    });
    const freeEnd = nextBusy?.start ?? params.window.end;
    if (
      params.avoidTinyFragments
      && leavesTinyWindowFragmentV5({
        windowStart: cursor,
        windowEnd: freeEnd,
        candidateStart: cursor,
        durationMinutes: params.duration,
        minimumUsefulFragmentMinutes: MIN_USEFUL_FRAGMENT_MINUTES,
      })
    ) {
      const shiftedStart = freeEnd - params.duration;
      const before = shiftedStart - cursor;
      if (shiftedStart >= cursor && (before === 0 || before >= MIN_USEFUL_FRAGMENT_MINUTES)) {
        return { date: params.date, start: shiftedStart, end: freeEnd };
      }
      if (nextBusy) {
        cursor = Math.max(cursor + 1, nextBusy.end + params.breakMinutes);
        continue;
      }
      return null;
    }
    return candidate;
  }
  return null;
}

export function findPlacementSlot(params: {
  dates: string[];
  duration: number;
  windowsByDate: Map<string, PlacementWindow[]>;
  busy: MinuteInterval[];
  breakMinutes: number;
  notBefore?: WeeklyPlanningPlacementNotBeforeV5;
  preferLongSegment?: boolean;
}): MinuteInterval | null {
  for (const avoidTinyFragments of [true, false]) {
    for (const date of params.dates) {
      const windows = clampPlacementWindowsToNotBefore({
        date,
        windows: params.windowsByDate.get(date) ?? [],
        notBefore: params.notBefore,
      });
      const orderedWindows = params.preferLongSegment
        ? [...windows].sort((left, right) =>
            (right.end - right.start) - (left.end - left.start) || left.start - right.start)
        : windows;
      for (const window of orderedWindows) {
        const slot = slotInWindow({
          date,
          window,
          duration: params.duration,
          busy: params.busy,
          breakMinutes: params.breakMinutes,
          avoidTinyFragments,
        });
        if (slot) return slot;
      }
    }
  }
  return null;
}

function intersectPlacementWindows(
  bases: readonly PlacementWindow[],
  preferred: PlacementWindow,
): PlacementWindow[] {
  return bases.flatMap((base) => {
    const start = Math.max(base.start, preferred.start);
    const end = Math.min(base.end, preferred.end);
    return end > start ? [{ start, end }] : [];
  });
}

export function preferredPlacementWindows(params: {
  placement: PreferredPlacement;
  date: string;
  windowsByDate: Map<string, PlacementWindow[]>;
  hardAvailableByDate: Map<string, PlacementWindow[]>;
  notBefore?: WeeklyPlanningPlacementNotBeforeV5;
  restrictToBaseWindows?: boolean;
}): PlacementWindow[] {
  const baseWindows = clampPlacementWindowsToNotBefore({
    date: params.date, windows: params.windowsByDate.get(params.date) ?? [], notBefore: params.notBefore,
  });
  const hardAvailable = params.hardAvailableByDate.get(params.date);
  if (!params.placement.window) return hardAvailable ?? baseWindows;
  const preferred = clampPlacementWindowsToNotBefore({
    date: params.date, windows: [params.placement.window], notBefore: params.notBefore,
  });
  const restriction = params.restrictToBaseWindows ? baseWindows : hardAvailable;
  return restriction === undefined
    ? preferred
    : preferred.flatMap((window) => intersectPlacementWindows(restriction, window));
}

/** Enumerate the same free windows used by slot search, without reserving any time. */
export function freePlacementSegments(params: {
  dates: readonly string[];
  windowsByDate: Map<string, PlacementWindow[]>;
  busy: readonly MinuteInterval[];
  breakMinutes: number;
  notBefore?: WeeklyPlanningPlacementNotBeforeV5;
}): MinuteInterval[] {
  return params.dates.flatMap((date) => {
    const windows = clampPlacementWindowsToNotBefore({
      date, windows: params.windowsByDate.get(date) ?? [], notBefore: params.notBefore,
    }).sort((left, right) => left.start - right.start || left.end - right.end);
    // Preference and base windows may overlap; they describe one supply of time.
    const merged: PlacementWindow[] = [];
    for (const window of windows) {
      const previous = merged[merged.length - 1];
      if (previous && window.start <= previous.end) previous.end = Math.max(previous.end, window.end);
      else merged.push({ ...window });
    }
    const conflicts = params.busy.filter((interval) => interval.date === date)
      .sort((left, right) => left.start - right.start);
    return merged.flatMap((window) => {
      const free: MinuteInterval[] = [];
      let cursor = window.start;
      for (const conflict of conflicts) {
        // The break follows busy time even when the window itself starts inside it.
        if (conflict.end + params.breakMinutes <= cursor) continue;
        if (conflict.start >= window.end) break;
        if (conflict.start > cursor) free.push({ date, start: cursor, end: conflict.start });
        cursor = Math.max(cursor, conflict.end + params.breakMinutes);
        if (cursor >= window.end) break;
      }
      if (cursor < window.end) free.push({ date, start: cursor, end: window.end });
      return free;
    });
  });
}

export function findPreferredPlacementSlot(params: {
  placements: PreferredPlacement[];
  duration: number;
  windowsByDate: Map<string, PlacementWindow[]>;
  hardAvailableByDate: Map<string, PlacementWindow[]>;
  busy: MinuteInterval[];
  breakMinutes: number;
  notBefore?: WeeklyPlanningPlacementNotBeforeV5;
  preferLongSegment?: boolean;
  restrictToBaseWindows?: boolean;
}): MinuteInterval | null {
  for (const placement of params.placements) {
    for (const date of placement.dates) {
      if (params.notBefore && date < params.notBefore.date) continue;
      const windows = preferredPlacementWindows({ ...params, placement, date });
      const slot = findPlacementSlot({
        dates: [date],
        duration: params.duration,
        windowsByDate: new Map([[date, windows]]),
        busy: params.busy,
        breakMinutes: params.breakMinutes,
        notBefore: params.notBefore,
        preferLongSegment: params.preferLongSegment,
      });
      if (slot) return slot;
    }
  }
  return null;
}
