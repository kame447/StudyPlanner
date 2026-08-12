import type { GenericSchedulerTaskRelation } from './weeklyPlanningGenericSchedulerInput';
import { partitionWeeklyPlanningDatesV5 } from './weeklyPlanningStableV5DistributionPolicy';

export interface WeeklyPlanningPlacedTaskBlockV5 {
  taskId: string;
  date: string;
  startTime: string;
  endTime: string;
}

export interface WeeklyPlanningPlacementNotBeforeV5 {
  date: string;
  time: string;
}

function timeToMinutes(value: string): number {
  if (value === '24:00') return 24 * 60;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function compareDateTime(
  left: WeeklyPlanningPlacementNotBeforeV5,
  right: WeeklyPlanningPlacementNotBeforeV5,
): number {
  const dateOrder = left.date.localeCompare(right.date);
  if (dateOrder !== 0) return dateOrder;
  return timeToMinutes(left.time) - timeToMinutes(right.time);
}

export function laterNotBeforeV5(
  left: WeeklyPlanningPlacementNotBeforeV5 | undefined,
  right: WeeklyPlanningPlacementNotBeforeV5 | undefined,
): WeeklyPlanningPlacementNotBeforeV5 | undefined {
  if (!left) return right ? { ...right } : undefined;
  if (!right) return { ...left };
  return compareDateTime(left, right) >= 0 ? { ...left } : { ...right };
}

function predecessorTaskIds(params: {
  taskId: string;
  relations: readonly GenericSchedulerTaskRelation[];
}): string[] {
  const ids = new Set<string>();
  params.relations.forEach((relation) => {
    if ((relation.kind === 'before' || relation.kind === 'sequence')
      && relation.toTaskId === params.taskId) {
      ids.add(relation.fromTaskId);
    }
    if ((relation.kind === 'after' || relation.kind === 'depends_on')
      && relation.fromTaskId === params.taskId) {
      ids.add(relation.toTaskId);
    }
  });
  return [...ids];
}

export function relationNotBeforeV5(params: {
  taskId: string;
  relations: readonly GenericSchedulerTaskRelation[];
  placedBlocks: readonly WeeklyPlanningPlacedTaskBlockV5[];
  fixedTaskEnds?: ReadonlyMap<string, WeeklyPlanningPlacementNotBeforeV5>;
}): WeeklyPlanningPlacementNotBeforeV5 | undefined {
  let result: WeeklyPlanningPlacementNotBeforeV5 | undefined;
  for (const predecessorTaskId of predecessorTaskIds(params)) {
    const candidateEnds = params.placedBlocks
      .filter((block) => block.taskId === predecessorTaskId)
      .map((block) => ({ date: block.date, time: block.endTime }));
    const fixedEnd = params.fixedTaskEnds?.get(predecessorTaskId);
    if (fixedEnd) candidateEnds.push(fixedEnd);
    for (const end of candidateEnds) result = laterNotBeforeV5(result, end);
  }
  return result;
}

export function taskOrdinalMapV5(
  taskIdsInCanonicalOrder: readonly string[],
): Map<string, number> {
  const result = new Map<string, number>();
  taskIdsInCanonicalOrder.forEach((taskId) => {
    if (!result.has(taskId)) result.set(taskId, result.size);
  });
  return result;
}

export function targetDailyLoadMinutesV5(params: {
  totalMovableMinutes: number;
  dates: readonly string[];
}): number {
  const { normalDates } = partitionWeeklyPlanningDatesV5(params.dates);
  if (normalDates.length === 0 || params.totalMovableMinutes <= 0) return 0;
  return params.totalMovableMinutes / normalDates.length;
}

export function normalDailyLoadSoftCapMinutesV5(params: {
  totalMovableMinutes: number;
  dates: readonly string[];
}): number {
  return targetDailyLoadMinutesV5(params) * 1.5;
}

export function orderPlacementDatesV5(params: {
  allowedDates: readonly string[];
  allDates: readonly string[];
  preferredDate: string | null;
  dayLoads: ReadonlyMap<string, number>;
  durationMinutes: number;
  totalMovableMinutes: number;
}): string[] {
  const { normalDates, reserveDates } = partitionWeeklyPlanningDatesV5(params.allDates);
  const normalSet = new Set(normalDates);
  const reserveSet = new Set(reserveDates);
  const target = targetDailyLoadMinutesV5({
    totalMovableMinutes: params.totalMovableMinutes,
    dates: params.allDates,
  });
  const softCap = normalDailyLoadSoftCapMinutesV5({
    totalMovableMinutes: params.totalMovableMinutes,
    dates: params.allDates,
  });
  const preferredIndex = params.preferredDate
    ? params.allDates.indexOf(params.preferredDate)
    : -1;

  return [...params.allowedDates].sort((left, right) => {
    if (left === params.preferredDate) return right === params.preferredDate ? 0 : -1;
    if (right === params.preferredDate) return 1;

    const leftReserve = reserveSet.has(left) ? 1 : normalSet.has(left) ? 0 : 1;
    const rightReserve = reserveSet.has(right) ? 1 : normalSet.has(right) ? 0 : 1;
    if (leftReserve !== rightReserve) return leftReserve - rightReserve;

    const leftProjected = (params.dayLoads.get(left) ?? 0) + params.durationMinutes;
    const rightProjected = (params.dayLoads.get(right) ?? 0) + params.durationMinutes;
    const leftOverCap = normalSet.has(left) && softCap > 0 && leftProjected > softCap ? 1 : 0;
    const rightOverCap = normalSet.has(right) && softCap > 0 && rightProjected > softCap ? 1 : 0;
    if (leftOverCap !== rightOverCap) return leftOverCap - rightOverCap;

    const leftDistance = target > 0 ? Math.abs(leftProjected - target) : leftProjected;
    const rightDistance = target > 0 ? Math.abs(rightProjected - target) : rightProjected;
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;

    const loadDelta = (params.dayLoads.get(left) ?? 0) - (params.dayLoads.get(right) ?? 0);
    if (loadDelta !== 0) return loadDelta;

    if (preferredIndex >= 0) {
      const leftPreferredDistance = Math.abs(params.allDates.indexOf(left) - preferredIndex);
      const rightPreferredDistance = Math.abs(params.allDates.indexOf(right) - preferredIndex);
      if (leftPreferredDistance !== rightPreferredDistance) {
        return leftPreferredDistance - rightPreferredDistance;
      }
    }
    return left.localeCompare(right);
  });
}

export function leavesTinyWindowFragmentV5(params: {
  windowStart: number;
  windowEnd: number;
  candidateStart: number;
  durationMinutes: number;
  minimumUsefulFragmentMinutes?: number;
}): boolean {
  const minimum = params.minimumUsefulFragmentMinutes ?? 30;
  const before = params.candidateStart - params.windowStart;
  const after = params.windowEnd - (params.candidateStart + params.durationMinutes);
  return (before > 0 && before < minimum) || (after > 0 && after < minimum);
}
