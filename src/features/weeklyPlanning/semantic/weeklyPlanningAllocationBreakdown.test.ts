import { describe, expect, it } from 'vitest';
import { allocateWeeklyPlanningEffort } from './weeklyPlanningEffortAllocation';
import type { GenericPlanningWorkItem } from './weeklyPlanningGenericWorkItems';
import {
  allocationBreakdownForWeeklyPlanningWorkItem,
  summarizeWeeklyPlanningAllocationBreakdown,
} from './weeklyPlanningAllocationBreakdown';

function item(base: number, intrinsic = false): GenericPlanningWorkItem {
  const allocation = allocateWeeklyPlanningEffort({
    baseEstimateMinutes: base, safetyBufferMultiplier: intrinsic ? 1 : undefined,
  });
  return {
    baseEstimatedMinutes: base, estimatedMinutes: allocation.allocationMinutes,
    calibrationMultiplier: 1, estimateBasis: intrinsic ? 'intrinsic_duration' : 'duration_per_unit',
  } as GenericPlanningWorkItem;
}

describe('actual allocated-time disclosure', () => {
  it.each([[60, 66, 70], [120, 132, 135]])('retains %i estimated / %i buffered / %i allocated minutes', (base, buffered, allocated) => {
    expect(allocationBreakdownForWeeklyPlanningWorkItem(item(base), allocated)).toEqual({
      estimatedMinutes: base, calibratedMinutes: base, bufferedMinutes: buffered,
      allocatedMinutes: allocated, marginMinutes: allocated - base, reasons: ['estimate_margin', 'rounding'],
    });
  });

  it('does not invent margin for intrinsic duration', () => {
    expect(allocationBreakdownForWeeklyPlanningWorkItem(item(120, true), 120)).toEqual({
      estimatedMinutes: 120, calibratedMinutes: 120, bufferedMinutes: 120,
      allocatedMinutes: 120, marginMinutes: 0, reasons: [],
    });
  });

  it('preserves a target total through slicing and counts only the remaining candidates after deletion', () => {
    const source = item(60);
    const candidates = [35, 35].map((durationMinutes) => ({
      durationMinutes,
      allocationBreakdown: allocationBreakdownForWeeklyPlanningWorkItem(source, durationMinutes),
    }));
    expect(summarizeWeeklyPlanningAllocationBreakdown(candidates)).toMatchObject({
      estimatedMinutes: 60, bufferedMinutes: 66, allocatedMinutes: 70, marginMinutes: 10,
    });
    expect(summarizeWeeklyPlanningAllocationBreakdown(candidates.slice(1))).toMatchObject({
      estimatedMinutes: 30, bufferedMinutes: 33, allocatedMinutes: 35, marginMinutes: 5,
    });
  });

  it('fails closed for missing evidence or edited duration instead of describing a stale total', () => {
    const allocationBreakdown = allocationBreakdownForWeeklyPlanningWorkItem(item(60), 70);
    expect(summarizeWeeklyPlanningAllocationBreakdown([{ durationMinutes: 70 }])).toBeNull();
    expect(summarizeWeeklyPlanningAllocationBreakdown([{ durationMinutes: 60, allocationBreakdown }])).toBeNull();
  });

  it('keeps the total consistent when a calibrated target is shorter than its original estimate', () => {
    const calibrated = { ...item(100), calibrationMultiplier: 0.8, estimatedMinutes: 90 };
    const candidates = [
      { durationMinutes: 90, allocationBreakdown: allocationBreakdownForWeeklyPlanningWorkItem(calibrated, 90) },
      { durationMinutes: 70, allocationBreakdown: allocationBreakdownForWeeklyPlanningWorkItem(item(60), 70) },
    ];
    expect(summarizeWeeklyPlanningAllocationBreakdown(candidates)).toMatchObject({
      estimatedMinutes: 160, allocatedMinutes: 160, marginMinutes: 0,
    });
  });
});
