import type { WeeklyPlanningLearningStrategyProposalRecord } from '../intake/weeklyPlanningIntakeTypes';
import type {
  GenericSchedulerInputCompilationResult,
  WeeklyPlanningGenericSchedulerGraphView,
} from './weeklyPlanningGenericSchedulerInput';
import type { GenericPlanningWorkItem } from './weeklyPlanningGenericWorkItems';
import {
  bufferedWeeklyPlanningEstimateMinutes,
} from './weeklyPlanningEffortAllocation';

function targetLabel(
  graph: WeeklyPlanningGenericSchedulerGraphView,
  item: GenericPlanningWorkItem,
): string {
  if (item.componentId) {
    const component = graph.components.find((candidate) => candidate.id === item.componentId);
    if (component?.label.trim()) return component.label.trim();
  }
  return graph.tasks.find((candidate) => candidate.id === item.taskId)?.title.trim() || item.label;
}

function splitIntoFullSessions(params: {
  baseEstimateMinutes: number;
  calibrationMultiplier: number;
  sessionMinutes: number;
}): number[] {
  const session = Math.max(1, Math.round(params.sessionMinutes));
  const bufferedEstimate = bufferedWeeklyPlanningEstimateMinutes({
    baseEstimateMinutes: params.baseEstimateMinutes,
    calibrationMultiplier: params.calibrationMultiplier,
  });
  const sessionCount = Math.max(1, Math.ceil(bufferedEstimate / session));
  return Array.from({ length: sessionCount }, () => session);
}

function allocateIntegerQuantity(totalAmount: number, durations: readonly number[]): number[] {
  if (durations.length === 0) return [];
  if (durations.length === 1) return [totalAmount];
  const totalMinutes = durations.reduce((sum, duration) => sum + duration, 0);
  const guaranteed = totalAmount >= durations.length ? 1 : 0;
  const remaining = totalAmount - guaranteed * durations.length;
  const weighted = durations.map((duration, index) => {
    const raw = remaining * (duration / totalMinutes);
    return { index, base: Math.floor(raw), fraction: raw - Math.floor(raw) };
  });
  const result = weighted.map((entry) => entry.base + guaranteed);
  let undistributed = totalAmount - result.reduce((sum, amount) => sum + amount, 0);
  weighted
    .slice()
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index)
    .forEach((entry) => {
      if (undistributed <= 0) return;
      result[entry.index] += 1;
      undistributed -= 1;
    });
  return result;
}

function allocateQuantity(totalAmount: number, durations: readonly number[]): number[] {
  if (Number.isInteger(totalAmount) && totalAmount >= 0) {
    return allocateIntegerQuantity(totalAmount, durations);
  }
  const totalMinutes = durations.reduce((sum, duration) => sum + duration, 0);
  let consumed = 0;
  return durations.map((duration, index) => {
    if (index === durations.length - 1) return Math.max(0, totalAmount - consumed);
    const amount = totalAmount * (duration / totalMinutes);
    consumed += amount;
    return amount;
  });
}

function displayQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function aggregateDistributedItems(items: readonly GenericPlanningWorkItem[]): GenericPlanningWorkItem | null {
  if (items.length === 0) return null;
  const first = items[0];
  const estimatedMinutes = items.every((item) => item.estimatedMinutes !== null)
    ? items.reduce((sum, item) => sum + (item.estimatedMinutes ?? 0), 0)
    : null;
  const baseEstimatedMinutes = items.every(
    (item) => item.baseEstimatedMinutes !== null && item.baseEstimatedMinutes !== undefined,
  )
    ? items.reduce((sum, item) => sum + (item.baseEstimatedMinutes ?? 0), 0)
    : first.baseEstimatedMinutes;
  const requiredDates = new Set(items.map((item) => item.requiredDate ?? null));
  return {
    ...first,
    id: `${first.workloadFactId}:accepted-memory-aggregate`,
    quantity: {
      ...first.quantity,
      amount: items.reduce((sum, item) => sum + item.quantity.amount, 0),
      ordinalRange: null,
      actualRange: null,
    },
    estimatedMinutes,
    baseEstimatedMinutes,
    requiredDate: requiredDates.size === 1 ? first.requiredDate : undefined,
    sourceFactRefs: [...new Set(items.flatMap((item) => item.sourceFactRefs))],
    plannedSessions: undefined,
    splitPolicy: 'unknown',
  };
}

function sessionizeItem(params: {
  graph: WeeklyPlanningGenericSchedulerGraphView;
  item: GenericPlanningWorkItem;
  sessionMinutes: number;
}): GenericPlanningWorkItem[] {
  const baseEstimateMinutes = params.item.baseEstimatedMinutes ?? params.item.estimatedMinutes;
  if (
    baseEstimateMinutes === null
    || !Number.isFinite(baseEstimateMinutes)
    || baseEstimateMinutes <= 0
    || !Number.isFinite(params.sessionMinutes)
    || params.sessionMinutes <= 0
  ) return [params.item];

  const calibrationMultiplier = (
    params.item.calibrationMultiplier !== null
    && params.item.calibrationMultiplier !== undefined
    && Number.isFinite(params.item.calibrationMultiplier)
    && params.item.calibrationMultiplier > 0
  ) ? params.item.calibrationMultiplier : 1;
  const durations = splitIntoFullSessions({
    baseEstimateMinutes,
    calibrationMultiplier,
    sessionMinutes: params.sessionMinutes,
  });
  const quantities = allocateQuantity(params.item.quantity.amount, durations);
  const totalAllocatedMinutes = durations.reduce((sum, duration) => sum + duration, 0);
  const label = targetLabel(params.graph, params.item);

  return durations.map((durationMinutes, index) => {
    const quantityAmount = quantities[index] ?? 0;
    const baseEstimatedMinutesForSession = params.item.baseEstimatedMinutes === null
      || params.item.baseEstimatedMinutes === undefined
      ? params.item.baseEstimatedMinutes
      : params.item.baseEstimatedMinutes * (durationMinutes / totalAllocatedMinutes);
    return {
      ...params.item,
      id: `${params.item.id}:accepted-memory-session:${index + 1}`,
      label: `${label} ${displayQuantity(quantityAmount)}${params.item.quantity.unitLabel}（${index + 1}/${durations.length}）`,
      quantity: {
        ...params.item.quantity,
        amount: quantityAmount,
        ordinalRange: null,
        actualRange: null,
      },
      estimatedMinutes: durationMinutes,
      baseEstimatedMinutes: baseEstimatedMinutesForSession,
      plannedSessions: undefined,
      splitPolicy: 'atomic',
    };
  });
}

export function applyAcceptedMemorySessionProjectionV5(params: {
  compilation: GenericSchedulerInputCompilationResult;
  graph: WeeklyPlanningGenericSchedulerGraphView;
  acceptedSpacedProposal: WeeklyPlanningLearningStrategyProposalRecord | null;
  acceptedCalibrationProposal: WeeklyPlanningLearningStrategyProposalRecord | null;
}): GenericSchedulerInputCompilationResult {
  if (
    !params.compilation.input
    || !params.acceptedSpacedProposal
    || params.acceptedCalibrationProposal
  ) return params.compilation;

  const workloadFactId = params.acceptedSpacedProposal.workloadFactId;
  const sessionEfforts = params.graph.effortEstimates.filter((estimate) =>
    estimate.targetFactId === workloadFactId
    && estimate.kind === 'session_duration'
    && Number.isFinite(estimate.minutes)
    && estimate.minutes > 0);
  if (sessionEfforts.length !== 1) return params.compilation;

  const matchingItems = params.compilation.input.movableWorkItems.filter(
    (item) => item.workloadFactId === workloadFactId,
  );
  const aggregate = aggregateDistributedItems(matchingItems);
  if (!aggregate) return params.compilation;
  const sessions = sessionizeItem({
    graph: params.graph,
    item: aggregate,
    sessionMinutes: sessionEfforts[0].minutes,
  });

  const firstIndex = params.compilation.input.movableWorkItems.findIndex(
    (item) => item.workloadFactId === workloadFactId,
  );
  const otherItems = params.compilation.input.movableWorkItems.filter(
    (item) => item.workloadFactId !== workloadFactId,
  );
  const insertionIndex = Math.max(0, Math.min(firstIndex, otherItems.length));
  const movableWorkItems = [
    ...otherItems.slice(0, insertionIndex),
    ...sessions,
    ...otherItems.slice(insertionIndex),
  ];

  return {
    ...params.compilation,
    input: {
      ...params.compilation.input,
      movableWorkItems,
    },
  };
}
