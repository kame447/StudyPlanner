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
  preferredPlacementsForWorkItem,
} from './weeklyPlanningStableV5SlotSearch';

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

const DEFAULT_SESSION_MINUTES = 60;
const MIN_USEFUL_FRAGMENT_MINUTES = 30;

function sessionChunks(item: GenericPlanningWorkItem): number[] {
  const total = item.estimatedMinutes ?? 0;
  if (total <= 0) return [];
  if (item.splitPolicy !== 'splittable' || total <= 120) return [total];

  const chunks: number[] = [];
  let remaining = total;
  while (remaining > DEFAULT_SESSION_MINUTES) {
    chunks.push(DEFAULT_SESSION_MINUTES);
    remaining -= DEFAULT_SESSION_MINUTES;
  }
  if (remaining > 0) {
    if (remaining < MIN_USEFUL_FRAGMENT_MINUTES && chunks.length > 0) {
      chunks[chunks.length - 1] += remaining;
    } else {
      chunks.push(remaining);
    }
  }
  return chunks;
}

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

export function scheduleWeeklyPlanningWorkItemV5(params: {
  context: WeeklyPlanningPlacementRuntimeContextV5;
  item: GenericPlanningWorkItem;
  taskPosition: { index: number; count: number };
  taskOrdinal: number;
  fixedEnds: Map<string, WeeklyPlanningPlacementNotBeforeV5>;
  globalCandidates: WeeklyDraftCandidate[];
  globalNotBefore?: WeeklyPlanningPlacementNotBeforeV5;
}): { candidates: WeeklyDraftCandidate[]; failedWorkItemId: string | null } {
  const chunks = sessionChunks(params.item);
  if (chunks.length === 0) return { candidates: [], failedWorkItemId: params.item.id };

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
  const itemCandidates: WeeklyDraftCandidate[] = [];

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const duration = chunks[chunkIndex];
    const sessionIndex = chunks.length > 1 ? chunkIndex : params.taskPosition.index;
    const sessionCount = chunks.length > 1 ? chunks.length : params.taskPosition.count;
    const preferredDate = preferredTaskDistributedDateV5({
      taskIndex: params.taskOrdinal,
      sessionIndex,
      sessionCount,
      dates: params.context.dates,
    });
    const allowedDates = orderedDates({
      context: params.context,
      allowedDates: rawAllowedDates,
      preferredDate,
      durationMinutes: duration,
    });
    const slot = findWorkItemSlot({
      context: params.context,
      item: params.item,
      dates: allowedDates,
      duration,
      notBefore: effectiveNotBefore,
      preferLongSegment,
    });
    if (!slot) return { candidates: itemCandidates, failedWorkItemId: params.item.id };

    itemCandidates.push(createPlacementCandidate({
      input: params.context.input,
      graph: params.context.graph,
      item: params.item,
      slot,
      duration,
      chunkIndex,
    }));
    addPlacedSlot({ slot, busy: params.context.busy, dayLoads: params.context.dayLoads });
  }

  return { candidates: itemCandidates, failedWorkItemId: null };
}
