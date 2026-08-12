import type { PlanType } from '../../../types/domain';
import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';
import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import type { GenericPlanningWorkItem } from './weeklyPlanningGenericWorkItems';
import type { GenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import {
  minutesFromPlacementTime,
  placementTimeFromMinutes,
  type MinuteInterval,
} from './weeklyPlanningStableV5PlacementAvailability';
import {
  laterNotBeforeV5,
  type WeeklyPlanningPlacementNotBeforeV5,
  type WeeklyPlanningPlacedTaskBlockV5,
} from './weeklyPlanningStableV5PlacementPolicy';

export interface WeeklyPlanningStableV5CandidateMetadata {
  runtime: 'stable_v5';
  conversationId: string;
  graphRevision: number;
  taskId: string;
  sourceFactRefs: string[];
  planType: PlanType;
  sessionRole?: 'learning' | 'review';
  reviewRound?: 1 | 2;
}

function taskForCandidate(
  graph: WeeklyPlanningFactGraphV5,
  taskId: string,
) {
  const task = graph.tasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    throw new Error(`Stable V5 placement candidate task was not found: ${taskId}`);
  }
  return task;
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

export function workItemGroupPositions(
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

export function fixedTaskPlacementEnds(
  input: GenericSchedulerInput,
): Map<string, WeeklyPlanningPlacementNotBeforeV5> {
  const result = new Map<string, WeeklyPlanningPlacementNotBeforeV5>();
  input.fixedTaskReservations.forEach((reservation) => {
    const candidate = { date: reservation.end.date, time: reservation.end.time };
    const previous = result.get(reservation.taskId);
    result.set(reservation.taskId, laterNotBeforeV5(previous, candidate)!);
  });
  return result;
}

export function createPlacementCandidate(params: {
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
  const task = taskForCandidate(params.graph, params.item.taskId);
  const planType: PlanType = task.category === 'study' ? 'study' : 'other';
  const metadata: WeeklyPlanningStableV5CandidateMetadata = {
    runtime: 'stable_v5',
    conversationId: task.source.conversationId,
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
    startTime: placementTimeFromMinutes(params.slot.start),
    endTime: placementTimeFromMinutes(params.slot.end),
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

export function addPlacedSlot(params: {
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

export function rollbackPlacementCandidates(params: {
  candidates: readonly WeeklyDraftCandidate[];
  busy: MinuteInterval[];
  dayLoads: Map<string, number>;
}): void {
  params.candidates.forEach((candidate) => {
    const start = minutesFromPlacementTime(candidate.startTime);
    const end = minutesFromPlacementTime(candidate.endTime);
    const index = params.busy.findIndex((interval) =>
      interval.date === candidate.date && interval.start === start && interval.end === end);
    if (index >= 0) params.busy.splice(index, 1);
    params.dayLoads.set(
      candidate.date,
      Math.max(0, (params.dayLoads.get(candidate.date) ?? 0) - candidate.durationMinutes),
    );
  });
}

export function sortPlacementCandidates(
  candidates: WeeklyDraftCandidate[],
): WeeklyDraftCandidate[] {
  return candidates.slice().sort((left, right) =>
    left.date.localeCompare(right.date)
    || left.startTime.localeCompare(right.startTime)
    || left.stableKey.localeCompare(right.stableKey));
}

export function placementCandidateBlocks(
  candidates: readonly WeeklyDraftCandidate[],
): WeeklyPlanningPlacedTaskBlockV5[] {
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
