import type {
  PlanningTaskFact,
  StudyComponentFact,
} from './weeklyPlanningFactGraph';
import type { GenericPlanningWorkItem } from './weeklyPlanningGenericWorkItems';
import { listCalendarDatesInclusive } from './weeklyPlanningCalendarResolver';
import {
  distributeDiscreteQuantityAcrossWeeklyBucketsV5,
  distributeMinutesAcrossWeeklyBucketsV5,
  resolveWeeklySpreadSessionCountV5,
} from './weeklyPlanningStableV5DistributionPolicy';

export interface WeeklyPlanningSchedulerDistributionGraphViewV5 {
  readonly tasks: ReadonlyArray<PlanningTaskFact>;
  readonly components: ReadonlyArray<StudyComponentFact>;
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

export function distributeGenericSchedulerWorkItemsV5(params: {
  graph: WeeklyPlanningSchedulerDistributionGraphViewV5;
  items: readonly GenericPlanningWorkItem[];
  startDate: string;
  endDate: string;
}): GenericPlanningWorkItem[] {
  const dates = listCalendarDatesInclusive(params.startDate, params.endDate) ?? [];
  if (dates.length === 0) return [...params.items];
  return params.items.flatMap((item) =>
    isDistributableDiscreteItem(item)
      ? distributedSlices({ graph: params.graph, item, dates })
      : [item]);
}
