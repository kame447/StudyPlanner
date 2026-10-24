import { projectWeeklyPlanningPreviewConstraintSatisfaction } from './weeklyPlanningPreviewConstraintSatisfaction';
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
import type { executeWeeklyPlanningStableV5SemanticTurnCore } from './weeklyPlanningStableV5SemanticTurnCore';
import type { WeeklyPlanningStableV5SemanticTurnResult } from './weeklyPlanningStableV5SemanticTurnCore';

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

interface WeeklyPlanningRuntimeStagePorts {
  stageTurn(params: { input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput;
    semanticTurn: Extract<WeeklyPlanningStableV5SemanticTurnResult, { status: 'success' }>;
    omitCanonicalizationEvidence?: boolean }): void;
}

export async function executeWeeklyPlanningStableV5RuntimeTurnCore(
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
  ports: WeeklyPlanningRuntimeStagePorts & { semanticTurn: (input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput) => ReturnType<typeof executeWeeklyPlanningStableV5SemanticTurnCore> },
): Promise<WeeklyPlanningTurnExecutionResult> {
  const semanticTurn = await ports.semanticTurn(input);
  if (semanticTurn.status === 'failure') return semanticTurn.output;
  return continueWeeklyPlanningStableV5RuntimeTurnCore(input, semanticTurn, ports);
}

/** Shared continuation; browser staging and isolated server state stay invocation-local. */
export function continueWeeklyPlanningStableV5RuntimeTurnCore(
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
  semanticTurn: Extract<WeeklyPlanningStableV5SemanticTurnResult, { status: 'success' }>,
  ports: WeeklyPlanningRuntimeStagePorts,
  options: { controlledSelection?: boolean } = {},
): WeeklyPlanningTurnExecutionResult {
  const { requestContext, semantic } = semanticTurn;
  const semanticObservability = {
    repairUsed: semantic.normalization.diagnostics.repairAttempted,
    schedulerVersion: null,
    previewCount: null,
    unscheduledCount: null,
  } as const;
  ports.stageTurn({ input, semanticTurn, omitCanonicalizationEvidence: options.controlledSelection });

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
    declinedAdditionalWork: semantic.normalization.document?.conversationActs?.some(
      act => act.kind === 'decline_additional_work',
    ) ?? false,
    requestedEventRegistration: semantic.normalization.document?.conversationActs?.some(
      act => act.kind === 'request_event_registration',
    ) ?? false,
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
  const compiled = evaluation.compilation.input;
  const selection = compiled?.sourceSelections.find((entry) =>
    entry.kind === 'existing_plans' && entry.status === 'selected'
    && entry.ownerId === input.userId && entry.graphRevision === semantic.graph.revision);
  const source = evaluation.externalSources.find((entry) =>
    entry.kind === 'existing_plans' && entry.status === 'success'
    && entry.ownerId === input.userId && entry.activeSourceId === selection?.sourceId);
  const occupiedEventIds = source?.status === 'success'
    ? [...new Set((compiled?.availabilityWindows ?? []).filter((window) =>
        window.kind === 'occupied' && window.sourceKind === 'existing_plan'
        && window.constraintLevel === 'hard' && window.ownerId === input.userId
        && window.graphRevision === semantic.graph.revision
        && source.events.some((event) => event.eventId === window.sourceRef
          && event.ownerId === input.userId && event.constraintLevel === 'hard'))
      .map((window) => window.sourceRef))]
    : [];
  return {
    ...output,
    interactionOutcome: { kind: 'apply' },
    ...(output.draftCandidates.length > 0 && !output.preserveExistingPreview
      ? { previewConstraintSatisfaction: projectWeeklyPlanningPreviewConstraintSatisfaction({
          graph: evaluation.activeGraph,
          schedulerInput: responseRoute.schedulerInput,
          candidates: output.draftCandidates,
        }) }
      : {}),
    ...(output.draftCandidates.length > 0 && selection?.sourceId && occupiedEventIds.length > 0
      ? { existingScheduleGrounding: {
          graphRevision: semantic.graph.revision,
          sourceId: selection.sourceId,
          requestFactId: selection.requestFactId,
          occupiedEventIds,
        } }
      : {}),
    observability: {
      repairUsed: semantic.normalization.diagnostics.repairAttempted,
      schedulerVersion: preview.schedulerVersion,
      previewCount: preview.candidates.length,
      unscheduledCount: preview.unscheduledWorkItemIds.length,
    },
  };
}
