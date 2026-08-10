import { getRecurrenceWeekday } from '../../../lib/planRecurrence';
import { buildTimetableImportCandidates } from '../../../lib/timetableImport';
import type { Plan, PlanType, ScheduleTemplate } from '../../../types/domain';
import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';
import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import type {
  GenericPlanningWorkItem,
} from './weeklyPlanningGenericWorkItems';
import type {
  GenericSchedulerInput,
} from './weeklyPlanningGenericSchedulerInput';
import {
  calendarWeekday,
  canonicalWeekdayIndex,
  listCalendarDatesInclusive,
  resolveCanonicalDateExpression,
} from './weeklyPlanningCalendarResolver';

export const WEEKLY_PLANNING_STABLE_V5_PREVIEW_SCHEDULER_VERSION =
  'weekly-planning-stable-v5-preview-scheduler-v1' as const;

export interface WeeklyPlanningStableV5CandidateMetadata {
  runtime: 'stable_v5';
  graphRevision: number;
  taskId: string;
  sourceFactRefs: string[];
  planType: PlanType;
}

export interface WeeklyPlanningStableV5PreviewSchedulerResult {
  schedulerVersion: typeof WEEKLY_PLANNING_STABLE_V5_PREVIEW_SCHEDULER_VERSION;
  status: 'ready' | 'empty' | 'insufficient_capacity';
  candidates: WeeklyDraftCandidate[];
  unscheduledWorkItemIds: string[];
}

interface MinuteInterval {
  date: string;
  start: number;
  end: number;
}

interface PlacementWindow {
  start: number;
  end: number;
}

interface PreferredPlacement {
  dates: string[];
  window: PlacementWindow | null;
}

const DEFAULT_DAY_START = '09:00';
const DEFAULT_DAY_END = '22:00';
const DEFAULT_BREAK_MINUTES = 10;
const DEFAULT_SESSION_MINUTES = 60;
const EXISTING_PLAN_BUFFER_MINUTES = 10;
const DEFAULT_NAMED_TIME_PERIODS: Record<string, { startTime: string; endTime: string }> = {
  morning: { startTime: '06:00', endTime: '12:00' },
  afternoon: { startTime: '12:00', endTime: '17:00' },
  evening: { startTime: '17:00', endTime: '21:00' },
  night: { startTime: '21:00', endTime: '24:00' },
  before_sleep: { startTime: '21:00', endTime: '24:00' },
};

function minutesFromTime(time: string): number {
  if (time === '24:00') return 24 * 60;
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function timeFromMinutes(value: number): string {
  const minutes = Math.max(0, Math.min(value, 24 * 60));
  if (minutes === 24 * 60) return '24:00';
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function overlaps(left: MinuteInterval, right: MinuteInterval): boolean {
  return left.date === right.date && left.start < right.end && right.start < left.end;
}

function clipInterval(interval: MinuteInterval): MinuteInterval | null {
  const start = Math.max(0, Math.min(interval.start, 24 * 60));
  const end = Math.max(0, Math.min(interval.end, 24 * 60));
  return end > start ? { ...interval, start, end } : null;
}

function addCrossDateInterval(params: {
  dates: string[];
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  target: MinuteInterval[];
}): void {
  const startIndex = params.dates.indexOf(params.startDate);
  const endIndex = params.dates.indexOf(params.endDate);
  if (startIndex < 0 && endIndex < 0) return;
  if (params.startDate === params.endDate) {
    const interval = clipInterval({
      date: params.startDate,
      start: minutesFromTime(params.startTime),
      end: minutesFromTime(params.endTime),
    });
    if (interval) params.target.push(interval);
    return;
  }
  params.dates.forEach((date) => {
    if (date < params.startDate || date > params.endDate) return;
    const interval = clipInterval({
      date,
      start: date === params.startDate ? minutesFromTime(params.startTime) : 0,
      end: date === params.endDate ? minutesFromTime(params.endTime) : 24 * 60,
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
      start: minutesFromTime(plan.startTime) - EXISTING_PLAN_BUFFER_MINUTES,
      end: minutesFromTime(plan.endTime) + EXISTING_PLAN_BUFFER_MINUTES,
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
        start: minutesFromTime(candidate.startTime) - EXISTING_PLAN_BUFFER_MINUTES,
        end: minutesFromTime(candidate.endTime) + EXISTING_PLAN_BUFFER_MINUTES,
      });
      return interval ? [interval] : [];
    }),
  );
}

function hardConstraintIntervals(params: {
  input: GenericSchedulerInput;
  dates: string[];
}): MinuteInterval[] {
  const intervals: MinuteInterval[] = [];
  params.input.fixedTaskReservations.forEach((reservation) => {
    addCrossDateInterval({
      dates: params.dates,
      startDate: reservation.start.date,
      startTime: reservation.start.time,
      endDate: reservation.end.date,
      endTime: reservation.end.time,
      target: intervals,
    });
  });
  params.input.availabilityWindows
    .filter((window) =>
      window.constraintLevel === 'hard'
      && (window.kind === 'occupied' || window.kind === 'unavailable'))
    .forEach((window) => {
      addCrossDateInterval({
        dates: params.dates,
        startDate: window.start.date,
        startTime: window.start.time,
        endDate: window.end.date,
        endTime: window.end.time,
        target: intervals,
      });
    });
  return intervals;
}

function placementWindowsByDate(params: {
  input: GenericSchedulerInput;
  dates: string[];
  dayStartTime: string;
  dayEndTime: string;
}): Map<string, PlacementWindow[]> {
  const defaultWindow = {
    start: minutesFromTime(params.dayStartTime),
    end: minutesFromTime(params.dayEndTime),
  };
  const result = new Map<string, PlacementWindow[]>();
  params.dates.forEach((date) => result.set(date, [defaultWindow]));

  const hardAvailable = params.input.availabilityWindows.filter((window) =>
    window.constraintLevel === 'hard' && window.kind === 'available');
  if (hardAvailable.length === 0) return result;

  const byDate = new Map<string, PlacementWindow[]>();
  hardAvailable.forEach((window) => {
    if (window.start.date !== window.end.date) return;
    const start = Math.max(defaultWindow.start, minutesFromTime(window.start.time));
    const end = Math.min(defaultWindow.end, minutesFromTime(window.end.time));
    if (end <= start) return;
    byDate.set(window.start.date, [
      ...(byDate.get(window.start.date) ?? []),
      { start, end },
    ]);
  });
  params.dates.forEach((date) => {
    if (byDate.has(date)) {
      result.set(date, byDate.get(date)!.sort((left, right) => left.start - right.start));
    }
  });
  return result;
}

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
    if (remaining < 30 && chunks.length > 0) chunks[chunks.length - 1] += remaining;
    else chunks.push(remaining);
  }
  return chunks;
}

function eligibleDates(params: {
  input: GenericSchedulerInput;
  item: GenericPlanningWorkItem;
  dates: string[];
}): string[] {
  const eligibility = params.input.taskDateEligibilities.find(
    (entry) => entry.taskId === params.item.taskId,
  );
  const allowed = eligibility?.allowedDates === null || eligibility === undefined
    ? params.dates
    : eligibility.allowedDates;
  const excluded = new Set(eligibility?.excludedDates ?? []);
  return allowed.filter((date) => params.dates.includes(date) && !excluded.has(date));
}

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

function preferredPlacements(params: {
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
          start: minutesFromTime(constraint.startTime),
          end: minutesFromTime(constraint.endTime),
        };
      } else if (constraint.namedTimePeriod) {
        const resolved = namedTimePeriods[constraint.namedTimePeriod];
        if (!resolved) return [];
        window = {
          start: minutesFromTime(resolved.startTime),
          end: minutesFromTime(resolved.endTime),
        };
      }
      if (window && window.end <= window.start) return [];
      return [{ dates, window }];
    });
}

function findSlot(params: {
  dates: string[];
  duration: number;
  windowsByDate: Map<string, PlacementWindow[]>;
  busy: MinuteInterval[];
  breakMinutes: number;
  overrideWindow?: PlacementWindow | null;
}): MinuteInterval | null {
  for (const date of params.dates) {
    const baseWindows = params.windowsByDate.get(date) ?? [];
    const windows = params.overrideWindow
      ? baseWindows.flatMap((base) => {
          const start = Math.max(base.start, params.overrideWindow!.start);
          const end = Math.min(base.end, params.overrideWindow!.end);
          return end > start ? [{ start, end }] : [];
        })
      : baseWindows;
    for (const window of windows) {
      let cursor = window.start;
      while (cursor + params.duration <= window.end) {
        const candidate: MinuteInterval = {
          date,
          start: cursor,
          end: cursor + params.duration,
        };
        const conflict = params.busy
          .filter((interval) => interval.date === date)
          .sort((left, right) => left.start - right.start)
          .find((interval) => overlaps(candidate, interval));
        if (!conflict) return candidate;
        cursor = Math.max(cursor + 1, conflict.end + params.breakMinutes);
      }
    }
  }
  return null;
}

function findPreferredSlot(params: {
  placements: PreferredPlacement[];
  duration: number;
  windowsByDate: Map<string, PlacementWindow[]>;
  busy: MinuteInterval[];
  breakMinutes: number;
}): MinuteInterval | null {
  for (const placement of params.placements) {
    const slot = findSlot({
      dates: placement.dates,
      duration: params.duration,
      windowsByDate: params.windowsByDate,
      busy: params.busy,
      breakMinutes: params.breakMinutes,
      overrideWindow: placement.window,
    });
    if (slot) return slot;
  }
  return null;
}

function planTypeForTask(
  graph: WeeklyPlanningFactGraphV5,
  taskId: string,
): PlanType {
  const category = graph.tasks.find((task) => task.id === taskId)?.category;
  return category === 'study' ? 'study' : 'other';
}

function fieldLabelForItem(
  graph: WeeklyPlanningFactGraphV5,
  item: GenericPlanningWorkItem,
): string {
  if (item.componentId) {
    const component = graph.components.find((fact) => fact.id === item.componentId);
    if (component?.label.trim()) return component.label.trim();
  }
  return graph.tasks.find((task) => task.id === item.taskId)?.title.trim() || '予定';
}

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

  const busy = [
    ...hardConstraintIntervals({ input: params.input, dates }),
    ...existingPlanIntervals(params.plans ?? [], dates),
    ...timetableIntervals({
      templates: params.scheduleTemplates ?? [],
      termId: params.timetableTermId,
      dates,
    }),
  ];
  const windowsByDate = placementWindowsByDate({
    input: params.input,
    dates,
    dayStartTime: params.dayStartTime ?? DEFAULT_DAY_START,
    dayEndTime: params.dayEndTime ?? DEFAULT_DAY_END,
  });
  const candidates: WeeklyDraftCandidate[] = [];
  const unscheduledWorkItemIds: string[] = [];
  const breakMinutes = params.breakMinutes ?? DEFAULT_BREAK_MINUTES;

  for (const item of params.input.movableWorkItems) {
    const chunks = sessionChunks(item);
    const allowedDates = eligibleDates({ input: params.input, item, dates });
    const preferences = preferredPlacements({
      graph: params.graph,
      item,
      dates: allowedDates,
      namedTimePeriods: params.namedTimePeriods,
    });
    const itemCandidates: WeeklyDraftCandidate[] = [];
    let failed = chunks.length === 0;
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const duration = chunks[chunkIndex];
      const preferredSlot = preferences.length > 0
        ? findPreferredSlot({
            placements: preferences,
            duration,
            windowsByDate,
            busy,
            breakMinutes,
          })
        : null;
      const slot = preferredSlot ?? findSlot({
        dates: allowedDates,
        duration,
        windowsByDate,
        busy,
        breakMinutes,
      });
      if (!slot) {
        failed = true;
        break;
      }
      const planType = planTypeForTask(params.graph, item.taskId);
      const metadata: WeeklyPlanningStableV5CandidateMetadata = {
        runtime: 'stable_v5',
        graphRevision: params.input.graphRevision,
        taskId: item.taskId,
        sourceFactRefs: [...item.sourceFactRefs],
        planType,
      };
      const candidate = {
        stableKey: `stable-v5:${params.input.graphRevision}:${item.id}:${chunkIndex}`,
        date: slot.date,
        startTime: timeFromMinutes(slot.start),
        endTime: timeFromMinutes(slot.end),
        durationMinutes: duration,
        title: item.label,
        field: fieldLabelForItem(params.graph, item),
        year: 0,
        estimatedMinutes: item.estimatedMinutes ?? duration,
        source: 'weekly_exam_prep',
        approvalStatus: 'unapproved',
        workItemKey: item.id,
        stableV5Metadata: metadata,
      } as WeeklyDraftCandidate;
      itemCandidates.push(candidate);
      busy.push(slot);
    }
    if (failed) {
      unscheduledWorkItemIds.push(item.id);
      itemCandidates.forEach((candidate) => {
        const index = busy.findIndex((interval) =>
          interval.date === candidate.date
          && interval.start === minutesFromTime(candidate.startTime)
          && interval.end === minutesFromTime(candidate.endTime));
        if (index >= 0) busy.splice(index, 1);
      });
    } else {
      candidates.push(...itemCandidates);
    }
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
    candidates,
    unscheduledWorkItemIds: [],
  };
}
