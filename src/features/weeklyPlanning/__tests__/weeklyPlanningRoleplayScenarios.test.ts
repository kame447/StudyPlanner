import { describe, expect, it } from 'vitest';
import { createWeeklyDraftRequestFromIntakeState } from '../intake/weeklyPlanningDraftRequestAdapter';
import { createRemainingWorkItemsFromDraftRequest } from '../intake/weeklyPlanningRemainingWorkItems';
import { createWeeklyDraftCandidatesFromRemainingWorkItems } from '../scheduling/weeklyDraftCandidateGenerator';
import {
  applyWeeklyPlanningUserTurn,
  createInitialPlanningIntakeState,
} from '../intake/weeklyPlanningIntakeReducer';
import {
  SELECTED_DATE_FOR_WEEKEND_ROLEPLAY,
  WP_RP_001_WEEKEND_EXAM_TURNS,
} from '../testFixtures/weeklyPlanningRoleplayCases';
import {
  applyWeekendExamReadyForDraftRequest,
  applyWeekendExamReadyForLifeConstraints,
  context,
} from './weeklyPlanningRoleplayTestHelpers';

describe('weekly planning roleplay scenarios', () => {
  it('WP-RP-001-01 stores today 19:00 through the end of Sunday as a planning range', () => {
    const state = applyWeeklyPlanningUserTurn(
      createInitialPlanningIntakeState(),
      WP_RP_001_WEEKEND_EXAM_TURNS.rangeOnly,
      context,
    );

    expect(state).toMatchObject({
      intent: 'weekly_study_planning',
      status: 'needs_scope',
      range: {
        startDateTime: '2026-06-26T19:00:00',
        endDateTime: '2026-06-28T24:00:00',
        confidence: 'explicit',
      },
      shouldCreateDraft: false,
      shouldSavePlan: false,
    });
    expect(state.missing).toEqual(
      expect.arrayContaining([
        'tasks_or_goals',
        'fixed_events',
        'sleep_cycle',
        'meal_bath_constraints',
      ]),
    );
  });

  it('WP-RP-001-02 structures exam scope without inferring the concrete year range', () => {
    const afterRange = applyWeeklyPlanningUserTurn(
      createInitialPlanningIntakeState(),
      WP_RP_001_WEEKEND_EXAM_TURNS.rangeOnly,
      context,
    );
    const state = applyWeeklyPlanningUserTurn(
      afterRange,
      WP_RP_001_WEEKEND_EXAM_TURNS.examScope,
      context,
    );

    expect(state.intent).toBe('exam_prep_planning');
    expect(state.status).toBe('needs_progress_clarification');
    expect(state.examPrepScope).toMatchObject({
      examType: '院試',
      fields: [
        '数学・数理系',
        'ソフトウェア系',
        'ハードウェア系',
        'OS とネットワーク',
        'ヒューマンサイエンス系',
      ],
      totalFields: 5,
      totalYears: 7,
      strategyHint: 'field_first',
      unitModel: 'year_field_chunk',
      unitCountHint: 35,
    });
    expect(state.examPrepScope?.yearRange).toBeUndefined();
    expect(state.progress).toEqual([
      expect.objectContaining({
        field: '数学・数理系',
        completionBoundaryYear: 2021,
        ambiguity: 'completion_direction',
      }),
    ]);
    expect(state.missing).toEqual(
      expect.arrayContaining([
        'year_range',
        'completion_direction',
        'unit_duration_estimate',
      ]),
    );
    expect(state.questions.join('\n')).toContain('7年分は何年から何年までですか');
    expect(state.questions.join('\n')).toContain('2021まで完了');
    expect(state.shouldCreateDraft).toBe(false);
  });

  it('WP-RP-001-03 keeps a user-provided year-field unit rate while missing data still blocks draft creation', () => {
    const afterRange = applyWeeklyPlanningUserTurn(
      createInitialPlanningIntakeState(),
      WP_RP_001_WEEKEND_EXAM_TURNS.rangeOnly,
      context,
    );
    const afterScope = applyWeeklyPlanningUserTurn(
      afterRange,
      WP_RP_001_WEEKEND_EXAM_TURNS.examScope,
      context,
    );
    const state = applyWeeklyPlanningUserTurn(
      afterScope,
      WP_RP_001_WEEKEND_EXAM_TURNS.unitRateOnly,
      context,
    );

    expect(state.unitRates).toEqual([
      expect.objectContaining({
        unit: 'year_field_chunk',
        minutesPerUnit: 120,
        source: 'user',
        uncertainty: 'medium',
      }),
    ]);
    expect(state.missing).not.toContain('unit_duration_estimate');
    expect(state.missing).toEqual(
      expect.arrayContaining(['year_range', 'completion_direction']),
    );
    expect(state.shouldCreateDraft).toBe(false);
    expect(state.shouldSavePlan).toBe(false);
  });

  it("WP-RP-001-04 keeps year range, completed years, and field-first priority", () => {
    const afterRange = applyWeeklyPlanningUserTurn(
      createInitialPlanningIntakeState(),
      WP_RP_001_WEEKEND_EXAM_TURNS.rangeOnly,
      context,
    );
    const afterScope = applyWeeklyPlanningUserTurn(
      afterRange,
      WP_RP_001_WEEKEND_EXAM_TURNS.examScope,
      context,
    );
    const afterDetails = applyWeeklyPlanningUserTurn(
      afterScope,
      WP_RP_001_WEEKEND_EXAM_TURNS.yearRangeProgressAndUnitRate,
      context,
    );
    const state = applyWeeklyPlanningUserTurn(
      afterDetails,
      WP_RP_001_WEEKEND_EXAM_TURNS.priorityPolicy,
      context,
    );

    expect(state.examPrepScope?.yearRange).toEqual({
      startYear: 2019,
      endYear: 2025,
      sourceText: "2019〜2025",
    });
    expect(state.progress).toEqual([
      expect.objectContaining({
        field: "数学・数理系",
        completionBoundaryYear: 2021,
        completedYears: [2025, 2024, 2023, 2022, 2021],
        ambiguity: "none",
      }),
    ]);
    expect(state.unitRates).toEqual([
      expect.objectContaining({
        unit: "year_field_chunk",
        minutesPerUnit: 120,
        source: "user",
      }),
    ]);
    expect(state.priorityPolicy).toEqual({
      kind: "field_first",
      order: ["数学・数理系", "ソフトウェア系"],
    });
    expect(state.missing).not.toContain("year_range");
    expect(state.missing).not.toContain("completion_direction");
    expect(state.missing).not.toContain("unit_duration_estimate");
    expect(state.missing).not.toContain("priority_policy");
    expect(state.missing).not.toContain("next_field_after_math");
    expect(state.status).toBe("needs_life_constraints");
    expect(state.shouldCreateDraft).toBe(false);
    expect(state.shouldSavePlan).toBe(false);
  });
  it('WP-RP-001 Phase 3 dry-runs draft candidates from final intake without saving', () => {
    const request = createWeeklyDraftRequestFromIntakeState(
      applyWeekendExamReadyForDraftRequest(),
    );

    expect(request).not.toBeNull();
    if (!request) {
      throw new Error('expected draft request');
    }

    const remainingWorkItems = createRemainingWorkItemsFromDraftRequest(request);
    const result = createWeeklyDraftCandidatesFromRemainingWorkItems({
      remainingWorkItems: remainingWorkItems.items,
      constraints: request.constraints,
      fixedEvents: request.fixedEvents,
      planningStartDate: SELECTED_DATE_FOR_WEEKEND_ROLEPLAY,
      planningDayCount: 3,
      sessionPolicy: {
        firstDayStartTime: '19:00',
        dayStartTime: '09:00',
        dayEndTime: '22:00',
        breakMinutes: 0,
      },
    });

    expect(result.candidates.slice(0, 9).map((candidate) => ({
      field: candidate.field,
      year: candidate.year,
      durationMinutes: candidate.durationMinutes,
      approvalStatus: candidate.approvalStatus,
      source: candidate.source,
    }))).toEqual([
      { field: '数学・数理系', year: 2020, durationMinutes: 120, approvalStatus: 'unapproved', source: 'weekly_exam_prep' },
      { field: '数学・数理系', year: 2019, durationMinutes: 120, approvalStatus: 'unapproved', source: 'weekly_exam_prep' },
      { field: 'ソフトウェア系', year: 2025, durationMinutes: 120, approvalStatus: 'unapproved', source: 'weekly_exam_prep' },
      { field: 'ソフトウェア系', year: 2024, durationMinutes: 120, approvalStatus: 'unapproved', source: 'weekly_exam_prep' },
      { field: 'ソフトウェア系', year: 2023, durationMinutes: 120, approvalStatus: 'unapproved', source: 'weekly_exam_prep' },
      { field: 'ソフトウェア系', year: 2022, durationMinutes: 120, approvalStatus: 'unapproved', source: 'weekly_exam_prep' },
      { field: 'ソフトウェア系', year: 2021, durationMinutes: 120, approvalStatus: 'unapproved', source: 'weekly_exam_prep' },
      { field: 'ソフトウェア系', year: 2020, durationMinutes: 120, approvalStatus: 'unapproved', source: 'weekly_exam_prep' },
      { field: 'ソフトウェア系', year: 2019, durationMinutes: 120, approvalStatus: 'unapproved', source: 'weekly_exam_prep' },
    ]);
    expect(result.candidates.some((candidate) => candidate.field === '数学・数理系' && candidate.year === 2025)).toBe(false);
    expect(result.candidates.some((candidate) => candidate.field === '数学・数理系' && candidate.year === 2021)).toBe(false);
    expect(result.diagnostics.totalRequestedMinutes).toBe(3600);
    expect(result.diagnostics.totalScheduledMinutes).toBeLessThanOrEqual(result.diagnostics.totalRequestedMinutes);
    expect(result.diagnostics.fixedEventConflicts).toEqual([]);
    expect(result.diagnostics.lifeConstraintConflicts).toEqual([]);
    expect(result.diagnostics.fieldOrderPreserved).toBe(true);
    expect(result.diagnostics.completedYearsExcluded).toBe(true);
    expect(result.diagnostics.shouldSavePlan).toBe(false);
  });
  it('WP-RP-001-05 resolves life constraints, then explicit no fixed events, before draft creation', () => {
    const afterLifeConstraints = applyWeeklyPlanningUserTurn(
      applyWeekendExamReadyForLifeConstraints(),
      WP_RP_001_WEEKEND_EXAM_TURNS.lifeConstraints,
      context,
    );

    expect(afterLifeConstraints.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'meal',
          date: '2026-06-26',
          end: '19:00',
          hardness: 'hard',
        }),
        expect.objectContaining({
          kind: 'bath',
          durationMinutes: 30,
          hardness: 'soft',
        }),
        expect.objectContaining({
          kind: 'buffer',
          durationMinutes: 30,
          hardness: 'soft',
        }),
      ]),
    );
    expect(afterLifeConstraints.missing).toContain('fixed_events');
    expect(afterLifeConstraints.missing).not.toContain('sleep_cycle');
    expect(afterLifeConstraints.missing).not.toContain('meal_bath_constraints');
    expect(afterLifeConstraints.status).toBe('needs_life_constraints');
    expect(afterLifeConstraints.shouldCreateDraft).toBe(false);
    expect(afterLifeConstraints.shouldSavePlan).toBe(false);

    const state = applyWeeklyPlanningUserTurn(
      afterLifeConstraints,
      WP_RP_001_WEEKEND_EXAM_TURNS.noFixedEvents,
      context,
    );

    expect(state.constraints).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'fixed_event' })]),
    );
    expect(state.missing).not.toContain('fixed_events');
    expect(state.status).toBe('draft_ready');
    expect(state.shouldCreateDraft).toBe(true);
    expect(state.shouldSavePlan).toBe(false);
  });
});
