import {
  resolveWeeklyPlanningRequestContextAtIngress,
} from './application/weeklyPlanningRequestContextIngress';
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
  WeeklyPlanningTurnSubmissionResult,
} from './weeklyPlanningTurnExecutionTypes';

export async function executeWeeklyPlanningTurn(
  input: WeeklyPlanningTurnExecutionInput,
): Promise<WeeklyPlanningTurnExecutionResult> {
  weeklyPlanningStableV5TurnResultProjector.begin(input.traceRequestId);
  const requestContext = resolveWeeklyPlanningRequestContextAtIngress({
    requestContext: input.requestContext,
    selectedDate: input.selectedDate,
    weekStartsOn: input.weekStartsOn,
  }).context;
  const result = await executeWeeklyPlanningStableV5RuntimeTurn({
    previousState: input.previousState,
    messages: input.messages,
    userText: input.userText,
    selectedDate: input.selectedDate,
    userId: input.userId,
    plans: input.plans,
    actuals: input.actuals,
    studyMaterials: input.studyMaterials,
    scheduleTemplates: input.scheduleTemplates,
    timetableTermId: input.timetableTermId,
    timetableTerm: input.timetableTerm,
    timetableTerms: input.timetableTerms,
    conversationId: input.conversationId,
    traceRequestId: input.traceRequestId,
    requestContext,
  });
  return weeklyPlanningStableV5TurnResultProjector.project({ input, result });
}
