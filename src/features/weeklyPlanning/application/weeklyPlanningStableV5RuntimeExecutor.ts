import { executeWeeklyPlanningStableV5RuntimeTurnCore } from './weeklyPlanningStableV5RuntimeExecutorCore';
import { executeWeeklyPlanningStableV5SemanticTurn } from './weeklyPlanningStableV5SemanticTurn';
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
