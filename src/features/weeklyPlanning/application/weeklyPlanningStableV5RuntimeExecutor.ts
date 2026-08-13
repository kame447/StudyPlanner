import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutionTypes';
import {
  runWeeklyPlanningStableV5PlanningStage,
} from './weeklyPlanningStableV5PlanningStage';
import {
  executeWeeklyPlanningStableV5Preview,
} from './weeklyPlanningStableV5PreviewExecution';
import {
  weeklyPlanningStableV5ResponseRouter,
} from './weeklyPlanningStableV5ResponseRouting';
import type {
  ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
} from './weeklyPlanningStableV5RuntimeContracts';
import {
  executeWeeklyPlanningStableV5SemanticTurn,
} from './weeklyPlanningStableV5SemanticTurn';
import {
  stageWeeklyPlanningStableV5Turn,
} from './weeklyPlanningStableV5TurnStaging';

export type {
  ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
} from './weeklyPlanningStableV5RuntimeContracts';
export {
  isWeeklyPlanningStableV5PreviewAuthorized,
} from './weeklyPlanningStableV5PlanningEvaluation';

export async function executeWeeklyPlanningStableV5RuntimeTurn(
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
): Promise<WeeklyPlanningTurnExecutionResult> {
  const semanticTurn = await executeWeeklyPlanningStableV5SemanticTurn(input);
  if (semanticTurn.status === 'failure') return semanticTurn.output;

  const { requestContext, semantic } = semanticTurn;
  stageWeeklyPlanningStableV5Turn({ input, semanticTurn });

  const evaluation = runWeeklyPlanningStableV5PlanningStage({
    input,
    semanticTurn,
  });

  const responseRoute = weeklyPlanningStableV5ResponseRouter.beforePreview({
    input,
    graph: semantic.graph,
    evaluation,
  });
  if (responseRoute.kind === 'respond') return responseRoute.output;

  const preview = executeWeeklyPlanningStableV5Preview({
    input,
    graph: semantic.graph,
    schedulerInput: responseRoute.schedulerInput,
    requestContext,
  });

  return weeklyPlanningStableV5ResponseRouter.afterPreview({
    input,
    semanticTurn,
    evaluation,
    preview,
  });
}
