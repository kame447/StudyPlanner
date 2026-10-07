import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';
import type { GenericPlanningWorkItem } from './weeklyPlanningGenericWorkItems';
import type { GenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import type { WeeklyPlanningPlacementGraphViewV5 } from './weeklyPlanningPlacementGraphViewV5';
import {
  hardDateBoundForTargetV5,
} from './weeklyPlanningResolvedTemporalConstraintsV5';
import {
  partitionWeeklyPlanningDatesV5,
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

/** Preserve ordinary reserve capacity; an explicit narrower day scope may use its last day. */
function distinctSessionDateGroups(params: {
  dates: string[];
  scopeDates: readonly string[];
  allDates: readonly string[];
  usedDates: ReadonlySet<string>;
}): string[][] {
  if (params.usedDates.size === 0) return [params.dates];
  const scoped = new Set(params.scopeDates);
  const { reserveDates } = partitionWeeklyPlanningDatesV5(params.allDates);
  const reserve = new Set(reserveDates);
  const pools = params.allDates.every(date => scoped.has(date))
    ? [params.dates.filter(date => !reserve.has(date)), params.dates.filter(date => reserve.has(date))]
    : [params.dates];
  return pools.flatMap(dates => [
    dates.filter(date => !params.usedDates.has(date)),
    dates.filter(date => params.usedDates.has(date)),
  ]).filter(dates => dates.length > 0);
}

function findWorkItemSlot(params: {
  context: WeeklyPlanningPlacementRuntimeContextV5;
  item: GenericPlanningWorkItem;
  dates: string[];
  duration: number;
  notBefore?: WeeklyPlanningPlacementNotBeforeV5;
  preferLongSegment: boolean;
  usedSessionDates: ReadonlySet<string>;
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
  const preferredScope = preferredPlacementsForWorkItem({
    placements: params.context.input.preferredPlacements ?? [],
    item: params.item,
    dates: params.dates,
  }).flatMap(placement => placement.dates);
  // An explicit time/day preference stays ahead of unconstrained free time. Within that
  // preference, try dates not yet used by this workload before placing sessions together.
  for (const dates of distinctSessionDateGroups({
    dates: capacitySafeDates,
    scopeDates: preferredScope,
    allDates: params.context.dates,
    usedDates: params.usedSessionDates,
  })) {
    const allowed = new Set(dates);
    const preferredSlot = explicitPreferences.length > 0
      ? findPreferredPlacementSlot({
        placements: explicitPreferences.map(placement => ({
          ...placement, dates: placement.dates.filter(date => allowed.has(date)),
        })),
        duration: params.duration,
        windowsByDate: params.context.windowsByDate,
        hardAvailableByDate: params.context.hardAvailableByDate,
        busy: params.context.busy,
        breakMinutes: params.context.breakMinutes,
        notBefore: params.notBefore,
        preferLongSegment: params.preferLongSegment,
        restrictToBaseWindows: false,
      })
      : null;
    if (preferredSlot) return preferredSlot;
  }
  for (const dates of distinctSessionDateGroups({
    dates: capacitySafeDates,
    scopeDates: params.dates,
    allDates: params.context.dates,
    usedDates: params.usedSessionDates,
  })) {
    const slot = findPlacementSlot({
      dates,
      duration: params.duration,
      windowsByDate: params.context.windowsByDate,
      busy: params.context.busy,
      breakMinutes: params.context.breakMinutes,
      notBefore: params.notBefore,
      preferLongSegment: params.preferLongSegment,
    });
    if (slot) return slot;
  }
  return null;
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
  const siblingWorkItemIds = new Set(params.context.input.movableWorkItems.filter(item =>
    item.taskId === params.item.taskId && item.componentId === params.item.componentId
    && item.workloadFactId === params.item.workloadFactId).map(item => item.id));
  const usedSessionDates = new Set(params.globalCandidates
    .filter(candidate => siblingWorkItemIds.has(candidate.workItemKey))
    .map(candidate => candidate.date));

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
      usedSessionDates,
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
    usedSessionDates.add(slot.date);
  }

  return { candidates: itemCandidates, failedWorkItemId: null };
}
