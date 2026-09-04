import { describe, expect, it } from 'vitest';
import type { PlanningIntakeState } from './weeklyPlanningIntakeTypes';
import {
  readWeeklyPlanningProvisionalTimeboxStateV5,
  WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_MINUTES_V5,
  WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_STATE_VERSION_V5,
  withWeeklyPlanningProvisionalTimeboxStateV5,
} from './weeklyPlanningProvisionalTimeboxStateV5';

function baseState(): PlanningIntakeState {
  return {
    status: 'revision_pending',
    intent: 'weekly_study_planning',
    tasks: [],
    progress: [],
    unitRates: [],
    constraints: [],
    priorityPolicy: { kind: 'unknown' },
    missing: [],
    assumptions: [],
    uncertainties: [],
    questions: [],
    shouldCreateDraft: false,
    shouldSavePlan: false,
    sourceTurns: [],
  };
}

describe('Stable V5 provisional timebox session state', () => {
  it('round-trips the explicit authorization state without treating it as an effort estimate', () => {
    const stored = withWeeklyPlanningProvisionalTimeboxStateV5(baseState(), {
      version: WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_STATE_VERSION_V5,
      workloadFactIds: ['workload-math', 'workload-physics'],
      minutesPerWorkload: WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_MINUTES_V5,
      authorizedAtGraphRevision: 11,
      authorizedAtTurnId: 'turn-9',
    });

    expect(readWeeklyPlanningProvisionalTimeboxStateV5(stored.provisionalTimebox)).toEqual({
      version: WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_STATE_VERSION_V5,
      workloadFactIds: ['workload-math', 'workload-physics'],
      minutesPerWorkload: 60,
      authorizedAtGraphRevision: 11,
      authorizedAtTurnId: 'turn-9',
    });
    expect(stored.unitRates).toEqual([]);
  });

  it('rejects tampered state and removes authorization when cleared', () => {
    expect(readWeeklyPlanningProvisionalTimeboxStateV5({
      version: WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_STATE_VERSION_V5,
      workloadFactIds: ['workload-math'],
      minutesPerWorkload: 120,
      authorizedAtGraphRevision: 11,
      authorizedAtTurnId: 'turn-9',
    })).toBeNull();

    const withState = withWeeklyPlanningProvisionalTimeboxStateV5(baseState(), {
      version: WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_STATE_VERSION_V5,
      workloadFactIds: ['workload-math'],
      minutesPerWorkload: 60,
      authorizedAtGraphRevision: 11,
      authorizedAtTurnId: 'turn-9',
    });
    const cleared = withWeeklyPlanningProvisionalTimeboxStateV5(withState, null);
    expect(cleared.provisionalTimebox).toBeUndefined();
  });
});
