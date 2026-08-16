import { describe, expect, it } from 'vitest';
import type { Actual, Plan } from '../../../types/domain';
import {
  collectWeeklyPlanningMemoryPaceObservationsV5,
  createWeeklyPlanningMemoryPaceObservationResultV5,
  deriveWeeklyPlanningMemoryPaceEstimateV5,
  validateWeeklyPlanningMemoryPaceObservationResultV5,
} from './weeklyPlanningMemoryPaceObservationsV5';

const source = {
  version: 1 as const,
  kind: 'memory_pace_calibration' as const,
  conversationId: 'conversation-1',
  graphRevision: 4,
  taskId: 'task-1',
  workloadFactId: 'workload-1',
  sessionEffortFactId: 'effort-1',
  activityKind: 'memorization_retrieval' as const,
  targetAmount: 220,
  unitCode: 'word',
  unitLabel: '語',
  plannedSessionMinutes: 20,
};

function plan(id: string): Plan {
  return {
    id,
    seriesId: id,
    userId: 'user-1',
    title: '英単語',
    subject: '英語',
    date: '2026-08-17',
    startTime: '09:00',
    endTime: '09:20',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'study',
    memo: '',
    createdAt: '2026-08-16T00:00:00Z',
    updatedAt: '2026-08-16T00:00:00Z',
    weeklyPlanningObservationSource: { ...source },
  };
}

function actual(params: {
  id: string;
  planId: string;
  start: string;
  end: string;
  progressAmount: number;
  aligned?: boolean;
}): Actual {
  return {
    id: params.id,
    userId: 'user-1',
    planId: params.planId,
    occurrenceDate: '2026-08-17',
    actualStartTime: params.start,
    actualEndTime: params.end,
    title: '英単語',
    subject: '英語',
    isAlignedToPlan: params.aligned ?? true,
    note: '',
    updatedAt: '2026-08-17T10:00:00Z',
    weeklyPlanningObservationResult: {
      version: 1,
      kind: 'memory_pace_calibration',
      progressAmount: params.progressAmount,
      unitCode: 'word',
      unitLabel: '語',
    },
  };
}

describe('weekly planning memory pace observations', () => {
  it('derives personal pace from actual duration and measured progress', () => {
    const plans = [plan('plan-1'), plan('plan-2')];
    const actuals = [
      actual({ id: 'actual-1', planId: 'plan-1', start: '09:00', end: '09:20', progressAmount: 35 }),
      actual({ id: 'actual-2', planId: 'plan-2', start: '10:00', end: '10:25', progressAmount: 50 }),
    ];

    expect(collectWeeklyPlanningMemoryPaceObservationsV5({ plans, actuals }))
      .toHaveLength(2);
    const estimate = deriveWeeklyPlanningMemoryPaceEstimateV5({
      plans,
      actuals,
      unitCode: 'word',
    });
    expect(estimate.observationCount).toBe(2);
    expect(estimate.medianProgressPerMinute).toBeCloseTo(1.875);
    expect(estimate.medianMinutesPerUnit).toBeCloseTo((20 / 35 + 25 / 50) / 2);
    expect(estimate.medianSessionMinutes).toBe(22.5);
  });

  it('does not turn zero progress or off-plan work into a pace estimate', () => {
    const plans = [plan('plan-1'), plan('plan-2')];
    const actuals = [
      actual({ id: 'actual-1', planId: 'plan-1', start: '09:00', end: '09:20', progressAmount: 0 }),
      actual({
        id: 'actual-2',
        planId: 'plan-2',
        start: '10:00',
        end: '10:20',
        progressAmount: 40,
        aligned: false,
      }),
    ];

    expect(deriveWeeklyPlanningMemoryPaceEstimateV5({
      plans,
      actuals,
      unitCode: 'word',
    })).toEqual({
      unitCode: 'word',
      observationCount: 0,
      medianProgressPerMinute: null,
      medianMinutesPerUnit: null,
      medianSessionMinutes: null,
    });
  });

  it('keeps observation result validation tied to the typed plan source', () => {
    expect(createWeeklyPlanningMemoryPaceObservationResultV5({
      source,
      progressAmount: 35,
    })).toEqual({
      version: 1,
      kind: 'memory_pace_calibration',
      progressAmount: 35,
      unitCode: 'word',
      unitLabel: '語',
    });
    expect(validateWeeklyPlanningMemoryPaceObservationResultV5({
      source,
      result: {
        version: 1,
        kind: 'memory_pace_calibration',
        progressAmount: 35,
        unitCode: 'page',
        unitLabel: 'ページ',
      },
    })).toBe('unit_mismatch');
    expect(createWeeklyPlanningMemoryPaceObservationResultV5({
      source,
      progressAmount: 221,
    })).toBeNull();
  });
});
