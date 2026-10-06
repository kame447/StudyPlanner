import {
  createWeeklyPlanningSystemDialogueRendererTrace,
  renderWeeklyPlanningStableV5AssistantMessage,
} from '../dialogue/weeklyPlanningStableV5TurnDialogue';
import {
  takeWeeklyPlanningStableV5FailureDiagnostics,
  type WeeklyPlanningStableV5FailureStatus,
  type WeeklyPlanningStableV5RecordedFailure,
} from '../semantic/weeklyPlanningStableV5FailureDiagnostics';
import {
  beginWeeklyPlanningTurnDispatchBudget,
  endWeeklyPlanningTurnDispatchBudget,
  getWeeklyPlanningTurnDispatchBudget,
} from './weeklyPlanningTurnDispatchBudget';
import {
  conversationArchitecturePolicy,
  type WeeklyPlanningConversationArchitecture,
} from '../weeklyPlanningConversationArchitecture';
import {
  recordWeeklyPlanningStableV5DebugTrace,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import type {
  WeeklyPlanningTurnExecutionInput,
  WeeklyPlanningTurnExecutionResult,
  WeeklyPlanningTurnFailureCode,
} from '../weeklyPlanningTurnExecutionTypes';

const FAILURE_CODE_BY_STATUS: Record<
  WeeklyPlanningStableV5FailureStatus,
  WeeklyPlanningTurnFailureCode
> = {
  provider_failure: 'stable_v5_provider_failure',
  normalization_rejected: 'stable_v5_normalization_rejected',
  canonicalization_rejected: 'stable_v5_canonicalization_rejected',
};

function beginTurnResultProjection(
  traceRequestId: string,
  architecture?: WeeklyPlanningConversationArchitecture,
): void {
  takeWeeklyPlanningStableV5FailureDiagnostics(traceRequestId);
  // Every architecture counts its dispatches (measurement); only interaction enforces the pool.
  beginWeeklyPlanningTurnDispatchBudget(traceRequestId, {
    enforce: conversationArchitecturePolicy(architecture).enforceTurnDispatchBudget,
  });
}

/** Enum/number-only attribution of the turn's architecture and actual provider dispatches. */
function architectureEvidence(input: WeeklyPlanningTurnExecutionInput) {
  return {
    conversationArchitecture: conversationArchitecturePolicy(input.conversationArchitecture).architecture,
    aiDispatchUsage: getWeeklyPlanningTurnDispatchBudget(input.traceRequestId).usage(),
  };
}

async function projectSuccessfulTurn(params: {
  input: WeeklyPlanningTurnExecutionInput;
  result: WeeklyPlanningTurnExecutionResult;
}): Promise<WeeklyPlanningTurnExecutionResult> {
  const projectedResult = await renderWeeklyPlanningStableV5AssistantMessage(params);
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.input.traceRequestId,
    stage: 'turn_executor_result_projected',
    data: {
      branch: 'no_recorded_failure',
      criteria: 'failure diagnostics repository returned null',
      ...architectureEvidence(params.input),
      projectedResult,
    },
  });
  return projectedResult;
}

function projectFailedTurn(params: {
  input: WeeklyPlanningTurnExecutionInput;
  result: WeeklyPlanningTurnExecutionResult;
  recordedFailure: WeeklyPlanningStableV5RecordedFailure;
}): WeeklyPlanningTurnExecutionResult {
  const recovery = conversationArchitecturePolicy(
    params.input.conversationArchitecture,
  ).conversationalFailureRecovery;
  const projectedResult: WeeklyPlanningTurnExecutionResult = {
    ...params.result,
    // Interaction architecture: a failed turn retains the accepted machine state, questions
    // included (with no previous state the neutral recovery state is reported).
    // Legacy architecture: the pre-#488 projection (questions/draft authorization reported
    // cleared; the committed state itself is untouched by a failed turn either way).
    state: recovery && params.input.previousState
      ? params.input.previousState
      : {
          ...params.result.state,
          status: 'revision_pending',
          missing: [],
          questions: [],
          lastQuestionContext: undefined,
          shouldCreateDraft: false,
          draftGenerationIntent: 'not_requested',
        },
    failure: {
      code: FAILURE_CODE_BY_STATUS[params.recordedFailure.status],
      userMessage: params.result.message,
      traceCode: params.recordedFailure.traceCode,
      diagnostics: {
        attemptCount: params.recordedFailure.attemptCount,
        repairAttempted: params.recordedFailure.repairAttempted,
        validationErrorCategories: params.recordedFailure.validationErrorCategories,
        providerErrorCategory: params.recordedFailure.providerErrorCategory,
      },
    },
    responseSource: 'system',
    dialogueRendererTrace: createWeeklyPlanningSystemDialogueRendererTrace(params.result.message),
    observability: {
      repairUsed: params.recordedFailure.repairAttempted,
      schedulerVersion: params.result.observability?.schedulerVersion ?? null,
      previewCount: params.result.observability?.previewCount ?? null,
      unscheduledCount: params.result.observability?.unscheduledCount ?? null,
    },
  };
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.input.traceRequestId,
    stage: 'turn_executor_result_projected',
    severity: 'error',
    data: {
      branch: 'recorded_failure_projected',
      criteria: recovery
        ? {
            recordedFailureExists: true,
            machineStateRetained: params.input.previousState !== undefined,
            authoritativeStateChanged: false,
          }
        : {
            recordedFailureExists: true,
            projectedStatus: 'revision_pending',
            questionsCleared: true,
            draftAuthorizationCleared: true,
          },
      ...architectureEvidence(params.input),
      recordedFailure: params.recordedFailure,
      originalResult: params.result,
      projectedResult,
    },
  });
  return projectedResult;
}

async function projectTurnResult(params: {
  input: WeeklyPlanningTurnExecutionInput;
  result: WeeklyPlanningTurnExecutionResult;
}): Promise<WeeklyPlanningTurnExecutionResult> {
  try {
    return await projectTurnResultWithinBudget(params);
  } finally {
    endWeeklyPlanningTurnDispatchBudget(params.input.traceRequestId);
  }
}

async function projectTurnResultWithinBudget(params: {
  input: WeeklyPlanningTurnExecutionInput;
  result: WeeklyPlanningTurnExecutionResult;
}): Promise<WeeklyPlanningTurnExecutionResult> {
  const recordedFailure = takeWeeklyPlanningStableV5FailureDiagnostics(
    params.input.traceRequestId,
  );
  if (!recordedFailure) return projectSuccessfulTurn(params);
  return projectFailedTurn({ ...params, recordedFailure });
}

export const weeklyPlanningStableV5TurnResultProjector = {
  begin: beginTurnResultProjection,
  project: projectTurnResult,
} as const;
