import type { MonthEvent, Plan, ScheduleTemplate } from '../../../types/domain';
import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';
import type { GenericPlanningWorkItem } from './weeklyPlanningGenericWorkItems';
import type { GenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import { listCalendarDatesInclusive } from './weeklyPlanningCalendarResolver';
import type { WeeklyPlanningPlacementGraphViewV5 } from './weeklyPlanningPlacementGraphViewV5';
import {
  buildHardAvailableWindowsByDate,
  buildPlacementBusyIntervals,
  buildPlacementWindowsByDate,
  DEFAULT_PLACEMENT_DAY_END,
  DEFAULT_PLACEMENT_DAY_START,
} from './weeklyPlanningStableV5PlacementAvailability';
import {
  fixedTaskPlacementEnds,
  rollbackPlacementCandidates,
  sortPlacementCandidates,
  workItemGroupPositions,
} from './weeklyPlanningStableV5PlacementCandidates';
import {
  taskOrdinalMapV5,
  type WeeklyPlanningPlacementNotBeforeV5,
} from './weeklyPlanningStableV5PlacementPolicy';
import {
  scheduleWeeklyPlanningWorkItemV5,
  type WeeklyPlanningPlacementRuntimeContextV5,
} from './weeklyPlanningStableV5WorkItemPlacement';

export type { WeeklyPlanningStableV5CandidateMetadata } from './weeklyPlanningStableV5PlacementCandidates';

export const WEEKLY_PLANNING_STABLE_V5_PREVIEW_SCHEDULER_VERSION =
  'weekly-planning-stable-v5-preview-scheduler-v1' as const;

export interface WeeklyPlanningStableV5PreviewSchedulerResult {
  schedulerVersion: typeof WEEKLY_PLANNING_STABLE_V5_PREVIEW_SCHEDULER_VERSION;
  status: 'ready' | 'empty' | 'insufficient_capacity';
  candidates: WeeklyDraftCandidate[];
  unscheduledWorkItemIds: string[];
}

const DEFAULT_BREAK_MINUTES = 10;

function itemHardDeadline(item: GenericPlanningWorkItem, input: GenericSchedulerInput): string | null {
  const ends = input.hardDateBounds
    .filter((bound) => bound.taskId === item.taskId && bound.endDate !== null
      && [item.taskId, item.workloadFactId, item.componentId].includes(bound.targetFactId))
    .map((bound) => bound.endDate as string);
  return ends.length > 0 ? ends.sort()[0] : null;
}

/** Earliest hard deadline first; items without one keep the canonical order after them (stable). */
export function deadlineFirstOrder(
  items: readonly GenericPlanningWorkItem[],
  input: GenericSchedulerInput,
): GenericPlanningWorkItem[] {
  return items
    .map((item, index) => ({ item, index, deadline: itemHardDeadline(item, input) }))
    .sort((left, right) => {
      if (left.deadline !== right.deadline) {
        if (left.deadline === null) return 1;
        if (right.deadline === null) return -1;
        return left.deadline.localeCompare(right.deadline);
      }
      return left.index - right.index;
    })
    .map((entry) => entry.item);
}

function isPastRecurringOccurrence(params: {
  item: GenericPlanningWorkItem;
  graph: WeeklyPlanningPlacementGraphViewV5;
  notBefore?: WeeklyPlanningPlacementNotBeforeV5;
}): boolean {
  if (
    !params.notBefore
    || !params.item.requiredDate
    || params.item.requiredDate >= params.notBefore.date
  ) {
    return false;
  }
  return params.graph.workloads.some((workload) =>
    workload.id === params.item.workloadFactId && workload.perOccurrence === true);
}

export function scheduleWeeklyPlanningStableV5Preview(params: {
  input: GenericSchedulerInput;
  graph: WeeklyPlanningPlacementGraphViewV5;
  plans?: readonly Plan[];
  ownerId?: string;
  monthEvents?: readonly MonthEvent[];
  scheduleTemplates?: readonly ScheduleTemplate[];
  timetableTermId?: string;
  dayStartTime?: string;
  dayEndTime?: string;
  breakMinutes?: number;
  namedTimePeriods?: Partial<Record<string, { startTime: string; endTime: string }>>;
  notBefore?: WeeklyPlanningPlacementNotBeforeV5;
  retainPartialCandidates?: boolean;
}): WeeklyPlanningStableV5PreviewSchedulerResult {
  const dates = listCalendarDatesInclusive(
    params.input.horizon.startDate,
    params.input.horizon.endDate,
  ) ?? [];
  const movableWorkItems = params.input.movableWorkItems.filter((item) =>
    !isPastRecurringOccurrence({
      item,
      graph: params.graph,
      notBefore: params.notBefore,
    }));
  if (movableWorkItems.length === 0) {
    return {
      schedulerVersion: WEEKLY_PLANNING_STABLE_V5_PREVIEW_SCHEDULER_VERSION,
      status: 'empty',
      candidates: [],
      unscheduledWorkItemIds: [],
    };
  }

  const buildContext = (): WeeklyPlanningPlacementRuntimeContextV5 => ({
    input: params.input,
    graph: params.graph,
    dates,
    windowsByDate: buildPlacementWindowsByDate({
      input: params.input,
      dates,
      dayStartTime: params.dayStartTime ?? DEFAULT_PLACEMENT_DAY_START,
      dayEndTime: params.dayEndTime ?? DEFAULT_PLACEMENT_DAY_END,
      notBefore: params.notBefore,
    }),
    hardAvailableByDate: buildHardAvailableWindowsByDate({
      input: params.input,
      dates,
      notBefore: params.notBefore,
    }),
    busy: buildPlacementBusyIntervals({
      input: params.input,
      dates,
      plans: params.plans ?? [],
      ownerId: params.ownerId,
      monthEvents: params.monthEvents,
      scheduleTemplates: params.scheduleTemplates ?? [],
      timetableTermId: params.timetableTermId,
    }),
    dayLoads: new Map(dates.map((date) => [date, 0])),
    breakMinutes: params.breakMinutes ?? DEFAULT_BREAK_MINUTES,
    totalMovableMinutes: movableWorkItems.reduce(
      (sum, item) => sum + Math.max(0, item.estimatedMinutes ?? 0),
      0,
    ),
    namedTimePeriods: params.namedTimePeriods,
  });
  const fixedEnds = fixedTaskPlacementEnds(params.input);

  const placeInOrder = (ordered: readonly GenericPlanningWorkItem[]) => {
    const context = buildContext();
    const taskPositions = workItemGroupPositions(ordered, (item) => item.taskId);
    const taskOrdinals = taskOrdinalMapV5(ordered.map((item) => item.taskId));
    const placed: WeeklyDraftCandidate[] = [];
    const failed: string[] = [];
    for (const item of ordered) {
      const scheduled = scheduleWeeklyPlanningWorkItemV5({
        context,
        item,
        taskPosition: taskPositions.get(item.id) ?? { index: 0, count: 1 },
        taskOrdinal: taskOrdinals.get(item.taskId) ?? 0,
        fixedEnds,
        globalCandidates: placed,
        globalNotBefore: params.notBefore,
      });
      if (scheduled.failedWorkItemId) {
        failed.push(scheduled.failedWorkItemId);
        rollbackPlacementCandidates({
          candidates: scheduled.candidates,
          busy: context.busy,
          dayLoads: context.dayLoads,
        });
        continue;
      }
      placed.push(...scheduled.candidates);
    }
    return { candidates: placed, unscheduledWorkItemIds: failed };
  };

  let { candidates, unscheduledWorkItemIds } = placeInOrder(movableWorkItems);
  if (unscheduledWorkItemIds.length > 0) {
    // Greedy placement is order dependent: before claiming insufficient capacity, retry once with the
    // earliest hard deadline first (ties keep the canonical order), so a feasible plan is not refused
    // only because its tight-deadline task was listed last.
    const retried = placeInOrder(deadlineFirstOrder(movableWorkItems, params.input));
    if (retried.unscheduledWorkItemIds.length === 0) {
      candidates = retried.candidates;
      unscheduledWorkItemIds = retried.unscheduledWorkItemIds;
    }
  }

  if (unscheduledWorkItemIds.length > 0) {
    return {
      schedulerVersion: WEEKLY_PLANNING_STABLE_V5_PREVIEW_SCHEDULER_VERSION,
      status: 'insufficient_capacity',
      candidates: params.retainPartialCandidates
        ? sortPlacementCandidates(candidates)
        : [],
      unscheduledWorkItemIds,
    };
  }
  return {
    schedulerVersion: WEEKLY_PLANNING_STABLE_V5_PREVIEW_SCHEDULER_VERSION,
    status: 'ready',
    candidates: sortPlacementCandidates(candidates),
    unscheduledWorkItemIds: [],
  };
}
