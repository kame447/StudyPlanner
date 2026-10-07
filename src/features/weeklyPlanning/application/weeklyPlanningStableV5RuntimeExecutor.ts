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
import { conversationArchitecturePolicy } from '../weeklyPlanningConversationArchitecture';
import {
  classifyWeeklyPlanningInteraction,
  planWeeklyPlanningInteraction,
  upcomingQuestionCodesForInteraction,
} from './weeklyPlanningInteractionDecision';
import type {
  WeeklyPlanningTurnCommunicationFacts,
  WeeklyPlanningTurnStatusReason,
} from './weeklyPlanningInteractionOutcome';
import { decodeWeeklyPlanningStableV5QuestionSlot } from '../intake/weeklyPlanningStableV5QuestionSlot';
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

/** Typed facts for the renderer (interaction architecture only); never prose. */
function communicationFacts(params: {
  evaluation: WeeklyPlanningStableV5PlanningEvaluation;
  output: WeeklyPlanningTurnExecutionResult;
  statusReason: WeeklyPlanningTurnStatusReason | null;
  planningDetailsNotApplied: boolean;
  omittedWorkLabels: string[] | null;
}): WeeklyPlanningTurnCommunicationFacts {
  const context = params.output.state.lastQuestionContext;
  const code = decodeWeeklyPlanningStableV5QuestionSlot(context?.targetSlot);
  return {
    statusReason: params.statusReason,
    upcomingQuestionCodes: upcomingQuestionCodesForInteraction({
      evaluation: params.evaluation,
      presented: code ? { code, factId: context?.topicId ?? null } : null,
    }),
    planningDetailsNotApplied: params.planningDetailsNotApplied,
    previewDisclosure: params.omittedWorkLabels
      ? { omittedWorkLabels: params.omittedWorkLabels }
      : null,
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

  // Interaction layer: typed conversation acts + machine state decide what kind of turn
  // this was. It may redirect which open question is presented (a named topic, or the fresh
  // question the user asked about) and never touches authorization, readiness, the graph or
  // the preview decision.
  // Legacy architecture bypasses the layer entirely: no acts, no override, no outcome.
  const interactionPlan = conversationArchitecturePolicy(input.conversationArchitecture)
    .interactionOutcome
    ? planWeeklyPlanningInteraction({
        acts: semantic.normalization.document?.conversationActs,
        graph: semantic.graph,
        evaluation,
        explainedQuestion: semanticTurn.pendingQuestionPresentation.status === 'fresh'
          ? semanticTurn.pendingQuestionPresentation.questionContext
          : null,
      })
    : null;
  const routingEvaluation = interactionPlan?.dialogueQuestionOverride
    ? {
        ...evaluation,
        dialogue: {
          status: 'ask_question' as const,
          question: interactionPlan.dialogueQuestionOverride,
        },
      }
    : evaluation;
  // A turn carried only by its conversation act (no usable planning delta) applied nothing;
  // the renderer is told when the model saw planning details in it that were not taken in.
  const planningDetailsNotApplied = semantic.normalization.conversationOnly?.planningContentPresent === true;
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
      ...(interactionPlan
        ? {
            interactionOutcome: classifyWeeklyPlanningInteraction({
              plan: interactionPlan,
              output,
              previousQuestion: input.previousState?.lastQuestionContext,
              presentation: semanticTurn.pendingQuestionPresentation,
            }),
            communicationFacts: communicationFacts({
              evaluation: routingEvaluation,
              output,
              statusReason: responseRoute.statusReason,
              planningDetailsNotApplied,
              omittedWorkLabels: null,
            }),
          }
        : {}),
      observability: semanticObservability,
    };
  }

  const preview = executeWeeklyPlanningStableV5Preview({
    input,
    graph: createWeeklyPlanningPlacementGraphViewV5(evaluation.activeGraph),
    schedulerInput: responseRoute.schedulerInput,
    requestContext,
    retainPartialCapacityEvidence: Boolean(evaluation.provisionalTimeboxProjection.source),
  });

  const applyOutcome = interactionPlan
    ? { kind: 'apply' as const, consultationDeferred: interactionPlan.acts.consultation }
    : undefined;
  const provisionalCapacity = projectWeeklyPlanningProvisionalCapacityPreviewV5({
    input,
    evaluation,
    preview,
  });
  const routedOutput = provisionalCapacity?.output
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
    ...(applyOutcome
      ? {
          interactionOutcome: applyOutcome,
          communicationFacts: communicationFacts({
            evaluation,
            output,
            statusReason: null,
            planningDetailsNotApplied,
            omittedWorkLabels: provisionalCapacity ? provisionalCapacity.omittedWorkLabels : null,
          }),
        }
      : {}),
    observability: {
      repairUsed: semantic.normalization.diagnostics.repairAttempted,
      schedulerVersion: preview.schedulerVersion,
      previewCount: preview.candidates.length,
      unscheduledCount: preview.unscheduledWorkItemIds.length,
    },
  };
}
