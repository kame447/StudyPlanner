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
import {
  isWeeklyPlanningSafePositiveNumberV5,
  WEEKLY_PLANNING_MAX_GENERATED_SESSION_CHUNKS_V5,
} from './weeklyPlanningNumericSafetyV5';
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
  explicitPartition?: { quantities: number[]; durations: number[] };
}): GenericPlanningWorkItem[] {
  const sessionCount = params.explicitPartition?.quantities.length ?? resolveWeeklySpreadSessionCountV5({
    totalMinutes: params.item.estimatedMinutes ?? 0,
    dates: params.dates,
    maximumSessions: params.item.quantity.amount,
  });
  if (sessionCount <= 1) return [params.item];

  const durations = params.explicitPartition?.durations ?? distributeMinutesAcrossWeeklyBucketsV5(
    params.item.estimatedMinutes ?? 0,
    sessionCount,
  );
  const quantities = params.explicitPartition?.quantities ?? distributeDiscreteQuantityAcrossWeeklyBucketsV5(
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
      : params.item.baseEstimatedMinutes * (params.explicitPartition
          ? quantity / params.item.quantity.amount : durationMinutes / aggregateAllocatedMinutes);

    return {
      ...params.item,
      id: `${params.item.id}:daily:${index + 1}`,
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
  explicitChunks?: number[];
}): GenericPlanningWorkItem[] {
  const total = params.item.estimatedMinutes;
  if (
    params.item.splitPolicy !== 'splittable'
    || total === null
    || !Number.isFinite(total)
    || total <= 0
  ) {
    return [params.item];
  }
  const profile = inferWeeklyPlanningExecutionProfileV5({
    graph: params.graph,
    item: params.item,
  });
  const policy = deriveWeeklyPlanningSessionPolicyV5({
    profile,
    preferredSessionMinutes: params.preferredSessionMinutes,
  });
  const chunks = params.explicitChunks ?? splitWeeklyPlanningSessionMinutesV5({
    totalMinutes: total,
    policy,
    profile,
  });
  if (chunks.length <= 1) return [params.item];

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
    const displayQuantity = params.explicitChunks ? quantityAmount : params.item.quantity.unitCode === 'minute'
      ? durationMinutes
      : params.item.quantity.unitCode === 'hour'
        ? durationMinutes / 60
        : quantityAmount;
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
    };
  });
}

export function distributeGenericSchedulerWorkItemsV5(params: {
  graph: WeeklyPlanningSchedulerDistributionGraphViewV5;
  items: readonly GenericPlanningWorkItem[];
  startDate: string;
  endDate: string;
  hardDateBounds?: readonly WeeklyPlanningSchedulerHardDateBoundV5[];
  preferredSessionMinutes?: number | null;
}): GenericPlanningWorkItem[] {
  return resolveGenericSchedulerWorkDistributionV5({ ...params, sessionDurationEstimates: [] }).items;
}

export interface WeeklyPlanningSessionPartitionIssueV5 {
  code: 'session_partition_unfulfillable';
  factId: string;
  matchingSessionDurationFactIds: string[];
  details: {
    reason: 'ambiguous_session_duration' | 'invalid_session_duration'
      | 'cap_below_clock_precision' | 'missing_partition_cost'
      | 'indivisible_unit_exceeds_cap' | 'unsupported_quantity_partition'
      | 'unsupported_actual_range' | 'generation_limit' | 'unsafe_partition_arithmetic';
    taskId: string;
    sessionDurationFactId: string | null;
    sessionDurationScopeFactId: string;
    matchingEstimateCount: number;
    requestedSessionMinutes: number | null;
    sessionMinuteLimit: number | null;
    requiredSessionCount?: number;
    maximumGeneratedSessions: number;
    workUnitCode: string;
    workUnitLabel: string;
    quantityAmount: number;
    rangeStart: string | null;
    rangeEnd: string | null;
    minimumRequiredMinutes?: number;
  };
}

export type WeeklyPlanningSchedulerDistributionResultV5 =
  | { status: 'ready'; items: GenericPlanningWorkItem[]; issues: [] }
  | { status: 'needs_resolution'; items: []; issues: WeeklyPlanningSessionPartitionIssueV5[] };

type DistributionParams = Parameters<typeof distributeGenericSchedulerWorkItemsV5>[0];

/** A cap changes allocation, not the meaning of the accepted workload or estimate. */
function explicitSessionPartition(params: {
  graph: WeeklyPlanningSchedulerDistributionGraphViewV5;
  item: GenericPlanningWorkItem;
  dates: readonly string[];
  estimates: readonly EffortEstimateFact[];
}): { kind: 'ready'; items: GenericPlanningWorkItem[] }
  | { kind: 'blocked'; issue: WeeklyPlanningSessionPartitionIssueV5 }
  | null {
  const { item } = params;
  const targets = [item.workloadFactId, item.componentId, item.taskId]
    .filter((target): target is string => target !== null);
  // The caller supplies the active scheduler view; lifecycle filtering has one owner.
  // Preserve the source cap contract: multiple facts at the winning scope are unresolved.
  const matching = targets.map((target) => params.estimates.filter((estimate) =>
    estimate.kind === 'session_duration' && estimate.taskId === item.taskId
      && estimate.targetFactId === target))
    .find((estimates) => estimates.length > 0) ?? [];
  if (matching.length === 0) return null;
  const selected = matching.length === 1 ? matching[0] : null;
  const requested = selected?.minutes ?? null;
  const cap = requested !== null && isWeeklyPlanningSafePositiveNumberV5(requested)
    ? Math.floor(requested) : null;
  const failure = (reason: WeeklyPlanningSessionPartitionIssueV5['details']['reason'],
    requiredSessionCount?: number, minimumRequiredMinutes?: number) => ({
    kind: 'blocked' as const,
    issue: {
      code: 'session_partition_unfulfillable' as const, factId: selected?.id ?? matching[0].targetFactId,
      matchingSessionDurationFactIds: matching.map((estimate) => estimate.id),
      details: { reason, taskId: item.taskId, sessionDurationFactId: selected?.id ?? null,
        sessionDurationScopeFactId: matching[0].targetFactId,
        matchingEstimateCount: matching.length, requestedSessionMinutes: requested,
        sessionMinuteLimit: cap, maximumGeneratedSessions: WEEKLY_PLANNING_MAX_GENERATED_SESSION_CHUNKS_V5,
        workUnitCode: item.quantity.unitCode, workUnitLabel: item.quantity.unitLabel,
        quantityAmount: item.quantity.amount,
        rangeStart: item.quantity.actualRange?.start ?? null, rangeEnd: item.quantity.actualRange?.end ?? null,
        ...(requiredSessionCount === undefined ? {} : { requiredSessionCount }),
        ...(minimumRequiredMinutes === undefined ? {} : { minimumRequiredMinutes }) },
    },
  });
  if (matching.length !== 1) return failure('ambiguous_session_duration');
  if (cap === null) return failure('invalid_session_duration');
  if (cap < 1) return failure('cap_below_clock_precision', undefined, 1);
  const base = item.baseEstimatedMinutes;
  const multiplier = item.estimateBasis === 'intrinsic_duration' ? 1 : item.calibrationMultiplier ?? 1;
  const total = item.estimatedMinutes;
  if (base == null || total === null || !isWeeklyPlanningSafePositiveNumberV5(base)
    || !isWeeklyPlanningSafePositiveNumberV5(multiplier) || !isWeeklyPlanningSafePositiveNumberV5(total)) {
    return failure('missing_partition_cost');
  }
  const cost = base * multiplier;
  if (!isWeeklyPlanningSafePositiveNumberV5(cost) || Math.ceil(total) < cost) {
    return failure('unsafe_partition_arithmetic');
  }
  const sourceFactRefs = [...new Set([...item.sourceFactRefs, selected!.id])];
  const cappedItem = { ...item, sourceFactRefs };
  const timeQuantity = item.quantity.unitCode === 'minute' || item.quantity.unitCode === 'hour';
  // A whole item which already fits needs no inference about its divisibility.
  if (Math.ceil(total) <= cap && Math.ceil(cost) <= Math.ceil(total)) {
    return { kind: 'ready', items: [{ ...cappedItem, estimatedMinutes: Math.ceil(total),
      splitPolicy: timeQuantity ? item.splitPolicy : 'atomic' }] };
  }
  if (timeQuantity && item.splitPolicy === 'splittable') {
    const occupied = Math.ceil(total);
    const count = Math.ceil(occupied / cap);
    if (!Number.isSafeInteger(count) || count > WEEKLY_PLANNING_MAX_GENERATED_SESSION_CHUNKS_V5) {
      return failure('generation_limit', count);
    }
    if (occupied < cost) return failure('unsafe_partition_arithmetic');
    const chunks = Array.from({ length: count }, (_, index) => Math.min(cap, occupied - index * cap));
    return { kind: 'ready', items: executionPolicySlices({
      graph: params.graph, item: { ...cappedItem, estimatedMinutes: occupied }, explicitChunks: chunks,
    }) };
  }
  // Preserve genuine atomic work, including mock exams, and unknown/custom units.
  // Buffer alone may shrink around one intact item; content itself is never cut.
  if (Math.ceil(cost) <= cap) {
    return { kind: 'ready', items: [{ ...cappedItem, estimatedMinutes: cap, splitPolicy: 'atomic' }] };
  }
  if (item.splitPolicy === 'atomic' || item.quantity.unitCode === 'mock_exam') {
    return failure('indivisible_unit_exceeds_cap', undefined, Math.ceil(cost));
  }
  const countable = ['page', 'problem', 'word', 'lesson', 'chapter', 'section', 'exam_year']
    .includes(item.quantity.unitCode);
  if (!countable || !Number.isSafeInteger(item.quantity.amount) || item.quantity.amount <= 0) {
    return failure('unsupported_quantity_partition');
  }
  const perUnit = cost / item.quantity.amount;
  if (!isWeeklyPlanningSafePositiveNumberV5(perUnit)) return failure('unsafe_partition_arithmetic');
  const unitsPerSession = Math.min(item.quantity.amount, Math.floor(cap / perUnit));
  if (unitsPerSession < 1) return failure('indivisible_unit_exceeds_cap', undefined, Math.ceil(perUnit));
  const count = Math.ceil(item.quantity.amount / unitsPerSession);
  if (!Number.isSafeInteger(count) || count > WEEKLY_PLANNING_MAX_GENERATED_SESSION_CHUNKS_V5) {
    return failure('generation_limit', count);
  }
  if (item.quantity.actualRange && !numericActualRange(item)) return failure('unsupported_actual_range');
  // Count and emission use this single partition, never bufferedMinutes / cap.
  const quantities = distributeDiscreteQuantityAcrossWeeklyBucketsV5(item.quantity.amount, count);
  const durations = quantities.map((quantity) => Math.ceil(quantity * perUnit));
  const floorTotal = durations.reduce((sum, duration) => sum + duration, 0);
  if (!isWeeklyPlanningSafePositiveNumberV5(floorTotal) || durations.some((duration) => duration > cap)) {
    return failure('unsafe_partition_arithmetic');
  }
  const allocated = Math.max(floorTotal, Math.min(Math.ceil(total), count * cap));
  const margin = allocated - floorTotal;
  const headroom = durations.map((duration) => cap - duration);
  // Bounded water filling: large accepted values must not cause a loop per minute.
  let low = 0; let high = margin;
  while (low < high) {
    const level = low + Math.ceil((high - low) / 2);
    if (headroom.reduce((sum, room) => sum + Math.min(room, level), 0) <= margin) low = level;
    else high = level - 1;
  }
  let remainder = margin;
  durations.forEach((duration, index) => {
    const extra = Math.min(headroom[index], low);
    durations[index] = duration + extra; remainder -= extra;
  });
  durations.forEach((_, index) => {
    if (remainder > 0 && headroom[index] > low) { durations[index] += 1; remainder -= 1; }
  });
  return { kind: 'ready', items: distributedSlices({
    graph: params.graph, item: { ...cappedItem, estimatedMinutes: allocated, splitPolicy: 'atomic' },
    dates: params.dates, explicitPartition: { quantities, durations },
  }) };
}

/** Compilation sees failures before any partial or uncapped result is exposed. */
export function resolveGenericSchedulerWorkDistributionV5(params: DistributionParams & {
  sessionDurationEstimates: readonly EffortEstimateFact[];
}): WeeklyPlanningSchedulerDistributionResultV5 {
  const dates = listCalendarDatesInclusive(params.startDate, params.endDate) ?? [];
  const recurring = dates.length === 0 ? [...params.items] : params.items.flatMap((item) =>
    recurringPerOccurrenceSlices({ graph: params.graph, item, dates, hardDateBounds: params.hardDateBounds ?? [] }));
  const items: GenericPlanningWorkItem[] = [];
  const issues: WeeklyPlanningSessionPartitionIssueV5[] = [];
  for (const item of recurring) {
    const explicit = explicitSessionPartition({ graph: params.graph, item, dates, estimates: params.sessionDurationEstimates });
    if (explicit?.kind === 'blocked') { issues.push(explicit.issue); continue; }
    if (explicit) { items.push(...explicit.items); continue; }
    const daily = dates.length === 0 || item.requiredDate || !isDistributableDiscreteItem(item)
      ? [item] : distributedSlices({ graph: params.graph, item, dates });
    items.push(...daily.flatMap((slice) => executionPolicySlices({
      graph: params.graph, item: slice, preferredSessionMinutes: params.preferredSessionMinutes,
    })));
  }
  return issues.length > 0 ? { status: 'needs_resolution', items: [], issues }
    : { status: 'ready', items: orderGenericSchedulerWorkItemsByRelationsV5({ items, relations: params.graph.relations ?? [] }), issues: [] };
}
