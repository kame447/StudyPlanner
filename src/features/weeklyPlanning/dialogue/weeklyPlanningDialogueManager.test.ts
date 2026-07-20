import { describe, expect, it } from 'vitest';
import { createWeeklyDraftRequestFromIntakeState } from '../intake/weeklyPlanningDraftRequestAdapter';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import { createRemainingWorkItemsFromDraftRequest } from '../intake/weeklyPlanningRemainingWorkItems';
import { createWeeklyDraftCandidatesFromRemainingWorkItems } from '../scheduling/weeklyDraftCandidateGenerator';
import { SELECTED_DATE_FOR_WEEKEND_ROLEPLAY } from '../testFixtures/weeklyPlanningRoleplayCases';
import {
  applyCompletionTextAfterKnownYearRange,
  applyWeekendExamReadyForDraftRequest,
  applyWeekendExamReadyForLifeConstraints,
} from '../__tests__/weeklyPlanningRoleplayTestHelpers';
import { createWeeklyPlanningDialogueDecision } from './weeklyPlanningDialogueManager';

function createDraftReadyPipeline() {
  const state = applyWeekendExamReadyForDraftRequest();
  const request = createWeeklyDraftRequestFromIntakeState(state);

  if (!request) {
    throw new Error('expected draft request');
  }

  const remainingWorkItems = createRemainingWorkItemsFromDraftRequest(request);

  return { state, request, remainingWorkItems };
}

function createDryRunPipeline() {
  const pipeline = createDraftReadyPipeline();
  const dryRun = createWeeklyDraftCandidatesFromRemainingWorkItems({
    remainingWorkItems: pipeline.remainingWorkItems.items,
    constraints: pipeline.request.constraints,
    fixedEvents: pipeline.request.fixedEvents,
    planningStartDate: SELECTED_DATE_FOR_WEEKEND_ROLEPLAY,
    planningDayCount: 7,
    sessionPolicy: {
      firstDayStartTime: '19:00',
      dayStartTime: '09:00',
      dayEndTime: '22:00',
      breakMinutes: 0,
    },
  });

  return { ...pipeline, dryRun };
}

describe('weekly planning dialogue manager', () => {
  it('asks missing info before considering ambiguity or draft creation', () => {
    const state = applyWeekendExamReadyForLifeConstraints();
    const decision = createWeeklyPlanningDialogueDecision({ state });

    expect(decision).toMatchObject({
      kind: 'ask_missing_info',
      messageKey: 'ask_life_constraints',
      requiredFields: ['fixed_events'],
      questionPlan: [
        expect.objectContaining({ targetSlot: 'fixed_events', missing: ['fixed_events'] }),
      ],
      shouldCreateDraft: false,
      shouldSavePlan: false,
    });
  });

  it('plans only the next dependent missing slots instead of listing every missing item', () => {
    const state: PlanningIntakeState = {
      ...createInitialPlanningIntakeState(),
      missing: [
        'tasks_or_goals',
        'year_range',
        'completion_direction',
        'unit_duration_estimate',
        'priority_policy',
      ],
    };
    const decision = createWeeklyPlanningDialogueDecision({ state });

    expect(decision.kind).toBe('ask_missing_info');
    expect(decision.questionPlan).toEqual([
      expect.objectContaining({
        kind: 'missing_slot',
        targetSlot: 'tasks_or_goals',
        missing: ['tasks_or_goals'],
        intent: 'ask_tasks_or_goals',
      }),
    ]);
    expect(decision.requiredFields).toEqual(['tasks_or_goals']);
  });

  it('plans only untargeted completion target fields after partial field target acceptance', () => {
    const state: PlanningIntakeState = {
      ...createInitialPlanningIntakeState(),
      examPrepScope: {
        fields: ['A', 'B', 'C'],
        yearRange: { startYear: 2025, endYear: 2023, sourceText: '2025〜2023' },
        rawText: ['A/B/C'],
      },
      progress: [
        { field: 'A', completionTarget: { kind: 'all', rawText: 'Aは全部' }, ambiguity: 'none', rawText: 'Aは全部' },
        { field: 'B', completionTarget: { kind: 'latest_n_years', count: 2, rawText: 'Bは2年分' }, ambiguity: 'none', rawText: 'Bは2年分' },
      ],
      missing: ['progress'],
    };
    const decision = createWeeklyPlanningDialogueDecision({ state });

    expect(decision.kind).toBe('ask_missing_info');
    expect(decision.questionPlan).toEqual([
      expect.objectContaining({
        targetSlot: 'progress',
        missing: ['progress'],
        targetFields: ['C'],
      }),
    ]);
  });

  it('skips known upper slots and asks only currently eligible missing slots', () => {
    const state: PlanningIntakeState = {
      ...createInitialPlanningIntakeState(),
      missing: ['completion_direction', 'unit_duration_estimate', 'priority_policy'],
    };
    const decision = createWeeklyPlanningDialogueDecision({ state });

    expect(decision.questionPlan).toEqual([
      expect.objectContaining({ targetSlot: 'completion_direction' }),
    ]);
    expect(decision.requiredFields).not.toContain('unit_rate');
    expect(decision.requiredFields).not.toContain('priority_policy');
  });

  it('keeps sleep and meal/bath life constraint slots separate when planning questions', () => {
    const sleepKnownState: PlanningIntakeState = {
      ...createInitialPlanningIntakeState(),
      missing: ['meal_bath_constraints', 'life_constraints'],
    };
    const mealBathKnownState: PlanningIntakeState = {
      ...createInitialPlanningIntakeState(),
      missing: ['sleep_cycle', 'life_constraints'],
    };

    expect(createWeeklyPlanningDialogueDecision({ state: sleepKnownState }).questionPlan).toEqual([
      expect.objectContaining({
        targetSlot: 'meal_bath_constraints',
        missing: ['meal_bath_constraints'],
      }),
    ]);
    expect(createWeeklyPlanningDialogueDecision({ state: mealBathKnownState }).questionPlan).toEqual([
      expect.objectContaining({
        targetSlot: 'sleep_cycle',
        missing: ['sleep_cycle'],
      }),
    ]);
  });

  it('confirms field-scope ambiguity after missing fields are resolved', () => {
    const ready = applyWeekendExamReadyForDraftRequest();
    const ambiguousState: PlanningIntakeState = {
      ...ready,
      progress: ready.progress.map((progress) => ({
        ...progress,
        field: undefined,
        ambiguity: 'field_scope',
      })),
      missing: [],
      shouldCreateDraft: false,
    };
    const decision = createWeeklyPlanningDialogueDecision({ state: ambiguousState });

    expect(decision).toMatchObject({
      kind: 'confirm_ambiguity',
      messageKey: 'confirm_intake_ambiguity',
      ambiguities: ['field_scope'],
      shouldCreateDraft: false,
      shouldSavePlan: false,
    });
  });

  it('confirms draft conditions when intake is draft_ready and a request is available', () => {
    const { state, request, remainingWorkItems } = createDraftReadyPipeline();
    const decision = createWeeklyPlanningDialogueDecision({
      state,
      draftRequest: request,
      remainingWorkItems,
    });

    expect(decision.kind).toBe('confirm_draft_conditions');
    expect(decision.messageKey).toBe('confirm_weekly_draft_conditions');
    expect(decision.summary).toMatchObject({
      yearRange: {
        startYear: 2019,
        endYear: 2025,
      },
      fields: expect.arrayContaining(['数学・数理系', 'ソフトウェア系']),
      remainingWorkItemCount: remainingWorkItems.items.length,
      fixedEventCount: 0,
      lifeConstraintKinds: expect.arrayContaining(['meal', 'bath', 'buffer']),
    });
    expect(decision.summary?.completedYears).toEqual([
      { field: '数学・数理系', years: [2025, 2024, 2023, 2022, 2021] },
    ]);
    expect(decision.shouldCreateDraft).toBe(true);
    expect(decision.shouldSavePlan).toBe(false);
  });

  it('surfaces an up_to_reachable assumption note in the confirm_draft_conditions summary', () => {
    const { state, request, remainingWorkItems } = createDraftReadyPipeline();
    const stateWithAssumption: PlanningIntakeState = {
      ...state,
      assumptions: ['できるところまでを仮の completion target として扱います。'],
    };
    const decision = createWeeklyPlanningDialogueDecision({
      state: stateWithAssumption,
      draftRequest: request,
      remainingWorkItems,
    });

    expect(decision.kind).toBe('confirm_draft_conditions');
    expect(decision.summary?.assumptions).toEqual([
      'できるところまでを仮の completion target として扱います。',
    ]);
  });

  it('does not add an assumptions summary entry for the ordinary all/latest_n_years draft-ready flow', () => {
    const { state, request, remainingWorkItems } = createDraftReadyPipeline();
    const decision = createWeeklyPlanningDialogueDecision({
      state,
      draftRequest: request,
      remainingWorkItems,
    });

    expect(decision.kind).toBe('confirm_draft_conditions');
    expect(state.assumptions).toEqual([]);
    expect(decision.summary?.assumptions).toBeUndefined();
  });

  it('offers a dry-run preview when candidates exist and nothing is unscheduled', () => {
    const { state, request, remainingWorkItems, dryRun } = createDryRunPipeline();
    const decision = createWeeklyPlanningDialogueDecision({
      state,
      draftRequest: request,
      remainingWorkItems,
      dryRunCandidates: dryRun.candidates,
      dryRunDiagnostics: dryRun.diagnostics,
    });

    expect(decision.kind).toBe('offer_dry_run_preview');
    expect(decision.messageKey).toBe('offer_weekly_plan_dry_run_preview');
    expect(decision.summary).toMatchObject({
      totalRequestedMinutes: dryRun.diagnostics.totalRequestedMinutes,
      totalScheduledMinutes: dryRun.diagnostics.totalScheduledMinutes,
      unscheduledItemCount: 0,
    });
    expect(decision.shouldCreateDraft).toBe(true);
    expect(decision.shouldSavePlan).toBe(false);
  });

  it('asks to relax constraints when dry-run diagnostics have unscheduled items', () => {
    const { state, request, remainingWorkItems } = createDraftReadyPipeline();
    const dryRun = createWeeklyDraftCandidatesFromRemainingWorkItems({
      remainingWorkItems: remainingWorkItems.items,
      constraints: request.constraints,
      fixedEvents: request.fixedEvents,
      planningStartDate: SELECTED_DATE_FOR_WEEKEND_ROLEPLAY,
      planningDayCount: 1,
      sessionPolicy: {
        firstDayStartTime: '19:00',
        dayStartTime: '19:00',
        dayEndTime: '20:00',
        breakMinutes: 0,
      },
    });
    const decision = createWeeklyPlanningDialogueDecision({
      state,
      draftRequest: request,
      remainingWorkItems,
      dryRunCandidates: dryRun.candidates,
      dryRunDiagnostics: dryRun.diagnostics,
    });

    expect(dryRun.diagnostics.unscheduledItems.length).toBeGreaterThan(0);
    expect(decision.kind).toBe('ask_relax_constraints');
    expect(decision.summary).toMatchObject({
      totalRequestedMinutes: dryRun.diagnostics.totalRequestedMinutes,
      totalScheduledMinutes: dryRun.diagnostics.totalScheduledMinutes,
      unscheduledItemCount: dryRun.diagnostics.unscheduledItems.length,
    });
    expect(decision.shouldCreateDraft).toBe(false);
    expect(decision.shouldSavePlan).toBe(false);
  });

  it('does not create a draft when intake says ready but no draft request can be created', () => {
    const ready = applyWeekendExamReadyForDraftRequest();
    const invalidReadyState: PlanningIntakeState = {
      ...ready,
      unitRates: [],
    };
    const decision = createWeeklyPlanningDialogueDecision({
      state: invalidReadyState,
      draftRequest: null,
    });

    expect(invalidReadyState.shouldCreateDraft).toBe(true);
    expect(decision.kind).toBe('cannot_create_draft');
    expect(decision.messageKey).toBe('cannot_create_draft_from_intake');
    expect(decision.shouldCreateDraft).toBe(false);
    expect(decision.shouldSavePlan).toBe(false);
  });

  it('opens a new dialogue when the state has no interpreted facts', () => {
    const decision = createWeeklyPlanningDialogueDecision({
      state: createInitialPlanningIntakeState(),
    });

    expect(decision).toMatchObject({
      kind: 'open_planning_dialogue',
      messageKey: 'open_weekly_planning_dialogue',
      shouldCreateDraft: false,
      shouldSavePlan: false,
    });
  });

  it('explains the capability gap for non-exam tasks without using contradiction wording', () => {
    const state: PlanningIntakeState = {
      ...createInitialPlanningIntakeState(),
      status: 'draft_ready',
      intent: 'weekly_study_planning',
      tasks: [{
        title: '読書',
        unit: 'chapters',
        rawText: '読書',
        requiresTimeEstimate: true,
        source: 'command',
      }],
      missing: [],
      shouldCreateDraft: true,
    };
    const decision = createWeeklyPlanningDialogueDecision({
      state,
      draftRequest: null,
    });

    expect(decision).toMatchObject({
      kind: 'explain_capability_gap',
      messageKey: 'explain_weekly_planning_capability_gap',
      shouldCreateDraft: false,
      shouldSavePlan: false,
    });
  });

  it('is deterministic for the same input', () => {
    const { state, request, remainingWorkItems, dryRun } = createDryRunPipeline();
    const input = {
      state,
      draftRequest: request,
      remainingWorkItems,
      dryRunCandidates: dryRun.candidates,
      dryRunDiagnostics: dryRun.diagnostics,
    };

    expect(createWeeklyPlanningDialogueDecision(input)).toEqual(
      createWeeklyPlanningDialogueDecision(input),
    );
  });

  it('keeps completion ambiguity ahead of nonblocking missing information', () => {
    const state = applyCompletionTextAfterKnownYearRange('25〜21が終わったよ');
    const decision = createWeeklyPlanningDialogueDecision({ state });

    expect(state.missing.length).toBeGreaterThan(0);
    expect(decision.kind).toBe('confirm_ambiguity');
    expect(decision.shouldSavePlan).toBe(false);
  });

  it('prioritizes blocking and ambiguity over an assumed preview, then offers one preview question', () => {
    const { state, request, dryRun } = createDryRunPipeline();
    const previewState: PlanningIntakeState = {
      ...state,
      status: 'needs_unit_rate',
      unitRates: [],
      missing: ['unit_duration_estimate'],
      shouldCreateDraft: false,
    };
    const assumedDraft = {
      draftRequest: request,
      assumptions: [{
        slot: 'unit_duration_estimate' as const,
        source: 'default' as const,
        description: '1年分・1分野あたり120分として仮置きします。',
      }],
      candidates: dryRun.candidates,
      diagnostics: dryRun.diagnostics,
    };

    const previewDecision = createWeeklyPlanningDialogueDecision({
      state: previewState,
      assumedDraft,
    });
    const blockingDecision = createWeeklyPlanningDialogueDecision({
      state: { ...previewState, missing: ['tasks_or_goals'] },
      assumedDraft,
    });
    const ambiguityDecision = createWeeklyPlanningDialogueDecision({
      state: {
        ...previewState,
        progress: [{ ambiguity: 'completion_direction', rawText: '25〜21が終わった' }],
      },
      assumedDraft,
    });

    expect(blockingDecision.kind).toBe('ask_missing_info');
    expect(ambiguityDecision.kind).toBe('confirm_ambiguity');
    expect(previewDecision).toMatchObject({
      kind: 'offer_dry_run_preview',
      questionPlan: [expect.objectContaining({ targetSlot: 'unit_rate' })],
      summary: {
        previewAssumptions: [expect.objectContaining({ slot: 'unit_duration_estimate' })],
      },
      shouldSavePlan: false,
    });
    expect(previewDecision.questionPlan).toHaveLength(1);
  });

});