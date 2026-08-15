export const WEEKLY_PLANNING_EFFORT_ALLOCATION_VERSION =
  'weekly-planning-effort-allocation-v2' as const;

export const WEEKLY_PLANNING_ESTIMATE_SAFETY_BUFFER_MULTIPLIER = 1.1 as const;

export type WeeklyPlanningAllocationStepMinutes = 5 | 15;

export interface WeeklyPlanningEffortAllocation {
  version: typeof WEEKLY_PLANNING_EFFORT_ALLOCATION_VERSION;
  baseEstimateMinutes: number;
  calibrationMultiplier: number;
  calibratedEstimateMinutes: number;
  safetyBufferMultiplier: number;
  bufferedEstimateMinutes: number;
  roundingStepMinutes: WeeklyPlanningAllocationStepMinutes;
  allocationMinutes: number;
}

function positiveFinite(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function bufferedWeeklyPlanningEstimateMinutes(params: {
  baseEstimateMinutes: number;
  calibrationMultiplier?: number;
  safetyBufferMultiplier?: number;
}): number {
  const baseEstimateMinutes = positiveFinite(params.baseEstimateMinutes, 0);
  const calibrationMultiplier = positiveFinite(params.calibrationMultiplier ?? 1, 1);
  const safetyBufferMultiplier = positiveFinite(
    params.safetyBufferMultiplier ?? WEEKLY_PLANNING_ESTIMATE_SAFETY_BUFFER_MULTIPLIER,
    WEEKLY_PLANNING_ESTIMATE_SAFETY_BUFFER_MULTIPLIER,
  );
  return baseEstimateMinutes * calibrationMultiplier * safetyBufferMultiplier;
}

export function allocationStepForBaseEstimate(
  baseEstimateMinutes: number,
): WeeklyPlanningAllocationStepMinutes {
  return baseEstimateMinutes <= 60 ? 5 : 15;
}

export function allocateWeeklyPlanningEffort(params: {
  baseEstimateMinutes: number;
  calibrationMultiplier?: number;
  safetyBufferMultiplier?: number;
}): WeeklyPlanningEffortAllocation {
  const baseEstimateMinutes = positiveFinite(params.baseEstimateMinutes, 0);
  const calibrationMultiplier = positiveFinite(params.calibrationMultiplier ?? 1, 1);
  const calibratedEstimateMinutes = baseEstimateMinutes * calibrationMultiplier;
  const safetyBufferMultiplier = positiveFinite(
    params.safetyBufferMultiplier ?? WEEKLY_PLANNING_ESTIMATE_SAFETY_BUFFER_MULTIPLIER,
    WEEKLY_PLANNING_ESTIMATE_SAFETY_BUFFER_MULTIPLIER,
  );
  const bufferedEstimateMinutes = bufferedWeeklyPlanningEstimateMinutes({
    baseEstimateMinutes,
    calibrationMultiplier,
    safetyBufferMultiplier,
  });
  const roundingStepMinutes = allocationStepForBaseEstimate(baseEstimateMinutes);
  const allocationMinutes = bufferedEstimateMinutes > 0
    ? Math.ceil(bufferedEstimateMinutes / roundingStepMinutes) * roundingStepMinutes
    : 0;
  return {
    version: WEEKLY_PLANNING_EFFORT_ALLOCATION_VERSION,
    baseEstimateMinutes,
    calibrationMultiplier,
    calibratedEstimateMinutes,
    safetyBufferMultiplier,
    bufferedEstimateMinutes,
    roundingStepMinutes,
    allocationMinutes,
  };
}
