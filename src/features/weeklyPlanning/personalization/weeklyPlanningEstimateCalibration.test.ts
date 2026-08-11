import { describe, expect, it } from 'vitest';
import type { Actual, Plan } from '../../../types/domain';
import {
  deriveWeeklyPlanningEstimateCalibration,
  type WeeklyPlanningEstimateMetadataV1,
} from './weeklyPlanningEstimateCalibration';

function plan(
  id: string,
  metadata?: WeeklyPlanningEstimateMetadataV1,
): Plan {
  return {
    id,
    seriesId: id,
    userId: 'owner-1',
    title: '数学ワーク',
    subject: '数学',
    date: '2026-08-10',
    startTime: '19:00',
    endTime: '20:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'study',
    memo: '',
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
    ...(metadata ? { weeklyPlanningEstimate: metadata } : {}),
  } as Plan;
}

function metadata(baseEstimateMinutes: number): WeeklyPlanningEstimateMetadataV1 {
  return {
    version: 1,
    baseEstimateMinutes,
    estimateBasis: 'direct_effort',
    calibrationMultiplier: 1,
    allocationMinutes: baseEstimateMinutes,
    roundingStepMinutes: baseEstimateMinutes <= 60 ? 5 : 15,
    sourceFactRefs: ['task-1', 'workload-1', 'estimate-1'],
  };
}

function actual(id: string, planId: string | null, start: string, end: string): Actual {
  return {
    id,
    userId: 'owner-1',
    planId,
    occurrenceDate: '2026-08-10',
    actualStartTime: start,
    actualEndTime: end,
    subject: '数学',
    note: '',
    updatedAt: '2026-08-10T21:00:00.000Z',
  };
}

describe('weekly planning estimate calibration', () => {
  it('uses persisted plan/actual pairs and shrinks sparse evidence toward one', () => {
    const result = deriveWeeklyPlanningEstimateCalibration({
      plans: [plan('plan-1', metadata(60))],
      actuals: [actual('actual-1', 'plan-1', '19:00', '20:30')],
    });

    expect(result).toMatchObject({
      observationCount: 1,
      medianRatio: 1.5,
      multiplier: 1.125,
    });
  });

  it('recomputes from current actual records instead of accumulating stale updates', () => {
    const plans = [
      plan('plan-1', metadata(60)),
      plan('plan-2', metadata(60)),
      plan('plan-3', metadata(60)),
    ];
    const slow = deriveWeeklyPlanningEstimateCalibration({
      plans,
      actuals: [
        actual('actual-1', 'plan-1', '19:00', '20:30'),
        actual('actual-2', 'plan-2', '19:00', '20:30'),
        actual('actual-3', 'plan-3', '19:00', '20:30'),
      ],
    });
    const corrected = deriveWeeklyPlanningEstimateCalibration({
      plans,
      actuals: [
        actual('actual-1', 'plan-1', '19:00', '20:00'),
        actual('actual-2', 'plan-2', '19:00', '20:00'),
        actual('actual-3', 'plan-3', '19:00', '20:00'),
      ],
    });

    expect(slow.multiplier).toBe(1.25);
    expect(corrected.multiplier).toBe(1);
  });

  it('ignores plans without Stable V5 estimate metadata and supports overnight actuals', () => {
    const result = deriveWeeklyPlanningEstimateCalibration({
      plans: [plan('manual'), plan('weekly', metadata(60))],
      actuals: [
        actual('manual-actual', 'manual', '19:00', '23:00'),
        actual('weekly-actual', 'weekly', '23:30', '00:30'),
      ],
    });

    expect(result).toMatchObject({
      observationCount: 1,
      medianRatio: 1,
      multiplier: 1,
    });
  });
});
