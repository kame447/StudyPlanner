import type {
  EffortEstimateFact,
  PlanningTaskFact,
  RecurrenceFact,
  StudyComponentFact,
  StudyContextFact,
  TaskRelationFact,
  WorkloadFact,
} from './weeklyPlanningFactGraph';
import type { GenericPlanningWorkItem } from './weeklyPlanningGenericWorkItems';
import { listCalendarDatesInclusive } from './weeklyPlanningCalendarResolver';
import {
  resolveWeeklyPlanningCalendarRecurrenceDatesV5,
} from './weeklyPlanningRecurrenceCalendarV5';
import {
  filterWeeklyPlanningDatesByHardBoundV5,
  hardDateBoundForTargetV5,
  weeklyPlanningTemporalConstraintAppliesToTargetV5,
  type WeeklyPlanningSchedulerHardDateBoundV5,
} from './weeklyPlanningResolvedTemporalConstraintsV5';
import {
  distributeDiscreteQuantityAcrossWeeklyBucketsV5,
  distributeMinutesAcrossWeeklyBucketsV5,
  resolveWeeklySpreadSessionCountV5,
} from './weeklyPlanningStableV5DistributionPolicy';
import {
  deriveWeeklyPlanningSessionPolicyV5,
  inferWeeklyPlanningExecutionProfileV5,
  splitWeeklyPlanningSessionMinutesV5,
} from './weeklyPlanningStableV5ExecutionPolicy';
import { WEEKLY_PLANNING_MAX_GENERATED_SESSION_CHUNKS_V5 } from './weeklyPlanningNumericSafetyV5';
import {
  orderGenericSchedulerWorkItemsByRelationsV5,
} from './weeklyPlanningSchedulerRelationOrderingV5';

export {
  orderGenericSchedulerWorkItemsByRelationsV5,
} from './weeklyPlanningSchedulerRelationOrderingV5';

export interface WeeklyPlanningSchedulerDistributionGraphViewV5 {
  readonly tasks: ReadonlyArray<PlanningTaskFact>;
  readonly studyContexts?: ReadonlyArray<StudyContextFact>;
  readonly components: ReadonlyArray<StudyComponentFact>;
  readonly workloads: ReadonlyArray<Pick<
    WorkloadFact,
    'id' | 'taskId' | 'componentId' | 'unitCode' | 'perOccurrence'
  >>;
  readonly recurrences: ReadonlyArray<RecurrenceFact>;
  readonly relations?: ReadonlyArray<TaskRelationFact>;
}

/** Scoped accepted session size, separate from the effort needed for the whole workload. */
export function resolveWeeklyPlanningWorkItemSessionDurationV5(params: {
  item: GenericPlanningWorkItem;
  estimates: readonly EffortEstimateFact[];
}): { minutes: number | null; sourceFactIds: string[]; ambiguous: boolean } {
  const matching = params.estimates.filter((estimate) =>
    estimate.kind === 'session_duration'
    && estimate.taskId === params.item.taskId
    && (estimate.targetFactId === params.item.workloadFactId
      || estimate.targetFactId === params.item.componentId
      || estimate.targetFactId === params.item.taskId));
  // A workload/component detail takes precedence over an inherited task-level preference.
  const targets = [params.item.workloadFactId, params.item.componentId, params.item.taskId];
  const scoped = targets.map((target) => matching.filter((estimate) => estimate.targetFactId === target))
    .find((estimates) => estimates.length > 0) ?? [];
  const valid = scoped.length === 1 && Number.isFinite(scoped[0].minutes) && scoped[0].minutes > 0;
  return {
    minutes: valid ? scoped[0].minutes : null,
    sourceFactIds: scoped.map((estimate) => estimate.id),
    ambiguous: scoped.length > 0 && !valid,
  };
}

function recurringPerOccurrenceSlices(params: {
  graph: WeeklyPlanningSchedulerDistributionGraphViewV5;
  item: GenericPlanningWorkItem;
  dates: readonly string[];
  hardDateBounds: readonly WeeklyPlanningSchedulerHardDateBoundV5[];
}): GenericPlanningWorkItem[] {
  const workload = params.graph.workloads.find(
    (candidate) => candidate.id === params.item.workloadFactId,
  );
  if (!workload?.perOccurrence) return [params.item];

  const targetFactId = params.item.componentId ?? params.item.taskId;
  const recurrences = params.graph.recurrences.filter((recurrence) =>
    weeklyPlanningTemporalConstraintAppliesToTargetV5({
      constraintTaskId: recurrence.taskId,
      constraintTargetFactId: recurrence.targetFactId,
      taskId: params.item.taskId,
      targetFactId,
    }));
  if (recurrences.length !== 1) return [params.item];

  const recurrence = recurrences[0];
  const hardBound = hardDateBoundForTargetV5({
    bounds: params.hardDateBounds,
    taskId: params.item.taskId,
    targetFactId,
  });
  const boundedDates = filterWeeklyPlanningDatesByHardBoundV5({
    dates: params.dates,
    bound: hardBound,
  });
  const recurrenceResolution = resolveWeeklyPlanningCalendarRecurrenceDatesV5({
    kind: recurrence.kind,
    days: recurrence.days,
    dates: boundedDates,
  });
  if (
    recurrenceResolution.calendarDates === null
    || recurrenceResolution.invalidDays.length > 0
  ) {
    return [params.item];
  }

  return recurrenceResolution.calendarDates.map((date) => ({
    ...params.item,
    id: `${params.item.id}:recurrence:${recurrence.id}:${date}`,
    requiredDate: date,
    sourceFactRefs: [...new Set([...params.item.sourceFactRefs, recurrence.id])],
  }));
}

function isDistributableDiscreteItem(item: GenericPlanningWorkItem): boolean {
  return (item.quantity.unitCode === 'page' || item.quantity.unitCode === 'problem')
    && Number.isInteger(item.quantity.amount)
    && item.quantity.amount > 1
    && item.estimatedMinutes !== null
    && Number.isFinite(item.estimatedMinutes)
    && item.estimatedMinutes > 0;
}

function displayTargetLabel(
  graph: WeeklyPlanningSchedulerDistributionGraphViewV5,
  item: GenericPlanningWorkItem,
): string {
  if (item.componentId) {
    const component = graph.components.find((candidate) => candidate.id === item.componentId);
    if (component?.label.trim()) return component.label.trim();
  }
  return graph.tasks.find((candidate) => candidate.id === item.taskId)?.title.trim() || '予定';
}

function numericActualRange(item: GenericPlanningWorkItem): { start: number; end: number } | null {
  const range = item.quantity.actualRange;
  if (!range) return null;
  const start = Number(range.start);
  const end = Number(range.end);
  if (
    !Number.isInteger(start)
    || !Number.isInteger(end)
    || end - start + 1 !== item.quantity.amount
  ) {
    return null;
  }
  return { start, end };
}

function distributedSlices(params: {
  graph: WeeklyPlanningSchedulerDistributionGraphViewV5;
  item: GenericPlanningWorkItem;
  dates: readonly string[];
  sessionDurations?: readonly number[];
}): GenericPlanningWorkItem[] {
  const sessionCount = params.sessionDurations?.length ?? resolveWeeklySpreadSessionCountV5({
    totalMinutes: params.item.estimatedMinutes ?? 0,
    dates: params.dates,
    maximumSessions: params.item.quantity.amount,
  });
  if (sessionCount <= 1) return [params.item];

  const durations = params.sessionDurations ?? distributeMinutesAcrossWeeklyBucketsV5(
    params.item.estimatedMinutes ?? 0,
    sessionCount,
  );
  const quantities = distributeDiscreteQuantityAcrossWeeklyBucketsV5(
    params.item.quantity.amount,
    sessionCount,
  );
  if (durations.length !== sessionCount || quantities.length !== sessionCount) {
    return [params.item];
  }

  const label = displayTargetLabel(params.graph, params.item);
  const explicitRange = numericActualRange(params.item);
  const sourceOrdinalStart = params.item.quantity.ordinalRange?.start ?? 1;
  const aggregateAllocatedMinutes = params.item.estimatedMinutes ?? 0;
  let consumed = 0;

  return quantities.map((quantity, index) => {
    const ordinalStart = sourceOrdinalStart + consumed;
    consumed += quantity;
    const ordinalEnd = ordinalStart + quantity - 1;
    const actualRange = explicitRange
      ? {
          start: String(explicitRange.start + ordinalStart - sourceOrdinalStart),
          end: String(explicitRange.start + ordinalEnd - sourceOrdinalStart),
        }
      : null;
    const rangeLabel = actualRange
      ? `${actualRange.start}〜${actualRange.end}${params.item.quantity.unitLabel}`
      : `${ordinalStart}〜${ordinalEnd}${params.item.quantity.unitLabel}`;
    const durationMinutes = durations[index];
    const baseEstimatedMinutes = params.item.baseEstimatedMinutes === null
      || params.item.baseEstimatedMinutes === undefined
      || aggregateAllocatedMinutes <= 0
      ? params.item.baseEstimatedMinutes
      : params.item.baseEstimatedMinutes * (durationMinutes / aggregateAllocatedMinutes);

    return {
      ...params.item,
      id: `${params.item.id}:${params.sessionDurations ? 'session' : 'daily'}:${index + 1}`,
      label: `${label} ${quantity}${params.item.quantity.unitLabel}（${rangeLabel}）`,
      quantity: {
        ...params.item.quantity,
        amount: quantity,
        ordinalRange: { start: ordinalStart, end: ordinalEnd },
        actualRange,
      },
      estimatedMinutes: durationMinutes,
      baseEstimatedMinutes,
      plannedSessions: undefined,
      splitPolicy: 'atomic',
    };
  });
}

function executionPolicySlices(params: {
  graph: WeeklyPlanningSchedulerDistributionGraphViewV5;
  item: GenericPlanningWorkItem;
  preferredSessionMinutes?: number | null;
  sessionDurationEstimates?: readonly EffortEstimateFact[];
}): GenericPlanningWorkItem[] {
  const total = params.item.estimatedMinutes;
  const session = resolveWeeklyPlanningWorkItemSessionDurationV5({
    item: params.item,
    estimates: params.sessionDurationEstimates ?? [],
  });
  const explicitSessionMinutes = session.minutes;
  const countedSessions = params.item.quantity.unitCode === 'session' && explicitSessionMinutes !== null;
  if (
    (params.item.splitPolicy !== 'splittable' && !countedSessions)
    || total === null
    || !Number.isFinite(total)
    || total <= 0
  ) {
    // A cap remains observable even when atomic work or a bounded fallback cannot
    // split it. Carry the selected fact so actual durations can prove a violation.
    return [{
      ...params.item,
      sourceFactRefs: [...new Set([...params.item.sourceFactRefs, ...session.sourceFactIds])],
    }];
  }
  const profile = inferWeeklyPlanningExecutionProfileV5({
    graph: params.graph,
    item: params.item,
  });
  const policy = deriveWeeklyPlanningSessionPolicyV5({
    profile,
    preferredSessionMinutes: params.preferredSessionMinutes,
  });
  // User-specified session length owns the boundary. Neither the default maximum nor
  // generic balancing may silently keep longer blocks or replace full requested sessions.
  const sessionMinutes = explicitSessionMinutes === null ? null : Math.max(1, Math.round(explicitSessionMinutes));
  const sessionCount = sessionMinutes === null ? 0 : Math.ceil(total / sessionMinutes);
  const chunks = sessionMinutes !== null && sessionCount <= WEEKLY_PLANNING_MAX_GENERATED_SESSION_CHUNKS_V5
    ? Array.from({ length: sessionCount }, (_, index) => Math.min(sessionMinutes, total - index * sessionMinutes))
    : splitWeeklyPlanningSessionMinutesV5({ totalMinutes: total, policy, profile });
  if (chunks.length <= 1) return [{
    ...params.item,
    sourceFactRefs: [...new Set([...params.item.sourceFactRefs, ...session.sourceFactIds])],
  }];

  const label = displayTargetLabel(params.graph, params.item);
  const totalQuantity = params.item.quantity.amount;
  let consumedMinutes = 0;
  return chunks.map((durationMinutes, index) => {
    const remainingMinutes = total - consumedMinutes;
    const effectiveDuration = Math.min(durationMinutes, remainingMinutes);
    const ratio = effectiveDuration / total;
    const quantityAmount = index === chunks.length - 1
      ? Math.max(0, totalQuantity - chunks
          .slice(0, -1)
          .reduce((sum, chunk) => sum + totalQuantity * (chunk / total), 0))
      : totalQuantity * ratio;
    consumedMinutes += effectiveDuration;
    // Allocated time can include rounding/calibration. It must not increase the
    // requested workload quantity when the slices are expressed in minutes/hours.
    const displayQuantity = quantityAmount;
    const quantityLabel = Number.isInteger(displayQuantity)
      ? String(displayQuantity)
      : String(Math.round(displayQuantity * 100) / 100);
    const baseEstimatedMinutes = params.item.baseEstimatedMinutes === null
      || params.item.baseEstimatedMinutes === undefined
      ? params.item.baseEstimatedMinutes
      : params.item.baseEstimatedMinutes * ratio;
    return {
      ...params.item,
      id: `${params.item.id}:session:${index + 1}`,
      label: `${label} ${quantityLabel}${params.item.quantity.unitLabel}（${index + 1}/${chunks.length}）`,
      quantity: {
        ...params.item.quantity,
        amount: displayQuantity,
        ordinalRange: null,
        actualRange: null,
      },
      estimatedMinutes: durationMinutes,
      baseEstimatedMinutes,
      plannedSessions: undefined,
      splitPolicy: 'atomic',
      sourceFactRefs: [...new Set([...params.item.sourceFactRefs, ...session.sourceFactIds])],
    };
  });
}

function explicitContentSessionSlices(params: {
  graph: WeeklyPlanningSchedulerDistributionGraphViewV5;
  item: GenericPlanningWorkItem;
  dates: readonly string[];
  estimates: readonly EffortEstimateFact[];
}): GenericPlanningWorkItem[] | null {
  const { item } = params;
  // All positive integer content counts share this policy, including custom units.
  // Time/session quantities have their own splitter; mock exams remain atomic.
  if (['minute', 'hour', 'session', 'mock_exam'].includes(item.quantity.unitCode)
    || !Number.isInteger(item.quantity.amount) || item.quantity.amount <= 0) return null;
  const session = resolveWeeklyPlanningWorkItemSessionDurationV5({ item, estimates: params.estimates });
  if (session.minutes === null || item.estimatedMinutes === null || item.baseEstimatedMinutes == null) return null;
  const cap = Math.max(1, Math.floor(session.minutes));
  const base = item.baseEstimatedMinutes * (item.calibrationMultiplier ?? 1);
  const minutesPerUnit = base / item.quantity.amount;
  const unitsPerSession = Math.floor(cap / minutesPerUnit);
  // Keep content units whole. If even one unit exceeds the cap, retain its effort
  // in one session with the cap's source ref, so preview truth reports not_satisfied.
  const count = Math.ceil(item.quantity.amount / Math.max(1, unitsPerSession));
  if (count <= 0 || count > WEEKLY_PLANNING_MAX_GENERATED_SESSION_CHUNKS_V5) return null;
  const quantities = distributeDiscreteQuantityAcrossWeeklyBucketsV5(item.quantity.amount, count);
  if (quantities.length !== count) return null;
  // Allocate each slice's real content cost first, then spread the remaining margin
  // evenly within each cap. Never balance durations below their own content cost or
  // add a margin-only tail; a short slice must follow from the content/cap arithmetic.
  const durations = quantities.map(quantity => Math.ceil(quantity * minutesPerUnit));
  const floorTotal = durations.reduce((sum, duration) => sum + duration, 0);
  const allocated = Math.max(floorTotal, unitsPerSession === 0 ? item.estimatedMinutes : Math.min(item.estimatedMinutes, count * cap));
  const margin = Math.floor(allocated - floorTotal);
  const headroom = durations.map(duration => unitsPerSession === 0 ? margin : Math.max(0, cap - duration));
  // Find a common margin without a loop per minute (estimates can be large).
  let low = 0;
  let high = margin;
  while (low < high) {
    const level = low + Math.ceil((high - low) / 2);
    const total = headroom.reduce((sum, room) => sum + Math.min(room, level), 0);
    if (total <= margin) low = level;
    else high = level - 1;
  }
  let remainder = margin;
  durations.forEach((duration, index) => {
    const added = Math.min(headroom[index], low);
    durations[index] = duration + added;
    remainder -= added;
  });
  durations.forEach((_, index) => {
    if (headroom[index] > low && remainder > 0) { durations[index] += 1; remainder -= 1; }
  });
  const cappedItem: GenericPlanningWorkItem = {
    ...item, estimatedMinutes: allocated, splitPolicy: 'atomic',
    sourceFactRefs: [...new Set([...item.sourceFactRefs, ...session.sourceFactIds])],
  };
  if (count === 1) return [cappedItem];
  return distributedSlices({ graph: params.graph, item: cappedItem, dates: params.dates, sessionDurations: durations })
    .map(slice => ({ ...slice, baseEstimatedMinutes: item.baseEstimatedMinutes! * slice.quantity.amount / item.quantity.amount }));
}

export function distributeGenericSchedulerWorkItemsV5(params: {
  graph: WeeklyPlanningSchedulerDistributionGraphViewV5;
  items: readonly GenericPlanningWorkItem[];
  startDate: string;
  endDate: string;
  hardDateBounds?: readonly WeeklyPlanningSchedulerHardDateBoundV5[];
  preferredSessionMinutes?: number | null;
  sessionDurationEstimates?: readonly EffortEstimateFact[];
}): GenericPlanningWorkItem[] {
  const dates = listCalendarDatesInclusive(params.startDate, params.endDate) ?? [];
  const recurrenceDistributed = dates.length === 0
    ? [...params.items]
    : params.items.flatMap((item) => recurringPerOccurrenceSlices({
        graph: params.graph,
        item,
        dates,
        hardDateBounds: params.hardDateBounds ?? [],
      }));
  const dayDistributed = dates.length === 0
    ? recurrenceDistributed
    : recurrenceDistributed.flatMap((item) => {
        const explicit = explicitContentSessionSlices({
          graph: params.graph, item, dates, estimates: params.sessionDurationEstimates ?? [],
        });
        if (explicit) return explicit;
        if (item.requiredDate) return [item];
        return isDistributableDiscreteItem(item)
          ? distributedSlices({ graph: params.graph, item, dates })
          : [item];
      });
  const sessionDistributed = dayDistributed.flatMap((item) =>
    executionPolicySlices({
      graph: params.graph,
      item,
      preferredSessionMinutes: params.preferredSessionMinutes,
      sessionDurationEstimates: params.sessionDurationEstimates,
    }));
  return orderGenericSchedulerWorkItemsByRelationsV5({
    items: sessionDistributed,
    relations: params.graph.relations ?? [],
  });
}
