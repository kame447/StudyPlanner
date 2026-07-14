import { describe, expect, it } from 'vitest';
import type { WeeklyDraftCandidateDiagnostics } from '../scheduling/weeklyDraftCandidateGenerator';
import {
  createFeasibilityDialogueActions,
  createFeasibilitySummary,
  validateFeasibilitySummary,
} from './weeklyPlanningFeasibility';

function diagnostics(overrides: Partial<WeeklyDraftCandidateDiagnostics> = {}): WeeklyDraftCandidateDiagnostics {
  return {
    totalRequestedMinutes: 180,
    totalScheduledMinutes: 120,
    unscheduledItems: [{
      field: '英語',
      year: 0,
      estimatedMinutes: 60,
      unit: 'hours',
      splitPolicy: 'splittable',
      source: 'exam_prep_request',
    }],
    constraintConflicts: [],
    fixedEventConflicts: [],
    lifeConstraintConflicts: [],
    reserveDayUsed: false,
    normalPlacementDayCount: 6,
    fieldOrderPreserved: true,
    completedYearsExcluded: true,
    deterministicKey: 'diagnostics-1',
    decisionTrace: [],
    shouldSavePlan: false,
    ...overrides,
  };
}

describe('weeklyPlanningFeasibility', () => {
  it('preserves required = scheduled + unscheduled and issues deterministic options', () => {
    const summary = createFeasibilitySummary({
      diagnostics: diagnostics(),
      availableMinutes: 120,
      stateRevision: 5,
    });

    expect(summary.classification).toBe('partially_feasible');
    expect(summary.scheduledMinutes + summary.unscheduledMinutes).toBe(summary.requiredMinutes);
    expect(summary.deterministicOptionIds).toEqual([
      'feasibility:defer:work-item:%E8%8B%B1%E8%AA%9E:0',
      'feasibility:prioritize:work-item:%E8%8B%B1%E8%AA%9E:0',
      'feasibility:split:work-item:%E8%8B%B1%E8%AA%9E:0',
    ]);
    expect(createFeasibilityDialogueActions(summary)[0]).toMatchObject({
      kind: 'report_infeasibility',
      topicId: 'feasibility_adjustment',
    });
  });

  it('distinguishes unknown, infeasible, feasible and unsupported', () => {
    expect(createFeasibilitySummary({ diagnostics: null, stateRevision: 1 }).classification).toBe('unknown');
    expect(createFeasibilitySummary({
      diagnostics: diagnostics({ totalScheduledMinutes: 0 }),
      stateRevision: 1,
    }).classification).toBe('infeasible');
    expect(createFeasibilitySummary({
      diagnostics: diagnostics({ totalScheduledMinutes: 180, unscheduledItems: [] }),
      stateRevision: 1,
    }).previewEligibility).toBe('eligible');
    expect(createFeasibilitySummary({
      diagnostics: diagnostics(),
      stateRevision: 1,
      supported: false,
    }).previewEligibility).toBe('unsupported');
  });

  it('rejects stale and non-conserving summaries', () => {
    const valid = createFeasibilitySummary({
      diagnostics: diagnostics(),
      stateRevision: 5,
    });
    expect(validateFeasibilitySummary(valid, 5).accepted).toBe(true);
    expect(validateFeasibilitySummary(valid, 6)).toEqual({
      accepted: false,
      reason: 'invalid-feasibility-summary',
    });
    expect(validateFeasibilitySummary({ ...valid, unscheduledMinutes: 1 }, 5)).toEqual({
      accepted: false,
      reason: 'invalid-feasibility-summary',
    });
  });
});
