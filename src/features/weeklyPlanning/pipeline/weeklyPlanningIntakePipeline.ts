import {
  createWeeklyPlanningDialogueDecision,
  type WeeklyPlanningDialogueDecision,
} from '../dialogue/weeklyPlanningDialogueManager';
import {
  createWeeklyDraftRequestFromIntakeState,
  type WeeklyPlanningDraftRequest,
} from '../intake/weeklyPlanningDraftRequestAdapter';
import {
  applyWeeklyPlanningCommands,
  applyWeeklyPlanningUserTurn,
  applyWeeklyPlanningUserTurnWithDiagnostics,
  createInitialPlanningIntakeState,
} from '../intake/weeklyPlanningIntakeReducer';
import type { PlanningIntakeMissing, PlanningIntakeState, WeeklyPlanningIntakeContext } from '../intake/weeklyPlanningIntakeTypes';
import { finalizeState } from '../intake/weeklyPlanningMissingStatus';
import { validateInterpretedCandidates } from '../intake/weeklyPlanningCandidateValidator';
import type {
  CandidateValidationResult,
  WeeklyPlanningIntakeInterpreter,
  InterpreterStateSummary,
} from '../intake/weeklyPlanningInterpreterTypes';
import {
  createRemainingWorkItemsFromDraftRequest,
  type WeeklyPlanningRemainingWorkItemsResult,
} from '../intake/weeklyPlanningRemainingWorkItems';
import { shouldEscalateToInterpreter } from './weeklyPlanningInterpreterEscalation';
import {
  createWeeklyDraftCandidatesFromRemainingWorkItems,
  type WeeklyDraftCandidate,
  type WeeklyDraftCandidateDiagnostics,
  type WeeklyDraftCandidateSessionPolicy,
} from '../scheduling/weeklyDraftCandidateGenerator';

export interface WeeklyPlanningIntakePipelineInput {
  previousState?: PlanningIntakeState;
  userText: string;
  planningStartDate: string;
  planningDayCount: number;
  sessionPolicy?: Partial<WeeklyDraftCandidateSessionPolicy>;
}

export interface WeeklyPlanningIntakePipelineWithInterpreterInput extends WeeklyPlanningIntakePipelineInput {
  interpreter?: WeeklyPlanningIntakeInterpreter;
}

export interface WeeklyPlanningIntakePipelineOutput {
  state: PlanningIntakeState;
  draftRequest: WeeklyPlanningDraftRequest | null;
  remainingWorkItems: WeeklyPlanningRemainingWorkItemsResult | null;
  draftCandidates: WeeklyDraftCandidate[] | null;
  diagnostics: WeeklyDraftCandidateDiagnostics | null;
  decision: WeeklyPlanningDialogueDecision;
  interpreterDiagnostics?: CandidateValidationResult;
}

function buildPipelineOutput(params: {
  input: WeeklyPlanningIntakePipelineInput;
  state: PlanningIntakeState;
  interpreterDiagnostics?: CandidateValidationResult;
}): WeeklyPlanningIntakePipelineOutput {
  const { input, state } = params;
  const draftRequest = createWeeklyDraftRequestFromIntakeState(state);
  const remainingWorkItems = draftRequest
    ? createRemainingWorkItemsFromDraftRequest(draftRequest)
    : null;
  const dryRun = draftRequest && remainingWorkItems
    ? createWeeklyDraftCandidatesFromRemainingWorkItems({
      remainingWorkItems: remainingWorkItems.items,
      constraints: draftRequest.constraints,
      fixedEvents: draftRequest.fixedEvents,
      planningStartDate: input.planningStartDate,
      planningDayCount: input.planningDayCount,
      sessionPolicy: input.sessionPolicy,
    })
    : null;
  const decision = createWeeklyPlanningDialogueDecision({
    state,
    draftRequest,
    remainingWorkItems,
    dryRunCandidates: dryRun?.candidates ?? null,
    dryRunDiagnostics: dryRun?.diagnostics ?? null,
  });
  const output: WeeklyPlanningIntakePipelineOutput = {
    state,
    draftRequest,
    remainingWorkItems,
    draftCandidates: dryRun?.candidates ?? null,
    diagnostics: dryRun?.diagnostics ?? null,
    decision,
  };

  if (params.interpreterDiagnostics) {
    output.interpreterDiagnostics = params.interpreterDiagnostics;
  }

  return output;
}

export function runWeeklyPlanningIntakePipeline(
  input: WeeklyPlanningIntakePipelineInput,
): WeeklyPlanningIntakePipelineOutput {
  const previousState = input.previousState ?? createInitialPlanningIntakeState();
  const state = applyWeeklyPlanningUserTurn(previousState, input.userText, {
    selectedDate: input.planningStartDate,
    planningDayCount: input.planningDayCount,
  });

  return buildPipelineOutput({ input, state });
}

function confirmedSlotsFromState(state: PlanningIntakeState): string[] {
  const slots: string[] = [];

  if (state.range) slots.push('planning_range');
  if (state.examPrepScope) slots.push('exam_scope');
  if (state.examPrepScope?.yearRange) slots.push('year_range');
  if (state.unitRates.length > 0) slots.push('unit_duration_estimate');
  if (state.priorityPolicy.kind !== 'unknown') slots.push('priority_policy');
  if (state.progress.some((progress) => progress.completedYears?.length || progress.completionBoundaryYear)) {
    slots.push('progress');
  }
  if (!state.missing.includes('fixed_events')) slots.push('fixed_events');
  if (!state.missing.includes('life_constraints') && !state.missing.includes('meal_bath_constraints')) {
    slots.push('life_constraints');
  }

  return Array.from(new Set(slots));
}

function createInterpreterStateSummary(state: PlanningIntakeState): InterpreterStateSummary {
  return {
    knownFields: state.examPrepScope?.fields ?? [],
    confirmedSlots: confirmedSlotsFromState(state),
    planningRangeSummary: state.range
      ? [state.range.startDateTime, state.range.endDateTime].filter(Boolean).join('〜')
      : undefined,
  };
}

function createInterpreterContext(input: WeeklyPlanningIntakePipelineInput): WeeklyPlanningIntakeContext {
  return {
    selectedDate: input.planningStartDate,
    planningDayCount: input.planningDayCount,
  };
}

function addConfirmationAssumptions(
  state: PlanningIntakeState,
  validation: CandidateValidationResult,
): PlanningIntakeState {
  if (validation.acceptedWithConfirmation.length === 0) {
    return state;
  }

  const assumptions = validation.acceptedWithConfirmation.map((command) =>
    `AI が ${command.type} として解釈しましたが、確信度が中程度のため確認が必要です。`,
  );

  return {
    ...state,
    assumptions: Array.from(new Set([...state.assumptions, ...assumptions])),
  };
}

export async function runWeeklyPlanningIntakePipelineWithInterpreter(
  input: WeeklyPlanningIntakePipelineWithInterpreterInput,
): Promise<WeeklyPlanningIntakePipelineOutput> {
  if (!input.interpreter) {
    return runWeeklyPlanningIntakePipeline(input);
  }

  const previousState = input.previousState ?? createInitialPlanningIntakeState();
  const context = createInterpreterContext(input);
  const deterministicTurn = applyWeeklyPlanningUserTurnWithDiagnostics(
    previousState,
    input.userText,
    context,
  );

  if (!shouldEscalateToInterpreter({
    deterministicCommandCount: deterministicTurn.deterministicCommandCount,
    missingBefore: deterministicTurn.missingBefore as PlanningIntakeMissing[],
    missingAfter: deterministicTurn.missingAfter as PlanningIntakeMissing[],
    userText: input.userText,
    hasInterpreter: true,
  })) {
    return buildPipelineOutput({ input, state: deterministicTurn.state });
  }

  const stateSummary = createInterpreterStateSummary(deterministicTurn.state);
  const candidates = await input.interpreter.interpretUserTurn({
    userText: input.userText,
    context,
    stateSummary,
  });
  const interpreterDiagnostics = validateInterpretedCandidates(candidates, stateSummary);
  const interpretedCommands = [
    ...interpreterDiagnostics.accepted,
    ...interpreterDiagnostics.acceptedWithConfirmation,
  ];
  const interpretedState = interpretedCommands.length > 0
    ? finalizeState(addConfirmationAssumptions(
      applyWeeklyPlanningCommands(deterministicTurn.state, interpretedCommands),
      interpreterDiagnostics,
    ))
    : deterministicTurn.state;

  return buildPipelineOutput({
    input,
    state: interpretedState,
    interpreterDiagnostics,
  });
}
