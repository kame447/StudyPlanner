import { getRecurrenceWeekday } from '../../../lib/planRecurrence';
import { buildTimetableImportCandidates } from '../../../lib/timetableImport';
import type { Plan, PlanType, ScheduleTemplate } from '../../../types/domain';
import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';
import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import type { GenericPlanningWorkItem } from './weeklyPlanningGenericWorkItems';
import type { GenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import {
  calendarWeekday,
  canonicalWeekdayIndex,
  listCalendarDatesInclusive,
  resolveCanonicalDateExpression,
} from './weeklyPlanningCalendarResolver';
import {
  preferredTaskDistributedDateV5,
  preferredVocabularyLearningDateV5,
  reviewCandidateDatesV5,
  vocabularyLearningCandidateDatesV5,
  vocabularyReviewTargetsV5,
} from './weeklyPlanningStableV5DistributionPolicy';
import {
  isHeavyWeeklyPlanningWorkItemV5,
} from './weeklyPlanningStableV5ExecutionPolicy';
import {
  laterNotBeforeV5,
  leavesTinyWindowFragmentV5,
  orderPlacementDatesV5,
  relationNotBeforeV5,
  taskOrdinalMapV5,
  type WeeklyPlanningPlacementNotBeforeV5,
  type WeeklyPlanningPlacedTaskBlockV5,
} from './weeklyPlanningStableV5PlacementPolicy';

export const WEEKLY_PLANNING_STABLE_V5_PREVIEW_SCHEDULER_VERSION =
  'weekly-planning-stable-v5-preview-scheduler-v1' as const;

export interface WeeklyPlanningStableV5CandidateMetadata {
  runtime: 'stable_v5';
  graphRevision: number;
  taskId: string;
  sourceFactRefs: string[];
  planType: PlanType;
  sessionRole?: 'learning' | 'review';
  reviewRound?: 1 | 2;
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
const MIN_USEFUL_FRAGMENT_MINUTES = 30;
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
  dates: readonly string[];
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  target: MinuteInterval[];
}): void {
  if (params.startDate === params.endDate) {
    if (!params.dates.includes(params.startDate)) return;
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

function existingPlanIntervals(plans: readonly Plan[], dates: readonly string[]): MinuteInterval[] {
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
  dates: readonly string[];
}): MinuteInterval[] {
  const intervals: MinuteInterval[] = [];
  params.input.fixedTaskReservations.forEach((reservation) => addCrossDateInterval({
    dates: params.dates,
    startDate: reservation.start.date,
    startTime: reservation.start.time,
    endDate: reservation.end.date,
    endTime: reservation.end.time,
    target: intervals,
  }));
  params.input.availabilityWindows
    .filter((window) =>
      window.constraintLevel === 'hard'
      && (window.kind === 'occupied' || window.kind === 'unavailable'))
    .forEach((window) => addCrossDateInterval({
      dates: params.dates,
      startDate: window.start.date,
      startTime: window.start.time,
      endDate: window.end.date,
      endTime: window.end.time,
      target: intervals,
    }));
  return intervals;
}

function clampWindowsToNotBefore(params: {
  date: string;
  windows: readonly PlacementWindow[];
  notBefore?: WeeklyPlanningPlacementNotBeforeV5;
}): PlacementWindow[] {
  if (!params.notBefore) return params.windows.map((window) => ({ ...window }));
  if (params.date < params.notBefore.date) return [];
  if (params.date > params.notBefore.date) return params.windows.map((window) => ({ ...window }));
  const cutoff = minutesFromTime(params.notBefore.time);
  return params.windows.flatMap((window) => {
    const start = Math.max(window.start, cutoff);
    return window.end > start ? [{ start, end: window.end }] : [];
  });
}

function placementWindowsByDate(params: {
  input: GenericSchedulerInput;
  dates: string[];
  dayStartTime: string;
  dayEndTime: string;
  notBefore?: WeeklyPlanningPlacementNotBeforeV5;
}): Map<string, PlacementWindow[]> {
  const defaultWindow = {
    start: minutesFromTime(params.dayStartTime),
    end: minutesFromTime(params.dayEndTime),
  };
  const result = new Map<string, PlacementWindow[]>();
  params.dates.forEach((date) => result.set(date, clampWindowsToNotBefore({
    date,
    windows: [defaultWindow],
    notBefore: params.notBefore,
  })));

  const hardAvailable = params.input.availabilityWindows.filter((window) =>
    window.constraintLevel === 'hard'
    && window.kind === 'available'
    && window.start.date === window.end.date);
  hardAvailable.forEach((window) => {
    const start = Math.max(defaultWindow.start, minutesFromTime(window.start.time));
    const end = Math.min(defaultWindow.end, minutesFromTime(window.end.time));
    if (end <= start) {
      result.set(window.start.date, []);
      return;
    }
    const clipped = clampWindowsToNotBefore({
      date: window.start.date,
      windows: [{ start, end }],
      notBefore: params.notBefore,
    });
    const previous = result.get(window.start.date);
    const priorHardWindows = hardAvailable
      .filter((candidate) => candidate.start.date === window.start.date)
      .slice(0, hardAvailable.indexOf(window));
    result.set(
      window.start.date,
      priorHardWindows.length > 0 ? [...(previous ?? []), ...clipped] : clipped,
    );
  });
  for (const [date, windows] of result) {
    result.set(date, windows.sort((left, right) => left.start - right.start));
  }
  return result;
}

function hardAvailableWindowsByDate(params: {
  input: GenericSchedulerInput;
  dates: readonly string[];
  notBefore?: WeeklyPlanningPlacementNotBeforeV5;
}): Map<string, PlacementWindow[]> {
  const dateSet = new Set(params.dates);
  const result = new Map<string, PlacementWindow[]>();
  params.input.availabilityWindows
    .filter((window) =>
      window.constraintLevel === 'hard'
      && window.kind === 'available'
      && window.start.date === window.end.date
      && dateSet.has(window.start.date))
    .forEach((window) => {
      const start = minutesFromTime(window.start.time);
      const end = minutesFromTime(window.end.time);
      if (end <= start) return;
      const clipped = clampWindowsToNotBefore({
        date: window.start.date,
        windows: [{ start, end }],
        notBefore: params.notBefore,
      });
      result.set(window.start.date, [
        ...(result.get(window.start.date) ?? []),
        ...clipped,
      ]);
    });
  for (const [date, windows] of result) {
    result.set(date, windows.sort((left, right) => left.start - right.start));
  }
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
    const conflict = conflicts.find((interval) => overlaps(candidate, interval));
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
    const tail = freeEnd - candidate.end;
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
    if (tail >= 0) return candidate;
  }
  return null;
}

function findSlot(params: {
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
      const windows = clampWindowsToNotBefore({
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

function findPreferredSlot(params: {
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
      const hardAvailable = params.hardAvailableByDate.get(date);
      let windows: PlacementWindow[];
      if (placement.window) {
        const preferredWindows = clampWindowsToNotBefore({
          date,
          windows: [placement.window],
          notBefore: params.notBefore,
        });
        windows = hardAvailable === undefined
          ? preferredWindows
          : preferredWindows.flatMap((preferred) =>
              intersectPlacementWindows(hardAvailable, preferred));
      } else {
        windows = hardAvailable ?? clampWindowsToNotBefore({
          date,
          windows: params.windowsByDate.get(date) ?? [],
          notBefore: params.notBefore,
        });
      }
      const slot = findSlot({
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

function planTypeForTask(graph: WeeklyPlanningFactGraphV5, taskId: string): PlanType {
  return graph.tasks.find((task) => task.id === taskId)?.category === 'study'
    ? 'study'
    : 'other';
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

function groupPositions(
  items: readonly GenericPlanningWorkItem[],
  keyForItem: (item: GenericPlanningWorkItem) => string,
): Map<string, { index: number; count: number }> {
  const groups = new Map<string, GenericPlanningWorkItem[]>();
  for (const item of items) {
    const key = keyForItem(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const positions = new Map<string, { index: number; count: number }>();
  groups.forEach((group) => {
    group.forEach((item, index) => positions.set(item.id, { index, count: group.length }));
  });
  return positions;
}

function fixedTaskEnds(input: GenericSchedulerInput): Map<string, WeeklyPlanningPlacementNotBeforeV5> {
  const result = new Map<string, WeeklyPlanningPlacementNotBeforeV5>();
  input.fixedTaskReservations.forEach((reservation) => {
    const candidate = { date: reservation.end.date, time: reservation.end.time };
    const previous = result.get(reservation.taskId);
    result.set(reservation.taskId, laterNotBeforeV5(previous, candidate)!);
  });
  return result;
}

function createCandidate(params: {
  input: GenericSchedulerInput;
  graph: WeeklyPlanningFactGraphV5;
  item: GenericPlanningWorkItem;
  slot: MinuteInterval;
  duration: number;
  chunkIndex: number;
  title?: string;
  workItemKey?: string;
  sessionRole?: 'learning' | 'review';
  reviewRound?: 1 | 2;
}): WeeklyDraftCandidate {
  const planType = planTypeForTask(params.graph, params.item.taskId);
  const metadata: WeeklyPlanningStableV5CandidateMetadata = {
    runtime: 'stable_v5',
    graphRevision: params.input.graphRevision,
    taskId: params.item.taskId,
    sourceFactRefs: [...params.item.sourceFactRefs],
    planType,
    ...(params.sessionRole ? { sessionRole: params.sessionRole } : {}),
    ...(params.reviewRound ? { reviewRound: params.reviewRound } : {}),
  };
  const workItemKey = params.workItemKey ?? params.item.id;
  return {
    stableKey: `stable-v5:${params.input.graphRevision}:${workItemKey}:${params.chunkIndex}`,
    date: params.slot.date,
    startTime: timeFromMinutes(params.slot.start),
    endTime: timeFromMinutes(params.slot.end),
    durationMinutes: params.duration,
    title: params.title ?? params.item.label,
    field: fieldLabelForItem(params.graph, params.item),
    year: 0,
    estimatedMinutes: params.duration,
    source: 'weekly_exam_prep',
    approvalStatus: 'unapproved',
    workItemKey,
    stableV5Metadata: metadata,
  } as WeeklyDraftCandidate;
}

function addPlacedSlot(params: {
  slot: MinuteInterval;
  busy: MinuteInterval[];
  dayLoads: Map<string, number>;
}): void {
  params.busy.push(params.slot);
  params.dayLoads.set(
    params.slot.date,
    (params.dayLoads.get(params.slot.date) ?? 0) + params.slot.end - params.slot.start,
  );
}

function rollbackCandidates(params: {
  candidates: readonly WeeklyDraftCandidate[];
  busy: MinuteInterval[];
  dayLoads: Map<string, number>;
}): void {
  params.candidates.forEach((candidate) => {
    const start = minutesFromTime(candidate.startTime);
    const end = minutesFromTime(candidate.endTime);
    const index = params.busy.findIndex((interval) =>
      interval.date === candidate.date && interval.start === start && interval.end === end);
    if (index >= 0) params.busy.splice(index, 1);
    params.dayLoads.set(
      candidate.date,
      Math.max(0, (params.dayLoads.get(candidate.date) ?? 0) - candidate.durationMinutes),
    );
  });
}

function sortCandidatesChronologically(candidates: WeeklyDraftCandidate[]): WeeklyDraftCandidate[] {
  return candidates.slice().sort((left, right) =>
    left.date.localeCompare(right.date)
    || left.startTime.localeCompare(right.startTime)
    || left.stableKey.localeCompare(right.stableKey));
}

function candidatePlacedBlocks(candidates: readonly WeeklyDraftCandidate[]): WeeklyPlanningPlacedTaskBlockV5[] {
  return candidates.flatMap((candidate) => {
    const metadata = (candidate as WeeklyDraftCandidate & {
      stableV5Metadata?: WeeklyPlanningStableV5CandidateMetadata;
    }).stableV5Metadata;
    if (!metadata?.taskId) return [];
    return [{
      taskId: metadata.taskId,
      date: candidate.date,
      startTime: candidate.startTime,
      endTime: candidate.endTime,
    }];
  });
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
    notBefore: params.notBefore,
  });
  const hardAvailableByDate = hardAvailableWindowsByDate({
    input: params.input,
    dates,
    notBefore: params.notBefore,
  });
  const candidates: WeeklyDraftCandidate[] = [];
  const unscheduledWorkItemIds: string[] = [];
  const breakMinutes = params.breakMinutes ?? DEFAULT_BREAK_MINUTES;
  const dayLoads = new Map<string, number>(dates.map((date) => [date, 0]));
  const taskPositions = groupPositions(params.input.movableWorkItems, (item) => item.taskId);
  const vocabularyPositions = groupPositions(
    params.input.movableWorkItems.filter((item) => item.quantity.unitCode === 'word'),
    (item) => item.workloadFactId,
  );
  const taskOrdinals = taskOrdinalMapV5(params.input.movableWorkItems.map((item) => item.taskId));
  const fixedEnds = fixedTaskEnds(params.input);
  const totalMovableMinutes = params.input.movableWorkItems.reduce(
    (sum, item) => sum + Math.max(0, item.estimatedMinutes ?? 0),
    0,
  );

  for (const item of params.input.movableWorkItems) {
    const chunks = sessionChunks(item);
    const rawAllowedDates = eligibleDates({ input: params.input, item, dates });
    const taskPosition = taskPositions.get(item.id) ?? { index: 0, count: 1 };
    const vocabularyPosition = vocabularyPositions.get(item.id) ?? { index: 0, count: 1 };
    const taskOrdinal = taskOrdinals.get(item.taskId) ?? 0;
    const itemCandidates: WeeklyDraftCandidate[] = [];
    let failed = chunks.length === 0;
    let failedWorkItemId = item.id;
    const relationBound = relationNotBeforeV5({
      taskId: item.taskId,
      relations: params.input.relations,
      placedBlocks: candidatePlacedBlocks(candidates),
      fixedTaskEnds: fixedEnds,
    });
    const effectiveNotBefore = laterNotBeforeV5(params.notBefore, relationBound);
    const preferLongSegment = isHeavyWeeklyPlanningWorkItemV5({ graph: params.graph, item });

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const duration = chunks[chunkIndex];
      const isVocabulary = item.quantity.unitCode === 'word';
      const sessionIndex = chunks.length > 1 ? chunkIndex : taskPosition.index;
      const sessionCount = chunks.length > 1 ? chunks.length : taskPosition.count;
      const preferredDate = isVocabulary
        ? preferredVocabularyLearningDateV5({
            sessionIndex: vocabularyPosition.index,
            sessionCount: vocabularyPosition.count,
            dates,
          })
        : preferredTaskDistributedDateV5({
            taskIndex: taskOrdinal,
            sessionIndex,
            sessionCount,
            dates,
          });
      const vocabularyCandidateDates = isVocabulary
        ? vocabularyLearningCandidateDatesV5({ preferredDate, dates })
        : [...rawAllowedDates];
      const allowedDates = orderPlacementDatesV5({
        allowedDates: vocabularyCandidateDates.filter((date) => rawAllowedDates.includes(date)),
        allDates: dates,
        preferredDate,
        dayLoads,
        durationMinutes: duration,
        totalMovableMinutes,
      });
      const preferences = preferredPlacements({
        graph: params.graph,
        item,
        dates: allowedDates,
        namedTimePeriods: params.namedTimePeriods,
      });
      const preferredSlot = preferences.length > 0
        ? findPreferredSlot({
            placements: preferences,
            duration,
            windowsByDate,
            hardAvailableByDate,
            busy,
            breakMinutes,
            notBefore: effectiveNotBefore,
            preferLongSegment,
          })
        : null;
      const slot = preferredSlot ?? findSlot({
        dates: allowedDates,
        duration,
        windowsByDate,
        busy,
        breakMinutes,
        notBefore: effectiveNotBefore,
        preferLongSegment,
      });
      if (!slot) {
        failed = true;
        break;
      }

      const candidate = createCandidate({
        input: params.input,
        graph: params.graph,
        item,
        slot,
        duration,
        chunkIndex,
        ...(isVocabulary ? { sessionRole: 'learning' as const } : {}),
      });
      itemCandidates.push(candidate);
      addPlacedSlot({ slot, busy, dayLoads });

      if (!isVocabulary) continue;
      const reviewTargets = vocabularyReviewTargetsV5({
        learningDate: slot.date,
        learningDurationMinutes: duration,
        dates,
      });
      for (const review of reviewTargets) {
        const reviewWorkItemKey = `${item.id}:review-${review.round}`;
        const reviewRawDates = reviewCandidateDatesV5({
          preferredDate: review.preferredDate,
          dates,
        }).filter((date) => rawAllowedDates.includes(date));
        const reviewDates = orderPlacementDatesV5({
          allowedDates: reviewRawDates,
          allDates: dates,
          preferredDate: review.preferredDate,
          dayLoads,
          durationMinutes: review.durationMinutes,
          totalMovableMinutes,
        });
        const reviewPreferences = preferredPlacements({
          graph: params.graph,
          item,
          dates: reviewDates,
          namedTimePeriods: params.namedTimePeriods,
        });
        const reviewPreferredSlot = reviewPreferences.length > 0
          ? findPreferredSlot({
              placements: reviewPreferences,
              duration: review.durationMinutes,
              windowsByDate,
              hardAvailableByDate,
              busy,
              breakMinutes,
              notBefore: effectiveNotBefore,
              preferLongSegment: false,
            })
          : null;
        const reviewSlot = reviewPreferredSlot ?? findSlot({
          dates: reviewDates,
          duration: review.durationMinutes,
          windowsByDate,
          busy,
          breakMinutes,
          notBefore: effectiveNotBefore,
          preferLongSegment: false,
        });
        if (!reviewSlot) {
          failed = true;
          failedWorkItemId = reviewWorkItemKey;
          break;
        }
        const reviewCandidate = createCandidate({
          input: params.input,
          graph: params.graph,
          item,
          slot: reviewSlot,
          duration: review.durationMinutes,
          chunkIndex: 0,
          title: `${item.label}・復習${review.round}回目`,
          workItemKey: reviewWorkItemKey,
          sessionRole: 'review',
          reviewRound: review.round,
        });
        itemCandidates.push(reviewCandidate);
        addPlacedSlot({ slot: reviewSlot, busy, dayLoads });
      }
      if (failed) break;
    }

    if (failed) {
      unscheduledWorkItemIds.push(failedWorkItemId);
      rollbackCandidates({ candidates: itemCandidates, busy, dayLoads });
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
    candidates: sortCandidatesChronologically(candidates),
    unscheduledWorkItemIds: [],
  };
}
