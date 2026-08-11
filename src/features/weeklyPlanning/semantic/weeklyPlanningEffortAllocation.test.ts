import { describe, expect, it } from 'vitest';
import {
  allocateWeeklyPlanningEffort,
  allocationStepForBaseEstimate,
} from './weeklyPlanningEffortAllocation';

describe('weekly planning effort allocation', () => {
  it('uses five-minute granularity through a 60-minute base estimate', () => {
    expect(allocationStepForBaseEstimate(60)).toBe(5);
    expect(allocateWeeklyPlanningEffort({ baseEstimateMinutes: 58 })).toMatchObject({
      baseEstimateMinutes: 58,
      calibrationMultiplier: 1,
      roundingStepMinutes: 5,
      allocationMinutes: 60,
    });
    expect(allocateWeeklyPlanningEffort({ baseEstimateMinutes: 60 })).toMatchObject({
      roundingStepMinutes: 5,
      allocationMinutes: 60,
    });
  });

  it('switches to fifteen-minute granularity above 60 minutes and only rounds upward', () => {
    expect(allocationStepForBaseEstimate(61)).toBe(15);
    expect(allocateWeeklyPlanningEffort({ baseEstimateMinutes: 61 })).toMatchObject({
      baseEstimateMinutes: 61,
      roundingStepMinutes: 15,
      allocationMinutes: 75,
    });
    expect(allocateWeeklyPlanningEffort({ baseEstimateMinutes: 76 })).toMatchObject({
      roundingStepMinutes: 15,
      allocationMinutes: 90,
    });
  });

  it('ceil-rounds calibrated effort instead of rounding to the nearest slot', () => {
    expect(allocateWeeklyPlanningEffort({
      baseEstimateMinutes: 60,
      calibrationMultiplier: 1.05,
    })).toMatchObject({
      calibratedEstimateMinutes: 63,
      roundingStepMinutes: 5,
      allocationMinutes: 65,
    });

    expect(allocateWeeklyPlanningEffort({
      baseEstimateMinutes: 60,
      calibrationMultiplier: 1.15,
    })).toMatchObject({
      calibratedEstimateMinutes: 69,
      roundingStepMinutes: 5,
      allocationMinutes: 70,
    });

    expect(allocateWeeklyPlanningEffort({
      baseEstimateMinutes: 61,
      calibrationMultiplier: 1.05,
    })).toMatchObject({
      roundingStepMinutes: 15,
      allocationMinutes: 75,
    });
  });

  it('never lets an upward calibration disappear into the same base allocation', () => {
    const baseEstimates = [5, 10, 55, 58, 60, 61, 75, 90, 120];
    const multipliers = [1.001, 1.01, 1.05, 1.15, 1.5];

    for (const baseEstimateMinutes of baseEstimates) {
      for (const calibrationMultiplier of multipliers) {
        const allocation = allocateWeeklyPlanningEffort({
          baseEstimateMinutes,
          calibrationMultiplier,
        });

        expect(allocation.calibrationMultiplier).toBeGreaterThan(1);
        expect(allocation.allocationMinutes).toBeGreaterThan(baseEstimateMinutes);
        expect(allocation.allocationMinutes).toBeGreaterThanOrEqual(
          allocation.calibratedEstimateMinutes,
        );
      }
    }
  });
});
