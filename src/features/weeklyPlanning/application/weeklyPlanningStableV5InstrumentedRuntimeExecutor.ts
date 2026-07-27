import {
  beginWeeklyPlanningStableV5DebugTrace,
  recordWeeklyPlanningStableV5DebugTrace,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import {
  executeWeeklyPlanningStableV5RuntimeTurn as executeWeeklyPlanningStableV5RuntimeTurnCore,
  type ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
} from './weeklyPlanningStableV5RuntimeExecutor';

function errorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
      cause: error.cause ?? null,
    };
  }
  return { value: error };
}

export async function executeWeeklyPlanningStableV5RuntimeTurn(
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
) {
  beginWeeklyPlanningStableV5DebugTrace(input.traceRequestId);
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: input.traceRequestId,
    stage: 'runtime_turn_input',
    data: {
      runtime: 'stable_v5',
      input,
      decisionInputs: {
        previousCompatibilityState: input.previousState,
        recentMessages: input.messages,
        selectedDate: input.selectedDate,
        existingPlans: input.plans,
        scheduleTemplates: input.scheduleTemplates,
        timetableTermId: input.timetableTermId ?? null,
        conversationId: input.conversationId,
        requestId: input.traceRequestId,
      },
    },
  });

  try {
    const result = await executeWeeklyPlanningStableV5RuntimeTurnCore(input);
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: input.traceRequestId,
      stage: 'runtime_turn_output',
      severity: result.failure ? 'error' : 'info',
      data: {
        result,
        finalDecision: {
          compatibilityStatus: result.state.status,
          questions: result.state.questions,
          lastQuestionContext: result.state.lastQuestionContext ?? null,
          shouldCreateDraft: result.state.shouldCreateDraft,
          draftGenerationIntent: result.state.draftGenerationIntent,
          previewCandidateCount: result.draftCandidates.length,
          failure: result.failure ?? null,
          assistantMessage: result.message,
        },
      },
    });
    return result;
  } catch (error) {
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: input.traceRequestId,
      stage: 'runtime_turn_threw',
      severity: 'error',
      data: {
        input,
        error: errorDetails(error),
      },
    });
    throw error;
  }
}
