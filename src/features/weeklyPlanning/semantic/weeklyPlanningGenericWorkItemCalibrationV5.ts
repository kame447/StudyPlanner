import {
  allocateWeeklyPlanningEffort,
} from './weeklyPlanningEffortAllocation';
import type { GenericPlanningWorkItem } from './weeklyPlanningGenericWorkItems';

export function calibrateGenericPlanningWorkItemsV5(params: {
  items: readonly GenericPlanningWorkItem[];
  calibrationMultiplier?: number | null;
}): GenericPlanningWorkItem[] {
  const multiplier = params.calibrationMultiplier;
  if (
    typeof multiplier !== 'number'
    || !Number.isFinite(multiplier)
    || multiplier <= 0
    || multiplier === 1
  ) {
    return params.items.map((item) => ({ ...item }));
  }

  return params.items.map((item) => {
    const baseEstimateMinutes = item.baseEstimatedMinutes ?? item.estimatedMinutes;
    if (
      item.estimateBasis === 'intrinsic_duration'
      || baseEstimateMinutes === null
      || !Number.isFinite(baseEstimateMinutes)
      || baseEstimateMinutes <= 0
    ) {
      return { ...item };
    }
    const allocation = allocateWeeklyPlanningEffort({
      baseEstimateMinutes,
      calibrationMultiplier: multiplier,
    });
    return {
      ...item,
      baseEstimatedMinutes: allocation.baseEstimateMinutes,
      calibrationMultiplier: allocation.calibrationMultiplier,
      roundingStepMinutes: allocation.roundingStepMinutes,
      estimatedMinutes: allocation.allocationMinutes,
    };
  });
}
