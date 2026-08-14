import {
  beginWeeklyPlanningStableV5DebugTrace,
  recordWeeklyPlanningStableV5DebugTrace,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutionTypes';
import type { ExecuteWeeklyPlanningStableV5RuntimeTurnInput } from './weeklyPlanningStableV5RuntimeContracts';

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

function startRuntimeTrace(input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput): void {
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
}

function completeRuntimeTrace(params: {
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput;
  result: WeeklyPlanningTurnExecutionResult;
  severity?: 'info' | 'warn' | 'error';
}): void {
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.input.traceRequestId,
    stage: 'runtime_turn_output',
    severity: params.severity ?? (params.result.failure ? 'error' : 'info'),
    data: { finalDecision: finalDecision(params.result) },
  });
}

function failRuntimeTrace(params: {
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput;
  error: unknown;
}): void {
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.input.traceRequestId,
    stage: 'runtime_turn_threw',
    severity: 'error',
    data: { error: errorDetails(params.error) },
  });
}

export const weeklyPlanningStableV5RuntimeTraceLifecycle = {
  start: startRuntimeTrace,
  complete: completeRuntimeTrace,
  fail: failRuntimeTrace,
} as const;
