import { summarizeWeeklyPlanningAllocationBreakdown } from '../semantic/weeklyPlanningAllocationBreakdown';
import { evaluateWeeklyPlanningConsultationAlternative } from './weeklyPlanningConsultationAlternativeEvaluation';
import { consultationCommunicationForPlanning } from './weeklyPlanningConsultationCommunication';
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
  const consulting = interactionPlan.acts.consultation;
  const alternativeEvidence = consulting ? evaluateWeeklyPlanningConsultationAlternative({
    acts: semantic.normalization.document?.conversationActs, compilation: evaluation.compilation,
    graph: createWeeklyPlanningPlacementGraphViewV5(evaluation.activeGraph), input, requestContext,
  }) : null;
  // A read-only discussion cannot reuse an earlier request to publish a new preview.
  const routeBase = consulting && !evaluation.semanticChanged
    && (evaluation.planningIntent === 'discuss' || evaluation.planningIntent === 'unknown')
    ? { ...evaluation, authorized: false } : evaluation;
  const routingEvaluation = interactionPlan.dialogueQuestionOverride ? { ...routeBase,
    dialogue: { ...evaluation.dialogue, status: 'ask_question' as const,
      question: interactionPlan.dialogueQuestionOverride, previewEligible: false as const },
  } : routeBase;
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
      ...(consulting ? { consultation: consultationCommunicationForPlanning({
        compilation: evaluation.compilation, preserveExistingPreview: output.preserveExistingPreview === true, alternativeEvidence,
      }) } : {}),
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
  // Only candidates exposed by this turn own fresh allocation evidence.
  const allocationBreakdown = output.preserveExistingPreview !== true
    ? summarizeWeeklyPlanningAllocationBreakdown(output.draftCandidates) : null;
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
    ...(allocationBreakdown ? { allocationBreakdown } : {}),
    ...(consulting ? { consultation: consultationCommunicationForPlanning({
      compilation: evaluation.compilation, preview, preserveExistingPreview: output.preserveExistingPreview === true, alternativeEvidence,
    }) } : {}),
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
