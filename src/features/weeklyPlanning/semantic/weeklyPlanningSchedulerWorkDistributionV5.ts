import type {
  PlanningTaskFact,
  StudyComponentFact,
  StudyContextFact,
  TaskRelationFact,
  WorkloadFact,
} from './weeklyPlanningFactGraph';
import type { GenericPlanningWorkItem } from './weeklyPlanningGenericWorkItems';
import { listCalendarDatesInclusive } from './weeklyPlanningCalendarResolver';
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

export interface WeeklyPlanningSchedulerDistributionGraphViewV5 {
  readonly tasks: ReadonlyArray<PlanningTaskFact>;
  readonly studyContexts?: ReadonlyArray<StudyContextFact>;
  readonly components: ReadonlyArray<StudyComponentFact>;
  readonly workloads: ReadonlyArray<WorkloadFact>;
  readonly relations?: ReadonlyArray<TaskRelationFact>;
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

function relationEdge(
  relation: TaskRelationFact,
): { before: string; after: string } | null {
  switch (relation.kind) {
    case 'before':
    case 'sequence':
    case 'priority_over':
      return { before: relation.fromTaskId, after: relation.toTaskId };
    case 'after':
    case 'depends_on':
      return { before: relation.toTaskId, after: relation.fromTaskId };
    default:
      return null;
  }
}

export function orderGenericSchedulerWorkItemsByRelationsV5(params: {
  items: readonly GenericPlanningWorkItem[];
  relations: readonly TaskRelationFact[];
}): GenericPlanningWorkItem[] {
  if (params.items.length <= 1 || params.relations.length === 0) return [...params.items];
  const firstTaskIndex = new Map<string, number>();
  params.items.forEach((item, index) => {
    if (!firstTaskIndex.has(item.taskId)) firstTaskIndex.set(item.taskId, index);
  });
  const taskIds = [...firstTaskIndex.keys()];
  const taskSet = new Set(taskIds);
  const outgoing = new Map<string, Set<string>>(taskIds.map((taskId) => [taskId, new Set()]));
  const indegree = new Map<string, number>(taskIds.map((taskId) => [taskId, 0]));

  params.relations.forEach((relation) => {
    const edge = relationEdge(relation);
    if (!edge || !taskSet.has(edge.before) || !taskSet.has(edge.after) || edge.before === edge.after) return;
    const targets = outgoing.get(edge.before)!;
    if (targets.has(edge.after)) return;
    targets.add(edge.after);
    indegree.set(edge.after, (indegree.get(edge.after) ?? 0) + 1);
  });

  const ready = taskIds
    .filter((taskId) => (indegree.get(taskId) ?? 0) === 0)
    .sort((left, right) => (firstTaskIndex.get(left) ?? 0) - (firstTaskIndex.get(right) ?? 0));
  const orderedTaskIds: string[] = [];
  while (ready.length > 0) {
    const taskId = ready.shift()!;
    orderedTaskIds.push(taskId);
    for (const target of outgoing.get(taskId) ?? []) {
      const nextIndegree = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, nextIndegree);
      if (nextIndegree === 0) {
        ready.push(target);
        ready.sort((left, right) =>
          (firstTaskIndex.get(left) ?? 0) - (firstTaskIndex.get(right) ?? 0));
      }
    }
  }

  if (orderedTaskIds.length !== taskIds.length) return [...params.items];
  const taskRank = new Map(orderedTaskIds.map((taskId, index) => [taskId, index]));
  return params.items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const rankDelta = (taskRank.get(left.item.taskId) ?? Number.MAX_SAFE_INTEGER)
        - (taskRank.get(right.item.taskId) ?? Number.MAX_SAFE_INTEGER);
      return rankDelta !== 0 ? rankDelta : left.index - right.index;
    })
    .map(({ item }) => item);
}

export function distributeGenericSchedulerWorkItemsV5(params: {
  graph: WeeklyPlanningSchedulerDistributionGraphViewV5;
  items: readonly GenericPlanningWorkItem[];
  startDate: string;
  endDate: string;
  preferredSessionMinutes?: number | null;
}): GenericPlanningWorkItem[] {
  const dates = listCalendarDatesInclusive(params.startDate, params.endDate) ?? [];
  const dayDistributed = dates.length === 0
    ? [...params.items]
    : params.items.flatMap((item) =>
        isDistributableDiscreteItem(item)
          ? distributedSlices({ graph: params.graph, item, dates })
          : [item]);
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
