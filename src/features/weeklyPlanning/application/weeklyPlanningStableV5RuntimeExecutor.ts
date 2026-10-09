import { isExistingScheduleQuestion, scheduleCommunicationIntent } from './weeklyPlanningFixedEventOnlyInteraction';
import { evaluateWeeklyPlanningConsultationAlternative, type WeeklyPlanningConsultationAlternativeEvidence } from './weeklyPlanningConsultationAlternativeEvaluation';
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
import { capacityShortfallFromPreview } from './weeklyPlanningCapacityShortfall';
import type {
  WeeklyPlanningPreviewOmittedWork,
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
import { consultationCommunicationForPlanning } from './weeklyPlanningConsultationCommunication';
import type { GenericSchedulerInput } from '../semantic/weeklyPlanningGenericSchedulerInput';
import { projectWeeklyPlanningPreviewConstraintSatisfaction } from './weeklyPlanningPreviewConstraintSatisfaction';
import { isKnownWeeklyPlanningUncertaintyFieldV5 } from '../semantic/weeklyPlanningSemanticUncertaintyResolutionV5';
import { releasedUncertaintiesOfTurnV5 } from '../semantic/weeklyPlanningSemanticUncertaintyReleaseV5';
import { summarizeWeeklyPlanningAllocationBreakdown } from '../semantic/weeklyPlanningAllocationBreakdown';

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
  possibleCompletenessOmission: boolean;
  omittedWork: WeeklyPlanningPreviewOmittedWork[] | null;
  consultationRequested: boolean;
  releasedUncertainties?: ReturnType<typeof releasedUncertaintiesOfTurnV5>;
  consultationActTargets?: ReadonlyArray<string | null>;
  alternativeEvidence?: WeeklyPlanningConsultationAlternativeEvidence | null;
  preview?: ReturnType<typeof executeWeeklyPlanningStableV5Preview>;
  schedulerInput?: GenericSchedulerInput;
}): WeeklyPlanningTurnCommunicationFacts {
  const context = params.output.state.lastQuestionContext;
  const code = decodeWeeklyPlanningStableV5QuestionSlot(context?.targetSlot);
  const openPoint = code === 'semantic_uncertainty'
    ? params.evaluation.activeGraph.uncertainties.find((fact) => fact.id === context?.topicId) : undefined;
  const openPointTarget = openPoint && !isKnownWeeklyPlanningUncertaintyFieldV5(openPoint.field) ? openPoint.targetFactId : null;
  const capacityShortfall = capacityShortfallFromPreview({
    preview: params.preview,
    schedulerInput: params.schedulerInput,
    taskTitleById: new Map(params.evaluation.activeGraph.tasks.map((task) => [task.id, task.title])),
  });
  return {
    allocationBreakdown: summarizeWeeklyPlanningAllocationBreakdown(params.output.draftCandidates),
    ...(params.schedulerInput && params.output.draftCandidates.length > 0
      ? { previewConstraintSatisfaction: projectWeeklyPlanningPreviewConstraintSatisfaction({
          graph: params.evaluation.activeGraph,
          schedulerInput: params.schedulerInput,
          candidates: params.output.draftCandidates,
        }) }
      : {}),
    consultation: params.consultationRequested
      ? consultationCommunicationForPlanning({
          compilation: params.evaluation.compilation,
          alternativeEvidence: params.alternativeEvidence,
          preview: params.preview,
          preserveExistingPreview: params.output.preserveExistingPreview === true,
        })
      : null,
    statusReason: params.statusReason,
    ...(isExistingScheduleQuestion(code) ? { scheduleIntent: 'confirm_existing_schedule' as const } : {}),
    ...(code === 'missing_schedulable_work' || params.statusReason === 'fixed_event_manual_entry'
      || params.statusReason === 'no_additional_work'
      ? { scheduleIntent: params.statusReason === 'fixed_event_manual_entry'
          ? 'register_event' as const : scheduleCommunicationIntent(params.evaluation.activeGraph) } : {}),
    upcomingQuestionCodes: upcomingQuestionCodesForInteraction({
      evaluation: params.evaluation,
      presented: code ? { code, factId: context?.topicId ?? null } : null,
    }),
    planningDetailsNotApplied: params.planningDetailsNotApplied,
    ...(params.possibleCompletenessOmission ? { possibleCompletenessOmission: true } : {}),
    ...(capacityShortfall ? { capacityShortfall } : {}),
    // The selected question is a free-form open point on the very task the consultation act targets: the question
    // already invites the user's condition, so the generic "not decided here" notice would ask for it twice.
    ...(params.consultationActTargets?.length && openPointTarget !== null && params.consultationActTargets.includes(openPointTarget)
      ? { openPointCoversConsultation: true } : {}),
    ...(params.releasedUncertainties?.length
      ? { uncertaintyReleased: {
          quote: params.releasedUncertainties[0].fact.source.sourceText,
          count: params.releasedUncertainties.length,
          ids: params.releasedUncertainties.map((entry) => entry.fact.id),
          nothingRead: params.releasedUncertainties.some((entry) => entry.basis === 'no_delta'),
        } }
      : {}),
    previewDisclosure: params.omittedWork
      ? { omittedWork: params.omittedWork }
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
  const alternativeEvidence = interactionPlan?.acts.consultation
    ? evaluateWeeklyPlanningConsultationAlternative({
        acts: semantic.normalization.document?.conversationActs, compilation: evaluation.compilation,
        graph: createWeeklyPlanningPlacementGraphViewV5(evaluation.activeGraph), input, requestContext,
      }) : null;
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
  const releasedUncertainties = releasedUncertaintiesOfTurnV5({
    graph: semantic.graph,
    operationKeyPrefix: `${input.conversationId}:${input.traceRequestId}`,
  });
  const consultationActTargets = (semantic.normalization.document?.conversationActs ?? [])
    .filter((act) => act.kind === 'consultation_request').map((act) => act.targetPublicId);
  const planningDetailsNotApplied = semantic.normalization.conversationOnly?.planningContentPresent === true;
  // The normalizer kept its first valid reading after an audit-reported omission could not be
  // integrated: say so instead of silently dropping what the audit found (safe failure).
  const possibleCompletenessOmission = semantic.normalization.completenessAbstention !== undefined;
  const responseRoute = weeklyPlanningStableV5ResponseRouter.beforePreview({
    input,
    graph: semantic.graph,
    evaluation: routingEvaluation,
    declinedAdditionalWork: semantic.normalization.document?.conversationActs?.some(act => act.kind === 'decline_additional_work'),
    requestedEventRegistration: semantic.normalization.document?.conversationActs?.some(act => act.kind === 'request_event_registration'),
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
              possibleCompletenessOmission,
              omittedWork: null,
              consultationRequested: interactionPlan.acts.consultation,
              releasedUncertainties,
              consultationActTargets,
              alternativeEvidence,
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
            possibleCompletenessOmission,
            omittedWork: provisionalCapacity ? provisionalCapacity.omittedWork : null,
            consultationRequested: interactionPlan!.acts.consultation,
            releasedUncertainties,
            consultationActTargets,
            alternativeEvidence,
            preview,
            schedulerInput: responseRoute.schedulerInput,
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
