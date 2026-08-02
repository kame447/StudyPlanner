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
    return {
      name: error.name,
      message: error.message,
    };
  }
  return { name: 'UnknownError', message: String(error) };
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
    responseSource: 'system',
  };
}

function isDuplicateCommittedTurn(input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput): boolean {
  const session = getWeeklyPlanningStableV5RuntimeSession(input.conversationId);
  if (!session || session.ownerId !== input.userId) return false;
  return session.graph.appliedTurnKeys.includes(
    `${input.conversationId}:${input.traceRequestId}`,
  );
}

function withCurrentSessionGraph(
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
  result: WeeklyPlanningTurnExecutionResult,
): WeeklyPlanningTurnExecutionResult {
  const session = getWeeklyPlanningStableV5RuntimeSession(input.conversationId);
  if (!session || session.ownerId !== input.userId) return result;
  return {
    ...result,
    stableV5Graph: session.graph,
  };
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

  if (isDuplicateCommittedTurn(input)) {
    const result = withCurrentSessionGraph(input, duplicateTurnResult(input));
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: input.traceRequestId,
      stage: 'runtime_duplicate_turn_suppressed',
      severity: 'warn',
      data: {
        criterion: 'runtime graph already contains conversationId:requestId in appliedTurnKeys',
        coreExecutorInvoked: false,
        graphRevision: result.stableV5Graph?.revision ?? null,
        previewCandidateCount: 0,
      },
    });
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
    const result = withCurrentSessionGraph(input, coreResult);
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
