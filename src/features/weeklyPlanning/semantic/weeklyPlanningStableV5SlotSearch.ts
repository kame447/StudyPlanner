import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import type { GenericPlanningWorkItem } from './weeklyPlanningGenericWorkItems';
import {
  calendarWeekday,
  canonicalWeekdayIndex,
  resolveCanonicalDateExpression,
} from './weeklyPlanningCalendarResolver';
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
const DEFAULT_NAMED_TIME_PERIODS: Record<string, { startTime: string; endTime: string }> = {
  morning: { startTime: '06:00', endTime: '12:00' },
  afternoon: { startTime: '12:00', endTime: '17:00' },
  evening: { startTime: '17:00', endTime: '21:00' },
  night: { startTime: '21:00', endTime: '24:00' },
  before_sleep: { startTime: '21:00', endTime: '24:00' },
};

function datesForExpression(params: {
  expression: string | null;
  dates: string[];
}): string[] | null {
  if (!params.expression) return [...params.dates];
  const weekdayIndex = canonicalWeekdayIndex(params.expression);
  if (weekdayIndex !== null) {
    return params.dates.filter((date) => calendarWeekday(date) === weekdayIndex);
  }
  if (params.expression.startsWith('custom:')) return null;
  const resolved = resolveCanonicalDateExpression({
    expression: params.expression,
    currentDate: params.dates[0] ?? '',
  });
  if (resolved.status !== 'resolved') return null;
  return params.dates.filter(
    (date) => date >= resolved.range.start && date <= resolved.range.end,
  );
}

export function preferredPlacementsForWorkItem(params: {
  graph: WeeklyPlanningFactGraphV5;
  item: GenericPlanningWorkItem;
  dates: string[];
  namedTimePeriods?: Partial<Record<string, { startTime: string; endTime: string }>>;
}): PreferredPlacement[] {
  const activeIds = new Set(
    params.graph.factLifecycles
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.factId),
  );
  const namedTimePeriods = params.namedTimePeriods ?? DEFAULT_NAMED_TIME_PERIODS;
  return params.graph.temporalConstraints
    .filter((constraint) =>
      activeIds.has(constraint.id)
      && constraint.taskId === params.item.taskId
      && constraint.kind === 'preferred_window')
    .flatMap((constraint) => {
      const dates = datesForExpression({
        expression: constraint.dateExpression,
        dates: params.dates,
      });
      if (!dates || dates.length === 0) return [];
      let window: PlacementWindow | null = null;
      if (constraint.startTime && constraint.endTime) {
        window = {
          start: minutesFromPlacementTime(constraint.startTime),
          end: minutesFromPlacementTime(constraint.endTime),
        };
      } else if (constraint.namedTimePeriod) {
        const resolved = namedTimePeriods[constraint.namedTimePeriod];
        if (!resolved) return [];
        window = {
          start: minutesFromPlacementTime(resolved.startTime),
          end: minutesFromPlacementTime(resolved.endTime),
        };
      }
      if (window && window.end <= window.start) return [];
      return [{ dates, window }];
    });
}

export function preferredNamedTimePeriodPlacementV5(params: {
  dates: string[];
  namedTimePeriod: string;
  namedTimePeriods?: Partial<Record<string, { startTime: string; endTime: string }>>;
}): PreferredPlacement[] {
  const periods = params.namedTimePeriods ?? DEFAULT_NAMED_TIME_PERIODS;
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

export function findPreferredPlacementSlot(params: {
  placements: PreferredPlacement[];
  duration: number;
  windowsByDate: Map<string, PlacementWindow[]>;
  hardAvailableByDate: Map<string, PlacementWindow[]>;
  busy: MinuteInterval[];
  breakMinutes: number;
  notBefore?: WeeklyPlanningPlacementNotBeforeV5;
  preferLongSegment?: boolean;
}): MinuteInterval | null {
  for (const placement of params.placements) {
    for (const date of placement.dates) {
      if (params.notBefore && date < params.notBefore.date) continue;
      const baseWindows = clampPlacementWindowsToNotBefore({
        date,
        windows: params.windowsByDate.get(date) ?? [],
        notBefore: params.notBefore,
      });
      const windows = placement.window
        ? clampPlacementWindowsToNotBefore({
            date,
            windows: [placement.window],
            notBefore: params.notBefore,
          }).flatMap((preferred) => intersectPlacementWindows(baseWindows, preferred))
        : baseWindows;
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
