import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import {
  beginWeeklyPlanningStableV5DebugTrace,
  recordWeeklyPlanningStableV5DebugTrace,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import type {
  WeeklyPlanningTurnExecutionResult,
} from '../weeklyPlanningTurnExecutor';
import {
  executeWeeklyPlanningStableV5RuntimeTurn as executeWeeklyPlanningStableV5RuntimeTurnCore,
  type ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
} from './weeklyPlanningStableV5RuntimeExecutor';
import {
  getWeeklyPlanningStableV5RuntimeSession,
} from './weeklyPlanningStableV5RuntimeSession';

function errorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const errorWithCause = error as Error & { cause?: unknown };
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
      cause: errorWithCause.cause ?? null,
    };
  }
  return { value: error };
}

function emptyCompatibilityState(): PlanningIntakeState {
  return {
    status: 'idle',
    intent: 'weekly_study_planning',
    tasks: [],
    progress: [],
    unitRates: [],
    constraints: [],
    priorityPolicy: { kind: 'unknown' },
    missing: [],
    assumptions: [],
    uncertainties: [],
    questions: [],
    shouldCreateDraft: false,
    shouldSavePlan: false,
    draftGenerationIntent: 'not_requested',
    sourceTurns: [],
  };
}

function duplicateTurnResult(
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
): WeeklyPlanningTurnExecutionResult {
  const previous = input.previousState ?? emptyCompatibilityState();
  const message = '同じ送信はすでに処理済みのため、予定を重複して作成しませんでした。';
  return {
    state: {
      ...previous,
      shouldCreateDraft: false,
      shouldSavePlan: false,
      draftGenerationIntent: 'not_requested',
    },
    message,
    draftCandidates: [],
  };
}

function isDuplicateCommittedTurn(input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput): boolean {
  const session = getWeeklyPlanningStableV5RuntimeSession(input.conversationId);
  if (!session || session.ownerId !== input.userId) return false;
  return session.graph.appliedTurnKeys.includes(
    `${input.conversationId}:${input.traceRequestId}`,
  );
}

export async function executeWeeklyPlanningStableV5RuntimeTurn(
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
): Promise<WeeklyPlanningTurnExecutionResult> {
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

  if (isDuplicateCommittedTurn(input)) {
    const result = duplicateTurnResult(input);
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: input.traceRequestId,
      stage: 'runtime_duplicate_turn_suppressed',
      severity: 'warn',
      data: {
        conversationId: input.conversationId,
        requestId: input.traceRequestId,
        criterion: 'runtime graph already contains conversationId:requestId in appliedTurnKeys',
        coreExecutorInvoked: false,
        previewCandidateCount: 0,
        result,
      },
    });
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: input.traceRequestId,
      stage: 'runtime_turn_output',
      severity: 'warn',
      data: {
        result,
        finalDecision: {
          compatibilityStatus: result.state.status,
          questions: result.state.questions,
          lastQuestionContext: result.state.lastQuestionContext ?? null,
          shouldCreateDraft: false,
          draftGenerationIntent: 'not_requested',
          previewCandidateCount: 0,
          failure: null,
          assistantMessage: result.message,
        },
      },
    });
    return result;
  }

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
