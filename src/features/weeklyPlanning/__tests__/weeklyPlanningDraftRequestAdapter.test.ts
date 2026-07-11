import { describe, expect, it } from 'vitest';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import {
  createAssumedWeeklyDraftRequest,
  createWeeklyDraftRequestFromIntakeState,
  DEFAULT_ASSUMED_UNIT_MINUTES,
} from '../intake/weeklyPlanningDraftRequestAdapter';
import { applyWeeklyPlanningUserTurn } from '../intake/weeklyPlanningIntakeReducer';
import { WP_RP_001_WEEKEND_EXAM_TURNS } from '../testFixtures/weeklyPlanningRoleplayCases';
import {
  applyWeekendExamReadyForDraftRequest,
  applyWeekendExamReadyForLifeConstraints,
  context,
} from './weeklyPlanningRoleplayTestHelpers';

const ZERO_PROGRESS_FIELDS = [
  '数学・数理系',
  'ソフトウェア系',
  'ハードウェア系',
  'OS とネットワーク',
  'ヒューマンサイエンス系',
];

function createZeroProgressDraftReadyState(): PlanningIntakeState {
  return {
    status: 'draft_ready',
    intent: 'exam_prep_planning',
    examPrepScope: {
      examType: '院試',
      fields: ZERO_PROGRESS_FIELDS,
      totalFields: 5,
      totalYears: 7,
      yearRange: {
        startYear: 2019,
        endYear: 2025,
        sourceText: '2019〜2025',
      },
      unitModel: 'year_field_chunk',
      rawText: ['院試の5分野を2019〜2025で進める'],
    },
    tasks: [],
    progress: [],
    unitRates: [
      {
        unit: 'year_field_chunk',
        minutesPerUnit: 180,
        source: 'user',
        rawText: '一分野の一年分は3時間くらい',
      },
    ],
    constraints: [],
    priorityPolicy: {
      kind: 'field_first',
      order: ZERO_PROGRESS_FIELDS,
    },
    missing: [],
    assumptions: [],
    uncertainties: [],
    questions: [],
    shouldCreateDraft: true,
    shouldSavePlan: false,
    sourceTurns: ['完了済みはまだない'],
  };
}



function createAssumablePreviewState(): PlanningIntakeState {
  return {
    status: 'needs_scope',
    intent: 'exam_prep_planning',
    pendingPlanningRange: {
      scope: {
        kind: 'next_week',
        label: '来週',
        startDate: '2026-07-20',
        endDate: '2026-07-26',
      },
      durationDays: 7,
      sourceText: '来週',
    },
    examPrepScope: {
      examType: '院試',
      fields: ZERO_PROGRESS_FIELDS,
      totalFields: 5,
      totalYears: 7,
      unitModel: 'year_field_chunk',
      rawText: ['院試の5分野を7年分'],
    },
    tasks: [],
    progress: [],
    unitRates: [],
    constraints: [],
    priorityPolicy: { kind: 'unknown' },
    missing: [
      'planning_start_date',
      'fixed_events',
      'sleep_cycle',
      'meal_bath_constraints',
      'year_range',
      'progress',
      'completion_direction',
      'unit_duration_estimate',
      'priority_policy',
      'next_field_after_math',
      'life_constraints',
    ],
    assumptions: [],
    uncertainties: [],
    questions: [],
    shouldCreateDraft: false,
    shouldSavePlan: false,
    sourceTurns: ['来週、院試の過去問を5分野で7年分進めたい'],
  };
}

describe('weekly planning draft request adapter', () => {
  it('WP-RP-001 Phase 2 creates a draft request from the final draft_ready intake state', () => {
    const state = applyWeekendExamReadyForDraftRequest();
    const request = createWeeklyDraftRequestFromIntakeState(state);

    expect(state.status).toBe('draft_ready');
    expect(request).toMatchObject({
      examPrepScope: {
        yearRange: {
          startYear: 2019,
          endYear: 2025,
          sourceText: '2019〜2025',
        },
      },
      progress: [
        expect.objectContaining({
          field: '数学・数理系',
          completedYears: [2025, 2024, 2023, 2022, 2021],
        }),
      ],
      unitRate: {
        unit: 'year_field_chunk',
        minutesPerUnit: 120,
        source: 'user',
      },
      priorityPolicy: {
        kind: 'field_first',
        order: ['数学・数理系', 'ソフトウェア系'],
      },
      fixedEvents: [],
      shouldCreateDraft: true,
      shouldSavePlan: false,
    });
    expect(request?.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'meal' }),
        expect.objectContaining({ kind: 'bath' }),
        expect.objectContaining({ kind: 'buffer' }),
      ]),
    );
    expect(request?.fixedEvents).toEqual([]);
  });

  it('creates a draft request from a draft_ready state with zero completed progress', () => {
    const state = createZeroProgressDraftReadyState();
    const request = createWeeklyDraftRequestFromIntakeState(state);

    expect(request).toMatchObject({
      examPrepScope: {
        fields: ZERO_PROGRESS_FIELDS,
        yearRange: {
          startYear: 2019,
          endYear: 2025,
        },
      },
      progress: [],
      unitRate: {
        unit: 'year_field_chunk',
        minutesPerUnit: 180,
      },
      priorityPolicy: {
        kind: 'field_first',
        order: ZERO_PROGRESS_FIELDS,
      },
      shouldCreateDraft: true,
      shouldSavePlan: false,
    });
  });

  it('WP-RP-001 Phase 2 does not create a draft request before the intake is draft_ready', () => {
    const state = applyWeekendExamReadyForLifeConstraints();

    expect(state.status).toBe('needs_life_constraints');
    expect(createWeeklyDraftRequestFromIntakeState(state)).toBeNull();
  });

  it('WP-RP-001 Phase 2 does not create a draft request when only life constraints are collected', () => {
    const state = applyWeeklyPlanningUserTurn(
      applyWeekendExamReadyForLifeConstraints(),
      WP_RP_001_WEEKEND_EXAM_TURNS.lifeConstraints,
      context,
    );

    expect(state.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'meal' }),
        expect.objectContaining({ kind: 'bath' }),
        expect.objectContaining({ kind: 'buffer' }),
      ]),
    );
    expect(state.missing).toContain('fixed_events');
    expect(state.status).not.toBe('draft_ready');
    expect(createWeeklyDraftRequestFromIntakeState(state)).toBeNull();
  });

  it('WP-RP-001 Phase 2 keeps fixed events separate from life constraints in the draft request', () => {
    const afterLifeConstraints = applyWeeklyPlanningUserTurn(
      applyWeekendExamReadyForLifeConstraints(),
      WP_RP_001_WEEKEND_EXAM_TURNS.lifeConstraints,
      context,
    );
    const withFixedEvent = applyWeeklyPlanningUserTurn(
      afterLifeConstraints,
      '15時から病院がある',
      context,
    );
    const request = createWeeklyDraftRequestFromIntakeState(withFixedEvent);

    expect(withFixedEvent.status).toBe('draft_ready');
    expect(request?.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'meal' }),
        expect.objectContaining({ kind: 'bath' }),
        expect.objectContaining({ kind: 'buffer' }),
      ]),
    );
    expect(request?.constraints).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'fixed_event' })]),
    );
    expect(request?.fixedEvents).toEqual([
      expect.objectContaining({
        kind: 'fixed_event',
        start: '15:00',
        hardness: 'hard',
      }),
    ]);
    expect(request?.shouldSavePlan).toBe(false);
  });

  it('synthesizes an exam-prep draft from assumable and deferrable slots without mutating state', () => {
    const state = createAssumablePreviewState();
    const before = structuredClone(state);
    const assumed = createAssumedWeeklyDraftRequest(state, {
      currentDateTime: '2026-07-11T10:00:00',
    });

    expect(assumed).toMatchObject({
      planningStartDate: '2026-07-20',
      draftRequest: {
        examPrepScope: {
          fields: ZERO_PROGRESS_FIELDS,
          yearRange: { startYear: 2020, endYear: 2026 },
        },
        unitRate: {
          unit: 'year_field_chunk',
          minutesPerUnit: DEFAULT_ASSUMED_UNIT_MINUTES,
          source: 'default',
          uncertainty: 'high',
        },
        priorityPolicy: { kind: 'field_first', order: ZERO_PROGRESS_FIELDS },
        progress: [],
      },
    });
    expect(assumed?.assumptions.map((assumption) => assumption.slot)).toEqual(
      expect.arrayContaining([
        'planning_start_date',
        'year_range',
        'unit_duration_estimate',
        'priority_policy',
        'fixed_events',
        'sleep_cycle',
        'meal_bath_constraints',
        'life_constraints',
      ]),
    );
    expect(state).toEqual(before);
    expect(state.range).toBeUndefined();
    expect(state.pendingPlanningRange?.scope.startDate).toBe('2026-07-20');
  });

  it('does not synthesize when a preview prerequisite remains blocking', () => {
    const withoutTotalYears = createAssumablePreviewState();
    withoutTotalYears.examPrepScope = {
      ...withoutTotalYears.examPrepScope!,
      totalYears: undefined,
    };
    const withoutScopeStartDate = createAssumablePreviewState();
    withoutScopeStartDate.pendingPlanningRange = {
      ...withoutScopeStartDate.pendingPlanningRange!,
      scope: {
        ...withoutScopeStartDate.pendingPlanningRange!.scope,
        startDate: undefined,
      },
    };
    const withoutGoal = createAssumablePreviewState();
    withoutGoal.missing = [...withoutGoal.missing, 'tasks_or_goals'];

    expect(createAssumedWeeklyDraftRequest(withoutTotalYears, {
      currentDateTime: '2026-07-11T10:00:00',
    })).toBeNull();
    expect(createAssumedWeeklyDraftRequest(withoutScopeStartDate, {
      currentDateTime: '2026-07-11T10:00:00',
    })).toBeNull();
    expect(createAssumedWeeklyDraftRequest(withoutGoal, {
      currentDateTime: '2026-07-11T10:00:00',
    })).toBeNull();
  });

  it('prefers the confirmed draft request and returns no assumptions', () => {
    const state = createZeroProgressDraftReadyState();
    const confirmed = createWeeklyDraftRequestFromIntakeState(state);
    const assumed = createAssumedWeeklyDraftRequest(state, {
      currentDateTime: '2026-07-11T10:00:00',
    });

    expect(assumed).toEqual({
      draftRequest: confirmed,
      assumptions: [],
    });
  });

});
