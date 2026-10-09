import type { MonthEvent, Plan, ScheduleTemplate } from '../../../types/domain';
import { listCalendarDatesInclusive } from '../semantic/weeklyPlanningCalendarResolver';
import type { GenericSchedulerInput } from '../semantic/weeklyPlanningGenericSchedulerInput';
import {
  DEFAULT_PLACEMENT_DAY_END,
  DEFAULT_PLACEMENT_DAY_START,
  buildPlacementBusyIntervals,
  buildPlacementWindowsByDate,
  placementTimeFromMinutes,
} from '../semantic/weeklyPlanningStableV5PlacementAvailability';
import type { WeeklyPlanningPlacementNotBeforeV5 } from '../semantic/weeklyPlanningStableV5PlacementPolicy';
import { listWeeklyPlanningStableBlockingQuestionsV5 } from '../semantic/weeklyPlanningStableDialoguePolicyV5';
import type { GenericSchedulerInputCompilationResult } from '../semantic/weeklyPlanningGenericSchedulerInput';
import type { OpenRoleNeedV5 } from './weeklyPlanningHeldRoleConfirmationV5';

/**
 * Typed planning context for the AI (Issue #488 P3 S2): what the plan still NEEDS (typed question codes with their target, in no
 * fixed order: the AI chooses whether to ask, offer or propose) and what the calendar ALREADY answers (free minutes and the largest
 * free windows per day), so it does not ask what is known and may propose from it. No prose, never sent to the semantic model.
 */
export type PlanningNeedV5 = OpenRoleNeedV5 | { need: string; targetFactId: string | null };

const NEED_LIMIT = 4;
const WINDOWS_PER_DAY = 3;
/** The question codes whose answer is an amount of time/work the calendar can inform. */
const AMOUNT_NEEDS: ReadonlySet<string> = new Set(['missing_schedulable_work', 'missing_effort_estimate']);

export function isAmountPlanningNeedV5(code: string | null | undefined): boolean {
  return typeof code === 'string' && AMOUNT_NEEDS.has(code);
}

/** Blocking needs by typed code; an open declared amount is stated by its richer entry instead of the generic one. */
export function blockingPlanningNeedsV5(params: {
  compilation: GenericSchedulerInputCompilationResult;
  openRoleNeeds: readonly OpenRoleNeedV5[];
  /** The question the application is holding/asking this turn (a need even when compilation has no blocking issue for it). */
  asked?: { code: string; factId: string | null } | null;
}): PlanningNeedV5[] {
  const generic = listWeeklyPlanningStableBlockingQuestionsV5(params.compilation)
    .filter((question) => !(question.code === 'quantity_role_unresolved'
      && params.openRoleNeeds.some((need) => need.workloadFactId === question.factId)))
    .map((question) => ({ need: question.code, targetFactId: question.factId }));
  const seen = new Set<string>();
  const asked = params.asked && !(params.asked.code === 'quantity_role_unresolved'
    && params.openRoleNeeds.some((need) => need.workloadFactId === params.asked?.factId))
    ? [{ need: params.asked.code, targetFactId: params.asked.factId }] : [];
  return [...params.openRoleNeeds, ...asked, ...generic].filter((entry) => {
    const key = `${entry.need}:${'targetFactId' in entry ? entry.targetFactId : entry.workloadFactId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, NEED_LIMIT);
}

export interface CalendarFreeDayV5 {
  date: string;
  freeMinutes: number;
  /** The largest free windows, `HH:MM-HH:MM`. */
  windows: string[];
}

/** Free time per day of the planning period: the placement day (or hard available windows) minus every busy interval. */
export function calendarFreeV5(params: {
  schedulerInput: GenericSchedulerInput | null | undefined;
  /** The resolved planning period when no scheduler input exists yet (a question turn before any work item). */
  horizon?: { startDate: string; endDate: string } | null;
  plans: readonly Plan[];
  monthEvents?: readonly MonthEvent[];
  ownerId?: string;
  scheduleTemplates: readonly ScheduleTemplate[];
  timetableTermId?: string;
  notBefore?: WeeklyPlanningPlacementNotBeforeV5;
}): CalendarFreeDayV5[] {
  const horizon = params.schedulerInput?.horizon ?? params.horizon;
  if (!horizon) return [];
  // Without a compiled input only the period is known: no hard windows or reservations to subtract yet.
  const input = params.schedulerInput ?? ({
    availabilityWindows: [], fixedTaskReservations: [], movableWorkItems: [], dailyCapacityLimits: [], horizon,
  } as unknown as GenericSchedulerInput);
  const dates = listCalendarDatesInclusive(horizon.startDate, horizon.endDate) ?? [];
  if (dates.length === 0) return [];
  const windowsByDate = buildPlacementWindowsByDate({
    input, dates, dayStartTime: DEFAULT_PLACEMENT_DAY_START, dayEndTime: DEFAULT_PLACEMENT_DAY_END, notBefore: params.notBefore,
  });
  const busy = buildPlacementBusyIntervals({
    input, dates, plans: params.plans, ownerId: params.ownerId, monthEvents: params.monthEvents,
    scheduleTemplates: params.scheduleTemplates, timetableTermId: params.timetableTermId,
  });
  return dates.map((date) => {
    const blocked = busy.filter((interval) => interval.date === date).sort((left, right) => left.start - right.start);
    const free: Array<{ start: number; end: number }> = [];
    for (const window of windowsByDate.get(date) ?? []) {
      let cursor = window.start;
      for (const interval of blocked) {
        if (interval.end <= cursor || interval.start >= window.end) continue;
        if (interval.start > cursor) free.push({ start: cursor, end: interval.start });
        cursor = Math.max(cursor, interval.end);
      }
      if (cursor < window.end) free.push({ start: cursor, end: window.end });
    }
    return {
      date,
      freeMinutes: free.reduce((sum, segment) => sum + (segment.end - segment.start), 0),
      windows: [...free].sort((left, right) => (right.end - right.start) - (left.end - left.start))
        .slice(0, WINDOWS_PER_DAY).sort((left, right) => left.start - right.start)
        .map((segment) => `${placementTimeFromMinutes(segment.start)}-${placementTimeFromMinutes(segment.end)}`),
    };
  });
}
