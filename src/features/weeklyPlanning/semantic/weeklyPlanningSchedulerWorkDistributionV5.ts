import type {
  PlanningTaskFact,
  RecurrenceFact,
  StudyComponentFact,
  StudyContextFact,
  TaskRelationFact,
  WorkloadFact,
} from './weeklyPlanningFactGraph';
import type { GenericPlanningWorkItem } from './weeklyPlanningGenericWorkItems';
import {
  calendarWeekday,
  listCalendarDatesInclusive,
} from './weeklyPlanningCalendarResolver';
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
  readonly workloads: ReadonlyArray<WorkloadFact>;
  readonly recurrences: ReadonlyArray<RecurrenceFact>;
  readonly relations?: ReadonlyArray<TaskRelationFact>;
}

function recurrenceDates(
  recurrence: RecurrenceFact,
  dates: readonly string[],
): string[] | null {
  if (recurrence.kind === 'daily') return [...dates];
  if (recurrence.kind === 'weekdays') {
    return dates.filter((date) => {
      const weekday = calendarWeekday(date);
      return weekday !== null && weekday >= 1 && weekday <= 5;
    });
  }
  if (recurrence.kind === 'weekends') {
    return dates.filter((date) => {
      const weekday = calendarWeekday(date);
      return weekday === 0 || weekday === 6;
    });
  }
  return null;
}

function recurringPerOccurrenceSlices(params: {
  graph: WeeklyPlanningSchedulerDistributionGraphViewV5;
  item: GenericPlanningWorkItem;
  dates: readonly string[];
}): GenericPlanningWorkItem[] {
  const workload = params.graph.workloads.find(
    (candidate) => candidate.id === params.item.workloadFactId,
  );
  if (!workload?.perOccurrence) return [params.item];

  const targetFactId = params.item.componentId ?? params.item.taskId;
  const recurrences = params.graph.recurrences.filter((recurrence) =>
    recurrence.taskId === params.item.taskId
    && recurrence.targetFactId === targetFactId);
  if (recurrences.length !== 1) return [params.item];

  const recurrence = recurrences[0];
  const occurrenceDates = recurrenceDates(recurrence, params.dates);
  if (occurrenceDates === null) return [params.item];

  return occurrenceDates.map((date) => ({
    ...params.item,
    id: `${params.item.id}:recurrence:${recurrence.id}:${date}`,
    requiredDate: date,
    sourceFactRefs: [...new Set([...params.item.sourceFactRefs, recurrence.id])],
  }));
}

function isDistributableDiscreteItem(item: GenericPlanningWorkItem): boolean {
  return (item.quantity.unitCode === 'page'
      || item.quantity.unitCode === 'problem'
      || item.quantity.unitCode === 'word')
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
}): GenericPlanningWorkItem[] {
  const sessionCount = resolveWeeklySpreadSessionCountV5({
    totalMinutes: params.item.estimatedMinutes ?? 0,
    dates: params.dates,
    maximumSessions: params.item.quantity.amount,
  });
  if (sessionCount <= 1) return [params.item];

  const durations = distributeMinutesAcrossWeeklyBucketsV5(
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
  const chunks = splitWeeklyPlanningSessionMinutesV5({
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
    const displayQuantity = params.item.quantity.unitCode === 'minute'
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
  preferredSessionMinutes?: number | null;
}): GenericPlanningWorkItem[] {
  const dates = listCalendarDatesInclusive(params.startDate, params.endDate) ?? [];
  const recurrenceDistributed = dates.length === 0
    ? [...params.items]
    : params.items.flatMap((item) => recurringPerOccurrenceSlices({
        graph: params.graph,
        item,
        dates,
      }));
  const dayDistributed = dates.length === 0
    ? recurrenceDistributed
    : recurrenceDistributed.flatMap((item) => {
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
    }));
  return orderGenericSchedulerWorkItemsByRelationsV5({
    items: sessionDistributed,
    relations: params.graph.relations ?? [],
  });
}
