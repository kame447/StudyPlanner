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

function projectFailedTurn(params: {
  input: WeeklyPlanningTurnExecutionInput;
  result: WeeklyPlanningTurnExecutionResult;
  recordedFailure: WeeklyPlanningStableV5RecordedFailure;
}): WeeklyPlanningTurnExecutionResult {
  const projectedResult: WeeklyPlanningTurnExecutionResult = {
    ...params.result,
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
      criteria: {
        recordedFailureExists: true,
        projectedStatus: 'revision_pending',
        questionsCleared: true,
        draftAuthorizationCleared: true,
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
