import type { Plan, ScheduleTemplate } from '../../../types/domain';
import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';
import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import type { GenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import { listCalendarDatesInclusive } from './weeklyPlanningCalendarResolver';
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

export function scheduleWeeklyPlanningStableV5Preview(params: {
  input: GenericSchedulerInput;
  graph: WeeklyPlanningFactGraphV5;
  plans?: readonly Plan[];
  scheduleTemplates?: readonly ScheduleTemplate[];
  timetableTermId?: string;
  dayStartTime?: string;
  dayEndTime?: string;
  breakMinutes?: number;
  namedTimePeriods?: Partial<Record<string, { startTime: string; endTime: string }>>;
  notBefore?: WeeklyPlanningPlacementNotBeforeV5;
}): WeeklyPlanningStableV5PreviewSchedulerResult {
  const dates = listCalendarDatesInclusive(
    params.input.horizon.startDate,
    params.input.horizon.endDate,
  ) ?? [];
  if (params.input.movableWorkItems.length === 0) {
    return {
      schedulerVersion: WEEKLY_PLANNING_STABLE_V5_PREVIEW_SCHEDULER_VERSION,
      status: 'empty',
      candidates: [],
      unscheduledWorkItemIds: [],
    };
  }

  const context: WeeklyPlanningPlacementRuntimeContextV5 = {
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
      scheduleTemplates: params.scheduleTemplates ?? [],
      timetableTermId: params.timetableTermId,
    }),
    dayLoads: new Map(dates.map((date) => [date, 0])),
    breakMinutes: params.breakMinutes ?? DEFAULT_BREAK_MINUTES,
    totalMovableMinutes: params.input.movableWorkItems.reduce(
      (sum, item) => sum + Math.max(0, item.estimatedMinutes ?? 0),
      0,
    ),
    namedTimePeriods: params.namedTimePeriods,
  };
  const taskPositions = workItemGroupPositions(
    params.input.movableWorkItems,
    (item) => item.taskId,
  );
  const taskOrdinals = taskOrdinalMapV5(
    params.input.movableWorkItems.map((item) => item.taskId),
  );
  const fixedEnds = fixedTaskPlacementEnds(params.input);
  const candidates: WeeklyDraftCandidate[] = [];
  const unscheduledWorkItemIds: string[] = [];

  for (const item of params.input.movableWorkItems) {
    const scheduled = scheduleWeeklyPlanningWorkItemV5({
      context,
      item,
      taskPosition: taskPositions.get(item.id) ?? { index: 0, count: 1 },
      taskOrdinal: taskOrdinals.get(item.taskId) ?? 0,
      fixedEnds,
      globalCandidates: candidates,
      globalNotBefore: params.notBefore,
    });
    if (scheduled.failedWorkItemId) {
      unscheduledWorkItemIds.push(scheduled.failedWorkItemId);
      rollbackPlacementCandidates({
        candidates: scheduled.candidates,
        busy: context.busy,
        dayLoads: context.dayLoads,
      });
      continue;
    }
    candidates.push(...scheduled.candidates);
  }

  if (unscheduledWorkItemIds.length > 0) {
    return {
      schedulerVersion: WEEKLY_PLANNING_STABLE_V5_PREVIEW_SCHEDULER_VERSION,
      status: 'insufficient_capacity',
      candidates: [],
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
