import {
  createWeeklyPlanningSystemDialogueRendererTrace,
  renderWeeklyPlanningStableV5AssistantMessage,
  renderWeeklyPlanningStableV5RecoveryMessage,
  WEEKLY_PLANNING_RECOVERY_TECHNICAL_STOP,
} from '../dialogue/weeklyPlanningStableV5TurnDialogue';
import {
  takeWeeklyPlanningStableV5FailureDiagnostics,
  type WeeklyPlanningStableV5FailureStatus,
  type WeeklyPlanningStableV5RecordedFailure,
} from '../semantic/weeklyPlanningStableV5FailureDiagnostics';
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

function beginTurnResultProjection(traceRequestId: string): void {
  takeWeeklyPlanningStableV5FailureDiagnostics(traceRequestId);
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
      projectedResult,
    },
  });
  return projectedResult;
}

async function projectFailedTurn(params: {
  input: WeeklyPlanningTurnExecutionInput;
  result: WeeklyPlanningTurnExecutionResult;
  recordedFailure: WeeklyPlanningStableV5RecordedFailure;
}): Promise<WeeklyPlanningTurnExecutionResult> {
  // Failure output is whitelisted: old presentation metadata is not evidence about
  // this technical stop, and no failed graph/draft can become a commit candidate.
  let projectedResult: WeeklyPlanningTurnExecutionResult = {
    message: WEEKLY_PLANNING_RECOVERY_TECHNICAL_STOP,
    draftCandidates: [],
    preserveExistingPreview: true,
    state: {
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
      userMessage: WEEKLY_PLANNING_RECOVERY_TECHNICAL_STOP,
      traceCode: params.recordedFailure.traceCode,
      diagnostics: {
        attemptCount: params.recordedFailure.attemptCount,
        repairAttempted: params.recordedFailure.repairAttempted,
        validationErrorCategories: params.recordedFailure.validationErrorCategories,
        providerErrorCategory: params.recordedFailure.providerErrorCategory,
      },
    },
    responseSource: 'system',
    dialogueRendererTrace: createWeeklyPlanningSystemDialogueRendererTrace(WEEKLY_PLANNING_RECOVERY_TECHNICAL_STOP),
    observability: {
      repairUsed: params.recordedFailure.repairAttempted,
      schedulerVersion: params.result.observability?.schedulerVersion ?? null,
      previewCount: params.result.observability?.previewCount ?? null,
      unscheduledCount: params.result.observability?.unscheduledCount ?? null,
    },
  };
  const usage = params.recordedFailure.providerDispatch;
  // Scope: this normalizer + its recovery, not a new global turn pool. Focused routes
  // are included by the shared normalizer client wrapper. Unknown counts fail closed.
  const recoveryAllowed = params.recordedFailure.status !== 'provider_failure'
    && params.recordedFailure.providerErrorCategory === null
    && usage !== undefined && usage.anyFailure === false && usage.complete === true
    && Number.isSafeInteger(usage.count) && usage.count > 0 && usage.count <= 6
    && params.input.isCurrentTurn?.() === true;
  if (recoveryAllowed) {
    projectedResult = await renderWeeklyPlanningStableV5RecoveryMessage({
      input: params.input, result: projectedResult,
    });
    projectedResult = { ...projectedResult, failure: {
      ...projectedResult.failure!, userMessage: projectedResult.message,
    } };
  }
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.input.traceRequestId,
    stage: 'turn_executor_result_projected',
    severity: 'error',
    data: {
      branch: 'recorded_failure_projected',
      criteria: {
        recordedFailureExists: true,
        projectedStatus: 'revision_pending',
        questionsCleared: true,
        draftAuthorizationCleared: true,
        recoveryAllowed,
        normalizerDispatchCount: usage?.count ?? null,
        recoveryDispatchCeiling: 2,
      },
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
