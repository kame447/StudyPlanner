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
      requiredFields: ['fixed_events', 'sleep_cycle'],
      questionPlan: [
        expect.objectContaining({ targetSlot: 'fixed_events', missing: ['fixed_events'] }),
        expect.objectContaining({ targetSlot: 'sleep_cycle', missing: ['sleep_cycle'] }),
      ],
      shouldCreateDraft: false,
      shouldSavePlan: false,
    });
  });

  it('keeps fixed_events unresolved until the user confirms fixed event absence or details', () => {
    const state = applyWeekendExamReadyForLifeConstraints();
    const decision = createWeeklyPlanningDialogueDecision({ state });

    expect(state.status).toBe('needs_life_constraints');
    expect(state.missing).toContain('fixed_events');
    expect(decision.kind).toBe('ask_missing_info');
    expect(decision.requiredFields).toContain('fixed_events');
    expect(decision.shouldSavePlan).toBe(false);
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

  it('keeps missing information higher priority than completion ambiguity', () => {
    const state = applyCompletionTextAfterKnownYearRange('25〜21が終わったよ');
    const decision = createWeeklyPlanningDialogueDecision({ state });

    expect(state.missing.length).toBeGreaterThan(0);
    expect(decision.kind).toBe('ask_missing_info');
    expect(decision.shouldSavePlan).toBe(false);
  });
});