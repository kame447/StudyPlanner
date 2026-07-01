import {
  createWeeklyPlanningDialogueDecision,
  type WeeklyPlanningDialogueDecision,
} from '../dialogue/weeklyPlanningDialogueManager';
import {
  createWeeklyDraftRequestFromIntakeState,
  type WeeklyPlanningDraftRequest,
} from '../intake/weeklyPlanningDraftRequestAdapter';
import {
  applyWeeklyPlanningUserTurn,
  createInitialPlanningIntakeState,
} from '../intake/weeklyPlanningIntakeReducer';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import {
  createRemainingWorkItemsFromDraftRequest,
  type WeeklyPlanningRemainingWorkItemsResult,
} from '../intake/weeklyPlanningRemainingWorkItems';
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

export interface WeeklyPlanningIntakePipelineOutput {
  state: PlanningIntakeState;
  draftRequest: WeeklyPlanningDraftRequest | null;
  remainingWorkItems: WeeklyPlanningRemainingWorkItemsResult | null;
  draftCandidates: WeeklyDraftCandidate[] | null;
  diagnostics: WeeklyDraftCandidateDiagnostics | null;
  decision: WeeklyPlanningDialogueDecision;
}

export function runWeeklyPlanningIntakePipeline(
  input: WeeklyPlanningIntakePipelineInput,
): WeeklyPlanningIntakePipelineOutput {
  const previousState = input.previousState ?? createInitialPlanningIntakeState();
  const state = applyWeeklyPlanningUserTurn(previousState, input.userText, {
    selectedDate: input.planningStartDate,
    planningDayCount: input.planningDayCount,
  });
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

  return {
    state,
    draftRequest,
    remainingWorkItems,
    draftCandidates: dryRun?.candidates ?? null,
    diagnostics: dryRun?.diagnostics ?? null,
    decision,
  };
}