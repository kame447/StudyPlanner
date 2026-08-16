export const WEEKLY_PLANNING_STABLE_V5_NORMAL_WEEK_DAYS = 6;
export const WEEKLY_PLANNING_STABLE_V5_MIN_DAILY_WORK_MINUTES = 60;

export interface WeeklyPlanningDatePartitionV5 {
  normalDates: string[];
  reserveDates: string[];
}

export function partitionWeeklyPlanningDatesV5(
  dates: readonly string[],
): WeeklyPlanningDatePartitionV5 {
  if (dates.length === 7) {
    return {
      normalDates: dates.slice(0, WEEKLY_PLANNING_STABLE_V5_NORMAL_WEEK_DAYS),
      reserveDates: dates.slice(WEEKLY_PLANNING_STABLE_V5_NORMAL_WEEK_DAYS),
    };
  }
  return {
    normalDates: [...dates],
    reserveDates: [],
  };
}

export function preferredDistributedDateV5(params: {
  index: number;
  count: number;
  dates: readonly string[];
}): string | null {
  const { normalDates } = partitionWeeklyPlanningDatesV5(params.dates);
  if (normalDates.length === 0 || params.count <= 0) return null;
  const safeIndex = Math.max(0, Math.min(params.index, params.count - 1));
  return normalDates[safeIndex % normalDates.length] ?? null;
}

export function preferredTaskDistributedDateV5(params: {
  taskIndex: number;
  sessionIndex: number;
  sessionCount: number;
  dates: readonly string[];
}): string | null {
  const { normalDates } = partitionWeeklyPlanningDatesV5(params.dates);
  if (normalDates.length === 0 || params.sessionCount <= 0) return null;
  const safeTaskIndex = Math.max(0, Math.floor(params.taskIndex));
  const safeSessionIndex = Math.max(
    0,
    Math.min(Math.floor(params.sessionIndex), params.sessionCount - 1),
  );
  const startIndex = safeTaskIndex % normalDates.length;
  return normalDates[(startIndex + safeSessionIndex) % normalDates.length] ?? null;
}

export function resolveWeeklySpreadSessionCountV5(params: {
  totalMinutes: number;
  dates: readonly string[];
  maximumSessions?: number;
}): number {
  if (!Number.isFinite(params.totalMinutes) || params.totalMinutes <= 0) return 0;
  const { normalDates } = partitionWeeklyPlanningDatesV5(params.dates);
  if (normalDates.length === 0) return 0;
  const possibleSpreadDays = Math.max(
    1,
    Math.floor(params.totalMinutes / WEEKLY_PLANNING_STABLE_V5_MIN_DAILY_WORK_MINUTES),
  );
  return Math.min(
    normalDates.length,
    possibleSpreadDays,
    params.maximumSessions ?? Number.POSITIVE_INFINITY,
  );
}

function roundToPlanningQuantum(minutes: number, quantumMinutes = 5): number {
  return Math.round(minutes / quantumMinutes) * quantumMinutes;
}

export function distributeMinutesAcrossWeeklyBucketsV5(
  totalMinutes: number,
  bucketCount: number,
  quantumMinutes = 5,
): number[] {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0 || bucketCount <= 0) return [];
  const safeBucketCount = Math.max(1, Math.floor(bucketCount));
  const roundedAverage = roundToPlanningQuantum(
    totalMinutes / safeBucketCount,
    quantumMinutes,
  );
  const buckets = Array.from({ length: safeBucketCount }, () => roundedAverage);
  let deltaMinutes = totalMinutes - buckets.reduce((sum, minutes) => sum + minutes, 0);
  let cursor = 0;

  while (Math.abs(deltaMinutes) >= quantumMinutes && buckets.length > 0) {
    const step = deltaMinutes > 0 ? quantumMinutes : -quantumMinutes;
    buckets[cursor] += step;
    deltaMinutes -= step;
    cursor = (cursor + 1) % buckets.length;
  }

  if (deltaMinutes !== 0 && buckets.length > 0) {
    buckets[buckets.length - 1] += deltaMinutes;
  }

  return buckets.sort((left, right) => right - left);
}

export function distributeDiscreteQuantityAcrossWeeklyBucketsV5(
  totalQuantity: number,
  bucketCount: number,
): number[] {
  if (!Number.isInteger(totalQuantity) || totalQuantity <= 0 || bucketCount <= 0) return [];
  const safeBucketCount = Math.min(totalQuantity, Math.max(1, Math.floor(bucketCount)));
  const base = Math.floor(totalQuantity / safeBucketCount);
  const remainder = totalQuantity % safeBucketCount;
  return Array.from(
    { length: safeBucketCount },
    (_, index) => base + (index < remainder ? 1 : 0),
  );
}
