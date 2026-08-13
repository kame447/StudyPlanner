import {
  beginWeeklyPlanningStableV5DebugTrace,
  recordWeeklyPlanningStableV5DebugTrace,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import type {
  WeeklyPlanningTurnExecutionResult,
} from '../weeklyPlanningTurnExecutor';
import {
  weeklyPlanningStableV5ResultProjector,
} from './weeklyPlanningStableV5ResultProjection';
import {
  executeWeeklyPlanningStableV5RuntimeTurn as executeWeeklyPlanningStableV5RuntimeTurnCore,
  type ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
} from './weeklyPlanningStableV5RuntimeExecutor';
import {
  weeklyPlanningStableV5IdempotencyGate,
} from './weeklyPlanningStableV5TurnIdempotency';

function errorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }
  return { name: 'UnknownError', message: String(error) };
}

function finalDecision(result: WeeklyPlanningTurnExecutionResult) {
  return {
    compatibilityStatus: result.state.status,
    questions: result.state.questions,
    lastQuestionContext: result.state.lastQuestionContext ?? null,
    shouldCreateDraft: result.state.shouldCreateDraft,
    draftGenerationIntent: result.state.draftGenerationIntent,
    previewCandidateCount: result.draftCandidates.length,
    graphRevision: result.stableV5Graph?.revision ?? null,
    failure: result.failure ?? null,
    assistantMessage: result.message,
    responseSource: result.responseSource ?? null,
  };
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
      userText: input.userText,
      selectedDate: input.selectedDate,
      timetableTermId: input.timetableTermId ?? null,
      inputCounts: {
        recentMessageCount: input.messages.length,
        existingPlanCount: input.plans.length,
        scheduleTemplateCount: input.scheduleTemplates.length,
      },
    },
  });

  const idempotency = weeklyPlanningStableV5IdempotencyGate.evaluate(input);
  if (idempotency.kind === 'duplicate') {
    const { result } = idempotency;
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: input.traceRequestId,
      stage: 'runtime_turn_output',
      severity: 'warn',
      data: { finalDecision: finalDecision(result) },
    });
    return result;
  }

  try {
    const coreResult = await executeWeeklyPlanningStableV5RuntimeTurnCore(input);
    const result = weeklyPlanningStableV5ResultProjector.core({
      input,
      result: coreResult,
    });
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: input.traceRequestId,
      stage: 'runtime_turn_output',
      severity: result.failure ? 'error' : 'info',
      data: { finalDecision: finalDecision(result) },
    });
    return result;
  } catch (error) {
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: input.traceRequestId,
      stage: 'runtime_turn_threw',
      severity: 'error',
      data: { error: errorDetails(error) },
    });
    throw error;
  }
}
