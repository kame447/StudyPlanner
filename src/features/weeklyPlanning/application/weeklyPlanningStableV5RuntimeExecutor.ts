import { planWeeklyPlanningInteraction, classifyWeeklyPlanningInteraction } from './weeklyPlanningInteractionDecision';
import {
  withWeeklyPlanningProvisionalTimeboxStateV5,
} from '../intake/weeklyPlanningProvisionalTimeboxStateV5';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutionTypes';
import {
  createWeeklyPlanningPlacementGraphViewV5,
} from '../semantic/weeklyPlanningPlacementGraphViewV5';
import type {
  WeeklyPlanningStableV5PlanningEvaluation,
} from './weeklyPlanningStableV5PlanningEvaluation';
import {
  runWeeklyPlanningStableV5PlanningStage,
} from './weeklyPlanningStableV5PlanningStage';
import {
  executeWeeklyPlanningStableV5Preview,
} from './weeklyPlanningStableV5PreviewExecution';
import {
  projectWeeklyPlanningProvisionalCapacityPreviewV5,
} from './weeklyPlanningStableV5ProvisionalCapacityPreview';
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

function withProvisionalTimeboxState(params: {
  output: WeeklyPlanningTurnExecutionResult;
  evaluation: WeeklyPlanningStableV5PlanningEvaluation;
}): WeeklyPlanningTurnExecutionResult {
  return {
    ...params.output,
    state: withWeeklyPlanningProvisionalTimeboxStateV5(
      params.output.state,
      params.evaluation.provisionalTimeboxProjection.state,
    ),
  };
}

export async function executeWeeklyPlanningStableV5RuntimeTurn(
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
): Promise<WeeklyPlanningTurnExecutionResult> {
  const semanticTurn = await executeWeeklyPlanningStableV5SemanticTurn(input);
  if (semanticTurn.status === 'failure') return semanticTurn.output;

  const { requestContext, semantic } = semanticTurn;
  const semanticObservability = {
    repairUsed: semantic.normalization.diagnostics.repairAttempted,
    schedulerVersion: null,
    previewCount: null,
    unscheduledCount: null,
  } as const;
  stageWeeklyPlanningStableV5Turn({ input, semanticTurn });

  const evaluation = runWeeklyPlanningStableV5PlanningStage({
    input,
    semanticTurn,
  });

  const interactionPlan = planWeeklyPlanningInteraction({
    acts: semantic.normalization.document?.conversationActs, graph: semantic.graph, evaluation,
    explainedQuestion: semanticTurn.pendingQuestionPresentation.status === 'fresh'
      ? semanticTurn.pendingQuestionPresentation.questionContext : null,
  });
  const routingEvaluation = interactionPlan.dialogueQuestionOverride ? { ...evaluation,
    dialogue: { ...evaluation.dialogue, status: 'ask_question' as const,
      question: interactionPlan.dialogueQuestionOverride, previewEligible: false as const },
  } : evaluation;
  const responseRoute = weeklyPlanningStableV5ResponseRouter.beforePreview({
    input,
    graph: semantic.graph,
    evaluation: routingEvaluation,
  });
  if (responseRoute.kind === 'respond') {
    const output = withProvisionalTimeboxState({
      output: responseRoute.output,
      evaluation,
    });
    return {
      ...output,
      observability: semanticObservability,
      interactionOutcome: classifyWeeklyPlanningInteraction({ plan: interactionPlan, output,
        previousQuestion: input.previousState?.lastQuestionContext, presentation: semanticTurn.pendingQuestionPresentation }),
    };
  }

  const preview = executeWeeklyPlanningStableV5Preview({
    input,
    graph: createWeeklyPlanningPlacementGraphViewV5(evaluation.activeGraph),
    schedulerInput: responseRoute.schedulerInput,
    requestContext,
    retainPartialCapacityEvidence: Boolean(evaluation.provisionalTimeboxProjection.source),
  });

  const provisionalCapacityOutput = projectWeeklyPlanningProvisionalCapacityPreviewV5({
    input,
    evaluation,
    preview,
  });
  const routedOutput = provisionalCapacityOutput
    ?? weeklyPlanningStableV5ResponseRouter.afterPreview({
      input,
      semanticTurn,
      evaluation,
      preview,
    });
  const output = withProvisionalTimeboxState({
    output: routedOutput,
    evaluation,
  });
  return {
    ...output,
    interactionOutcome: { kind: 'apply' },
    observability: {
      repairUsed: semantic.normalization.diagnostics.repairAttempted,
      schedulerVersion: preview.schedulerVersion,
      previewCount: preview.candidates.length,
      unscheduledCount: preview.unscheduledWorkItemIds.length,
    },
  };
}
