import { executeWeeklyPlanningStableV5RuntimeTurnCore, continueWeeklyPlanningStableV5RuntimeTurnCore } from './weeklyPlanningStableV5RuntimeExecutorCore';
import { executeWeeklyPlanningStableV5SemanticTurn, type WeeklyPlanningStableV5SemanticTurnResult } from './weeklyPlanningStableV5SemanticTurn';
import { stageWeeklyPlanningStableV5Turn } from './weeklyPlanningStableV5TurnStaging';
import type { ExecuteWeeklyPlanningStableV5RuntimeTurnInput } from './weeklyPlanningStableV5RuntimeContracts';
export type { ExecuteWeeklyPlanningStableV5RuntimeTurnInput } from './weeklyPlanningStableV5RuntimeContracts';
export { isWeeklyPlanningStableV5PreviewAuthorized } from './weeklyPlanningStableV5PlanningEvaluation';

export function executeWeeklyPlanningStableV5RuntimeTurn(input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput) {
  return executeWeeklyPlanningStableV5RuntimeTurnCore(input, {
    semanticTurn: executeWeeklyPlanningStableV5SemanticTurn,
    stageTurn: stageWeeklyPlanningStableV5Turn,
  });
}

/** Continue a validated C5 selection through the same server-safe planning core. */
export function continueWeeklyPlanningStableV5RuntimeTurn(
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
  semanticTurn: Extract<WeeklyPlanningStableV5SemanticTurnResult, { status: 'success' }>,
  options: { controlledSelection?: boolean } = {},
) {
  return continueWeeklyPlanningStableV5RuntimeTurnCore(input, semanticTurn, { stageTurn: stageWeeklyPlanningStableV5Turn }, options);
}
