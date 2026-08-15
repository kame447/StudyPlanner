import { describe, expect, it } from 'vitest';
import {
  allocateWeeklyPlanningEffort,
  allocationStepForBaseEstimate,
  bufferedWeeklyPlanningEstimateMinutes,
  WEEKLY_PLANNING_ESTIMATE_SAFETY_BUFFER_MULTIPLIER,
} from './weeklyPlanningEffortAllocation';

describe('weekly planning effort allocation', () => {
  it('adds a ten-percent safety buffer before upward allocation', () => {
    expect(WEEKLY_PLANNING_ESTIMATE_SAFETY_BUFFER_MULTIPLIER).toBe(1.1);
    expect(bufferedWeeklyPlanningEstimateMinutes({ baseEstimateMinutes: 100 })).toBeCloseTo(110);
    const allocation = allocateWeeklyPlanningEffort({ baseEstimateMinutes: 58 });
    expect(allocation).toMatchObject({
      baseEstimateMinutes: 58,
      calibrationMultiplier: 1,
      safetyBufferMultiplier: 1.1,
      roundingStepMinutes: 5,
      allocationMinutes: 65,
    });
    expect(allocation.bufferedEstimateMinutes).toBeCloseTo(63.8);
  });

  it('uses five-minute granularity through a 60-minute base estimate', () => {
    expect(allocationStepForBaseEstimate(60)).toBe(5);
    expect(allocateWeeklyPlanningEffort({ baseEstimateMinutes: 60 })).toMatchObject({
      roundingStepMinutes: 5,
      allocationMinutes: 70,
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

  it('keeps explicit durations exact when the caller opts out of estimate buffering', () => {
    expect(allocateWeeklyPlanningEffort({
      baseEstimateMinutes: 60,
      safetyBufferMultiplier: 1,
    })).toMatchObject({
      safetyBufferMultiplier: 1,
      bufferedEstimateMinutes: 60,
      allocationMinutes: 60,
    });
  });

  it('ceil-rounds calibrated and buffered effort instead of rounding to the nearest slot', () => {
    const fivePercent = allocateWeeklyPlanningEffort({
      baseEstimateMinutes: 60,
      calibrationMultiplier: 1.05,
    });
    expect(fivePercent).toMatchObject({
      calibratedEstimateMinutes: 63,
      roundingStepMinutes: 5,
      allocationMinutes: 70,
    });
    expect(fivePercent.bufferedEstimateMinutes).toBeCloseTo(69.3);

    const fifteenPercent = allocateWeeklyPlanningEffort({
      baseEstimateMinutes: 60,
      calibrationMultiplier: 1.15,
    });
    expect(fifteenPercent).toMatchObject({
      calibratedEstimateMinutes: 69,
      roundingStepMinutes: 5,
      allocationMinutes: 80,
    });
    expect(fifteenPercent.bufferedEstimateMinutes).toBeCloseTo(75.9);

    expect(allocateWeeklyPlanningEffort({
      baseEstimateMinutes: 61,
      calibrationMultiplier: 1.05,
    })).toMatchObject({
      roundingStepMinutes: 15,
      allocationMinutes: 75,
    });
  });

  it('never lets an upward calibration or safety buffer disappear into a smaller allocation', () => {
    const baseEstimates = [5, 10, 55, 58, 60, 61, 75, 90, 120];
    const multipliers = [1.001, 1.01, 1.05, 1.15, 1.5];

    for (const baseEstimateMinutes of baseEstimates) {
      for (const calibrationMultiplier of multipliers) {
        const allocation = allocateWeeklyPlanningEffort({
          baseEstimateMinutes,
          calibrationMultiplier,
        });

        expect(allocation.calibrationMultiplier).toBeGreaterThan(1);
        expect(allocation.bufferedEstimateMinutes).toBeGreaterThan(
          allocation.calibratedEstimateMinutes,
        );
        expect(allocation.allocationMinutes).toBeGreaterThan(baseEstimateMinutes);
        expect(allocation.allocationMinutes).toBeGreaterThanOrEqual(
          allocation.bufferedEstimateMinutes,
        );
      }
    }
  });
});
