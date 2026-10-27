import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';
import type { GenericPlanningWorkItem } from './weeklyPlanningGenericWorkItems';
import type { GenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import type { WeeklyPlanningPlacementGraphViewV5 } from './weeklyPlanningPlacementGraphViewV5';
import {
  hardDateBoundForTargetV5,
  weeklyPlanningTemporalConstraintAppliesToTargetV5,
} from './weeklyPlanningResolvedTemporalConstraintsV5';
import {
  preferredTaskDistributedDateV5,
} from './weeklyPlanningStableV5DistributionPolicy';
import { isHeavyWeeklyPlanningWorkItemV5 } from './weeklyPlanningStableV5ExecutionPolicy';
import type { MinuteInterval, PlacementWindow } from './weeklyPlanningStableV5PlacementAvailability';
import {
  addPlacedSlot,
  createPlacementCandidate,
  placementCandidateBlocks,
} from './weeklyPlanningStableV5PlacementCandidates';
import {
  laterNotBeforeV5,
  orderPlacementDatesV5,
  relationNotBeforeV5,
  type WeeklyPlanningPlacementNotBeforeV5,
} from './weeklyPlanningStableV5PlacementPolicy';
import {
  findPlacementSlot,
  findPreferredPlacementSlot,
  freePlacementSegments,
  preferredPlacementWindows,
  preferredPlacementsForWorkItem,
} from './weeklyPlanningStableV5SlotSearch';
import { WEEKLY_PLANNING_STABLE_V5_SESSION_QUANTUM_MINUTES } from './weeklyPlanningStableV5ExecutionPolicy';

export interface WeeklyPlanningPlacementRuntimeContextV5 {
  input: GenericSchedulerInput;
  graph: WeeklyPlanningPlacementGraphViewV5;
  dates: string[];
  windowsByDate: Map<string, PlacementWindow[]>;
  hardAvailableByDate: Map<string, PlacementWindow[]>;
  busy: MinuteInterval[];
  dayLoads: Map<string, number>;
  breakMinutes: number;
  totalMovableMinutes: number;
  namedTimePeriods?: Partial<Record<string, { startTime: string; endTime: string }>>;
}

const MIN_USEFUL_FRAGMENT_MINUTES = 30;

function eligibleDates(params: {
  input: GenericSchedulerInput;
  item: GenericPlanningWorkItem;
  dates: readonly string[];
}): string[] {
  const eligibility = params.input.taskDateEligibilities.find(
    (entry) => entry.taskId === params.item.taskId,
  );
  const allowed = eligibility?.allowedDates === null || eligibility === undefined
    ? [...params.dates]
    : eligibility.allowedDates;
  const excluded = new Set(eligibility?.excludedDates ?? []);
  const targetFactId = params.item.componentId ?? params.item.taskId;
  const hardDateBound = hardDateBoundForTargetV5({
    bounds: params.input.hardDateBounds ?? [],
    taskId: params.item.taskId,
    targetFactId,
  });
  return allowed.filter((date) =>
    params.dates.includes(date)
    && !excluded.has(date)
    && (!params.item.requiredDate || date === params.item.requiredDate)
    && (!hardDateBound?.startDate || date >= hardDateBound.startDate)
    && (!hardDateBound?.endDate || date <= hardDateBound.endDate));
}

function datesWithinDailyCapacity(params: {
  context: WeeklyPlanningPlacementRuntimeContextV5;
  dates: readonly string[];
  duration: number;
}): string[] {
  const limits = new Map(
    (params.context.input.dailyCapacityLimits ?? []).map((limit) => [limit.date, limit.maxMinutes]),
  );
  return params.dates.filter((date) => {
    const maxMinutes = limits.get(date);
    if (maxMinutes === undefined) return true;
    return (params.context.dayLoads.get(date) ?? 0) + params.duration <= maxMinutes;
  });
}

function workItemClockWindows(params: {
  context: WeeklyPlanningPlacementRuntimeContextV5;
  item: GenericPlanningWorkItem;
  dates: readonly string[];
}): Pick<WeeklyPlanningPlacementRuntimeContextV5, 'windowsByDate' | 'hardAvailableByDate'> & {
  dateOnlyHardAvailableByDate: Map<string, PlacementWindow[]>;
} {
  const bounds = (params.context.input.hardClockBounds ?? []).filter((bound) =>
    weeklyPlanningTemporalConstraintAppliesToTargetV5({
      constraintTaskId: bound.taskId, constraintTargetFactId: bound.targetFactId,
      taskId: params.item.taskId, targetFactId: params.item.componentId ?? params.item.taskId,
    }));
  if (bounds.length === 0) return {
    windowsByDate: params.context.windowsByDate, hardAvailableByDate: params.context.hardAvailableByDate,
    dateOnlyHardAvailableByDate: params.context.hardAvailableByDate,
  };
  const windowsByDate = new Map(params.context.windowsByDate);
  const hardAvailableByDate = new Map(params.context.hardAvailableByDate);
  const dateOnlyHardAvailableByDate = new Map(params.context.hardAvailableByDate);
  for (const date of params.dates) {
    const applicable = bounds.filter((bound) => bound.anchorDate === null || bound.anchorDate === date);
    if (applicable.length === 0) continue;
    let lower = 0;
    let upper = 24 * 60;
    for (const bound of applicable) {
      if (bound.kind === 'earliest_start') lower = Math.max(lower, bound.minute);
      else upper = Math.min(upper, bound.minute);
    }
    const intersect = (windows: readonly PlacementWindow[]): PlacementWindow[] => windows.flatMap((window) => {
      const start = Math.max(window.start, lower);
      const end = Math.min(window.end, upper);
      return end > start ? [{ start, end }] : [];
    });
    windowsByDate.set(date, intersect(params.context.windowsByDate.get(date) ?? []));
    // An empty entry is a hard prohibition. Absence means no global hard availability.
    const originalHard = params.context.hardAvailableByDate.get(date);
    const hardWindows = intersect(originalHard ?? [{ start: 0, end: 24 * 60 }]);
    hardAvailableByDate.set(date, hardWindows);
    // Only a synthetic restriction needs base windows; explicit hard availability remains authoritative.
    dateOnlyHardAvailableByDate.set(date, originalHard === undefined ? windowsByDate.get(date)! : hardWindows);
  }
  return { windowsByDate, hardAvailableByDate, dateOnlyHardAvailableByDate };
}

function findWorkItemSlot(params: {
  context: WeeklyPlanningPlacementRuntimeContextV5;
  item: GenericPlanningWorkItem;
  dates: string[];
  duration: number;
  notBefore?: WeeklyPlanningPlacementNotBeforeV5;
  preferLongSegment: boolean;
}): MinuteInterval | null {
  const capacitySafeDates = datesWithinDailyCapacity({
    context: params.context,
    dates: params.dates,
    duration: params.duration,
  });
  if (capacitySafeDates.length === 0) return null;

  const explicitPreferences = preferredPlacementsForWorkItem({
    placements: params.context.input.preferredPlacements ?? [],
    item: params.item,
    dates: capacitySafeDates,
  });
  const windows = workItemClockWindows({
    context: params.context, item: params.item, dates: capacitySafeDates,
  });
  for (const preference of explicitPreferences) {
    const preferredSlot = findPreferredPlacementSlot({
      placements: [preference],
      duration: params.duration,
      windowsByDate: windows.windowsByDate,
      // A date-only preference cannot turn a restriction into newly available hours.
      hardAvailableByDate: preference.window ? windows.hardAvailableByDate : windows.dateOnlyHardAvailableByDate,
      busy: params.context.busy,
      breakMinutes: params.context.breakMinutes,
      notBefore: params.notBefore,
      preferLongSegment: params.preferLongSegment,
      restrictToBaseWindows: false,
    });
    if (preferredSlot) return preferredSlot;
  }
  return findPlacementSlot({
    dates: capacitySafeDates,
    duration: params.duration,
    windowsByDate: windows.windowsByDate,
    busy: params.context.busy,
    breakMinutes: params.context.breakMinutes,
    notBefore: params.notBefore,
    preferLongSegment: params.preferLongSegment,
  });
}

function orderedDates(params: {
  context: WeeklyPlanningPlacementRuntimeContextV5;
  allowedDates: string[];
  preferredDate: string | null;
  durationMinutes: number;
}): string[] {
  return orderPlacementDatesV5({
    allowedDates: params.allowedDates,
    allDates: params.context.dates,
    preferredDate: params.preferredDate,
    dayLoads: params.context.dayLoads,
    durationMinutes: params.durationMinutes,
    totalMovableMinutes: params.context.totalMovableMinutes,
  });
}

function findWorkItemFragments(params: {
  context: WeeklyPlanningPlacementRuntimeContextV5;
  item: GenericPlanningWorkItem;
  dates: string[];
  duration: number;
  notBefore?: WeeklyPlanningPlacementNotBeforeV5;
}): MinuteInterval[] | null {
  const quantum = WEEKLY_PLANNING_STABLE_V5_SESSION_QUANTUM_MINUTES;
  // Fragments keep the exact accepted total; non-quantum totals cannot be rounded
  // into five-minute pieces without adding or losing requested time.
  if (params.duration % quantum !== 0) return null;
  const windows = workItemClockWindows(params);
  const windowsByDate = new Map([...windows.windowsByDate].map(([date, values]) => [date, [...values]]));
  for (const preference of preferredPlacementsForWorkItem({
    placements: params.context.input.preferredPlacements ?? [], item: params.item, dates: params.dates,
  })) {
    for (const date of preference.dates) {
      const preferred = preferredPlacementWindows({
        placement: preference, date, windowsByDate: windows.windowsByDate,
        hardAvailableByDate: preference.window ? windows.hardAvailableByDate : windows.dateOnlyHardAvailableByDate,
        notBefore: params.notBefore,
      });
      windowsByDate.set(date, [...(windowsByDate.get(date) ?? []), ...preferred]);
    }
  }
  const segments = freePlacementSegments({
    dates: params.dates, windowsByDate, busy: params.context.busy,
    breakMinutes: params.context.breakMinutes, notBefore: params.notBefore,
  });
  const capacities = new Map((params.context.input.dailyCapacityLimits ?? [])
    .map((limit) => [limit.date, Math.max(0, limit.maxMinutes - (params.context.dayLoads.get(limit.date) ?? 0))]));
  const usableMinutes = (segment: MinuteInterval) => Math.floor(
    Math.min(segment.end - segment.start, capacities.get(segment.date) ?? Infinity) / quantum,
  ) * quantum;
  const selected: MinuteInterval[] = [];
  const datePriority = new Map(params.dates.map((date, index) => [date, index]));
  let remaining = params.duration;
  while (remaining > 0) {
    segments.sort((left, right) => usableMinutes(right) - usableMinutes(left)
      || datePriority.get(left.date)! - datePriority.get(right.date)! || left.start - right.start);
    const segment = segments.shift();
    if (!segment || usableMinutes(segment) < MIN_USEFUL_FRAGMENT_MINUTES) return null;
    let duration = Math.min(remaining, usableMinutes(segment));
    if (remaining > duration && remaining - duration < MIN_USEFUL_FRAGMENT_MINUTES) {
      duration = remaining - MIN_USEFUL_FRAGMENT_MINUTES;
    }
    if (duration < MIN_USEFUL_FRAGMENT_MINUTES) return null;
    selected.push({ date: segment.date, start: segment.start, end: segment.start + duration });
    remaining -= duration;
    if (capacities.has(segment.date)) capacities.set(segment.date, capacities.get(segment.date)! - duration);
  }
  return selected.sort((left, right) => left.date.localeCompare(right.date) || left.start - right.start);
}

export function scheduleWeeklyPlanningWorkItemV5(params: {
  context: WeeklyPlanningPlacementRuntimeContextV5;
  item: GenericPlanningWorkItem;
  taskPosition: { index: number; count: number };
  taskOrdinal: number;
  fixedEnds: Map<string, WeeklyPlanningPlacementNotBeforeV5>;
  globalCandidates: WeeklyDraftCandidate[];
  globalNotBefore?: WeeklyPlanningPlacementNotBeforeV5;
}): { candidates: WeeklyDraftCandidate[]; failedWorkItemId: string | null } {
  const duration = params.item.estimatedMinutes ?? 0;
  if (duration <= 0) return { candidates: [], failedWorkItemId: params.item.id };

  const rawAllowedDates = eligibleDates({
    input: params.context.input,
    item: params.item,
    dates: params.context.dates,
  });
  const relationBound = relationNotBeforeV5({
    taskId: params.item.taskId,
    relations: params.context.input.relations,
    placedBlocks: placementCandidateBlocks(params.globalCandidates),
    fixedTaskEnds: params.fixedEnds,
  });
  const effectiveNotBefore = laterNotBeforeV5(params.globalNotBefore, relationBound);
  const preferLongSegment = isHeavyWeeklyPlanningWorkItemV5({
    graph: params.context.graph,
    item: params.item,
  });
  const preferredDate = preferredTaskDistributedDateV5({
    taskIndex: params.taskOrdinal, sessionIndex: params.taskPosition.index,
    sessionCount: params.taskPosition.count, dates: params.context.dates,
  });
  const allowedDates = orderedDates({
    context: params.context, allowedDates: rawAllowedDates, preferredDate, durationMinutes: duration,
  });
  const slot = findWorkItemSlot({
    context: params.context, item: params.item, dates: allowedDates,
    duration, notBefore: effectiveNotBefore, preferLongSegment,
  });
  const slots = slot ? [slot] : params.item.splitPolicy === 'splittable'
    ? findWorkItemFragments({ context: params.context, item: params.item, dates: allowedDates,
        duration, notBefore: effectiveNotBefore })
    : null;
  if (!slots) return { candidates: [], failedWorkItemId: params.item.id };

  // Search is speculative. Publish and reserve only after the entire item fits.
  const candidates = slots.map((placed, chunkIndex) => {
    const candidate = createPlacementCandidate({
      input: params.context.input,
      graph: params.context.graph,
      item: params.item,
      slot: placed,
      duration: placed.end - placed.start,
      chunkIndex,
    });
    addPlacedSlot({ slot: placed, busy: params.context.busy, dayLoads: params.context.dayLoads });
    return candidate;
  });
  return { candidates, failedWorkItemId: null };
}
