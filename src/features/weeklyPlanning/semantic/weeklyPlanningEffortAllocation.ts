export const WEEKLY_PLANNING_EFFORT_ALLOCATION_VERSION =
  'weekly-planning-effort-allocation-v1' as const;

export type WeeklyPlanningAllocationStepMinutes = 5 | 15;

export interface WeeklyPlanningEffortAllocation {
  version: typeof WEEKLY_PLANNING_EFFORT_ALLOCATION_VERSION;
  baseEstimateMinutes: number;
  calibrationMultiplier: number;
  calibratedEstimateMinutes: number;
  roundingStepMinutes: WeeklyPlanningAllocationStepMinutes;
  allocationMinutes: number;
}

function positiveFinite(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function allocationStepForBaseEstimate(
  baseEstimateMinutes: number,
): WeeklyPlanningAllocationStepMinutes {
  return baseEstimateMinutes <= 60 ? 5 : 15;
}

export function allocateWeeklyPlanningEffort(params: {
  baseEstimateMinutes: number;
  calibrationMultiplier?: number;
}): WeeklyPlanningEffortAllocation {
  const baseEstimateMinutes = positiveFinite(params.baseEstimateMinutes, 0);
  const calibrationMultiplier = positiveFinite(params.calibrationMultiplier ?? 1, 1);
  const calibratedEstimateMinutes = baseEstimateMinutes * calibrationMultiplier;
  const roundingStepMinutes = allocationStepForBaseEstimate(baseEstimateMinutes);
  const allocationMinutes = calibratedEstimateMinutes > 0
    ? Math.ceil(calibratedEstimateMinutes / roundingStepMinutes) * roundingStepMinutes
    : 0;
  return {
    version: WEEKLY_PLANNING_EFFORT_ALLOCATION_VERSION,
    baseEstimateMinutes,
    calibrationMultiplier,
    calibratedEstimateMinutes,
    roundingStepMinutes,
    allocationMinutes,
  };
}
