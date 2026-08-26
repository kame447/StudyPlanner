import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';
import type { GenericPlanningWorkItem } from './weeklyPlanningGenericWorkItems';
import type { GenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import type { WeeklyPlanningPlacementGraphViewV5 } from './weeklyPlanningPlacementGraphViewV5';
import {
  hardDateBoundForTargetV5,
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

function findWorkItemSlot(params: {
  context: WeeklyPlanningPlacementRuntimeContextV5;
  item: GenericPlanningWorkItem;
  dates: string[];
  duration: number;
  notBefore?: WeeklyPlanningPlacementNotBeforeV5;
  preferLongSegment: boolean;
}): MinuteInterval | null {
  const explicitPreferences = preferredPlacementsForWorkItem({
    placements: params.context.input.preferredPlacements ?? [],
    item: params.item,
    dates: params.dates,
  });
  const preferredSlot = explicitPreferences.length > 0
    ? findPreferredPlacementSlot({
        placements: explicitPreferences,
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
  return preferredSlot ?? findPlacementSlot({
    dates: params.dates,
    duration: params.duration,
    windowsByDate: params.context.windowsByDate,
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
