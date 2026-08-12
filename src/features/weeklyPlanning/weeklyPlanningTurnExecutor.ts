import {
  executeWeeklyPlanningStableV5RuntimeTurn,
} from './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import {
  createWeeklyPlanningSystemDialogueRendererTrace,
  renderWeeklyPlanningStableV5AssistantMessage,
} from './dialogue/weeklyPlanningStableV5TurnDialogue';
import {
  takeWeeklyPlanningStableV5FailureDiagnostics,
} from './semantic/weeklyPlanningStableV5FailureDiagnostics';
import {
  recordWeeklyPlanningStableV5DebugTrace,
} from './trace/weeklyPlanningStableV5DebugTrace';
import type {
  WeeklyPlanningTurnExecutionInput,
  WeeklyPlanningTurnExecutionResult,
  WeeklyPlanningTurnFailureCode,
} from './weeklyPlanningTurnExecutionTypes';

export type {
  WeeklyPlanningTurnExecutionInput,
  WeeklyPlanningTurnExecutionResult,
  WeeklyPlanningTurnFailure,
  WeeklyPlanningTurnFailureCode,
  WeeklyPlanningTurnFailureDiagnostics,
  WeeklyPlanningTurnSubmissionResult,
} from './weeklyPlanningTurnExecutionTypes';

export async function executeWeeklyPlanningTurn(
  input: WeeklyPlanningTurnExecutionInput,
): Promise<WeeklyPlanningTurnExecutionResult> {
  takeWeeklyPlanningStableV5FailureDiagnostics(input.traceRequestId);
  const result = await executeWeeklyPlanningStableV5RuntimeTurn({
    previousState: input.previousState,
    messages: input.messages,
    userText: input.userText,
    selectedDate: input.selectedDate,
    userId: input.userId,
    plans: input.plans,
    scheduleTemplates: input.scheduleTemplates,
    timetableTermId: input.timetableTermId,
    conversationId: input.conversationId,
    traceRequestId: input.traceRequestId,
    weekStartsOn: input.weekStartsOn,
    requestContext: input.requestContext,
  });
  const recordedFailure = takeWeeklyPlanningStableV5FailureDiagnostics(input.traceRequestId);

  if (!recordedFailure) {
    const renderedResult = await renderWeeklyPlanningStableV5AssistantMessage({ input, result });
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: input.traceRequestId,
      stage: 'turn_executor_result_projected',
      data: {
        branch: 'no_recorded_failure',
        criteria: 'failure diagnostics repository returned null',
        projectedResult: renderedResult,
      },
    });
    return renderedResult;
  }

  const failureCode = `stable_v5_${recordedFailure.status}` as WeeklyPlanningTurnFailureCode;
  const projected: WeeklyPlanningTurnExecutionResult = {
    ...result,
    state: {
      ...result.state,
      status: 'revision_pending',
      missing: [],
      questions: [],
      lastQuestionContext: undefined,
      shouldCreateDraft: false,
      draftGenerationIntent: 'not_requested',
    },
    failure: {
      code: failureCode,
      userMessage: result.message,
      traceCode: recordedFailure.traceCode,
      diagnostics: {
        attemptCount: recordedFailure.attemptCount,
        repairAttempted: recordedFailure.repairAttempted,
        validationErrorCategories: recordedFailure.validationErrorCategories,
        providerErrorCategory: recordedFailure.providerErrorCategory,
      },
    },
    responseSource: 'system',
    dialogueRendererTrace: createWeeklyPlanningSystemDialogueRendererTrace(result.message),
  };
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: input.traceRequestId,
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
      recordedFailure,
      originalResult: result,
      projectedResult: projected,
    },
  });
  return projected;
}
