import {
  executeWeeklyPlanningStableV5RuntimeTurn,
} from './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import {
  weeklyPlanningStableV5TurnResultProjector,
} from './application/weeklyPlanningStableV5TurnResultProjection';
import type {
  WeeklyPlanningTurnExecutionInput,
  WeeklyPlanningTurnExecutionResult,
} from './weeklyPlanningTurnExecutionTypes';

export type {
  WeeklyPlanningTurnExecutionInput,
  WeeklyPlanningTurnExecutionResult,
  WeeklyPlanningTurnFailure,
  WeeklyPlanningTurnFailureCode,
  WeeklyPlanningTurnFailureDiagnostics,
  WeeklyPlanningTurnSubmissionOptions,
  WeeklyPlanningTurnSubmissionResult,
} from './weeklyPlanningTurnExecutionTypes';

export async function executeWeeklyPlanningTurn(
  input: WeeklyPlanningTurnExecutionInput,
): Promise<WeeklyPlanningTurnExecutionResult> {
  weeklyPlanningStableV5TurnResultProjector.begin(input.traceRequestId);
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
    entryRoutingTrace: input.entryRoutingTrace,
  });
  return weeklyPlanningStableV5TurnResultProjector.project({ input, result });
}
