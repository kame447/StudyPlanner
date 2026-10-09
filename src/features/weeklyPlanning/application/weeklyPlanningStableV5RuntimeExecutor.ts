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
import { openRoleNeedsV5 } from './weeklyPlanningHeldRoleConfirmationV5';
import { blockingPlanningNeedsV5, calendarFreeV5, isAmountPlanningNeedV5, type CalendarFreeDayV5, type PlanningNeedV5 } from './weeklyPlanningPlanningNeedsV5';
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
import { isNothingReadV5 } from '../semantic/weeklyPlanningEmptyReadingV5';
import { ignoredRateForMissingEffortQuestionV5 } from '../semantic/weeklyPlanningIgnoredRateDisclosureV5';
import { rateUnitProjectedFromRepairsV5 } from '../semantic/weeklyPlanningRateUnitProjectionFactV5';

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
/** P3 S2: typed planning needs + the free calendar, only where the AI may ask about or propose an amount (or a held item waits). */
function planningContextFacts(params: {
  heldOpenItems: boolean;
  amountQuestion: boolean;
  hasQuestion: boolean;
  asked: { code: string; factId: string | null } | null;
  evaluation: WeeklyPlanningStableV5PlanningEvaluation;
  schedulerInput: GenericSchedulerInput | null | undefined;
  calendar: Omit<Parameters<typeof calendarFreeV5>[0], 'schedulerInput'> | undefined;
}): { planningNeeds?: PlanningNeedV5[]; calendarFree?: CalendarFreeDayV5[] } {
  const openRoleNeeds = openRoleNeedsV5(params.evaluation.activeGraph);
  if (!params.hasQuestion || !(params.amountQuestion || (params.heldOpenItems && openRoleNeeds.length > 0))) return {};
  const planningNeeds = blockingPlanningNeedsV5({ compilation: params.evaluation.compilation, openRoleNeeds, asked: params.asked });
  const calendarFree = params.calendar
    ? calendarFreeV5({ ...params.calendar, schedulerInput: params.schedulerInput, horizon: params.evaluation.horizon }) : [];
  return {
    ...(planningNeeds.length > 0 ? { planningNeeds } : {}),
    ...(calendarFree.length > 0 ? { calendarFree } : {}),
  };
}

function communicationFacts(params: {
  evaluation: WeeklyPlanningStableV5PlanningEvaluation;
  output: WeeklyPlanningTurnExecutionResult;
  statusReason: WeeklyPlanningTurnStatusReason | null;
  planningDetailsNotApplied: boolean;
  possibleCompletenessOmission: boolean;
  nothingRead?: boolean;
  rateUnitProjected?: WeeklyPlanningTurnCommunicationFacts['rateUnitProjected'];
  omittedWork: WeeklyPlanningPreviewOmittedWork[] | null;
  consultationRequested: boolean;
  releasedUncertainties?: ReturnType<typeof releasedUncertaintiesOfTurnV5>;
  consultationActTargets?: ReadonlyArray<string | null>;
  /** The question was held back this turn (an aside / a held role confirmation): open plan items reach the AI as typed needs. */
  heldOpenItems?: boolean;
  /** Busy-time sources for the calendar the AI may propose from (interaction only). */
  calendar?: Omit<Parameters<typeof calendarFreeV5>[0], 'schedulerInput'>;
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
    ...(params.nothingRead ? { nothingRead: true } : {}),
    ...(params.rateUnitProjected ? { rateUnitProjected: params.rateUnitProjected } : {}),
    ...(code === 'missing_effort_estimate'
      ? (() => {
          const ignoredRate = ignoredRateForMissingEffortQuestionV5({ view: params.evaluation.activeGraph, workloadFactId: context?.topicId });
          return ignoredRate ? { ignoredRate } : {};
        })()
      : {}),
    ...(capacityShortfall ? { capacityShortfall } : {}),
    ...planningContextFacts({
      heldOpenItems: params.heldOpenItems === true,
      amountQuestion: isAmountPlanningNeedV5(code),
      evaluation: params.evaluation,
      schedulerInput: params.schedulerInput ?? params.evaluation.compilation.input,
      calendar: params.calendar,
      hasQuestion: Boolean(context),
      asked: code ? { code, factId: context?.topicId ?? null } : null,
    }),
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
  const calendar = {
    plans: input.plans, monthEvents: input.monthEvents, ownerId: input.userId, scheduleTemplates: input.scheduleTemplates,
    timetableTermId: input.timetableTermId,
    notBefore: { date: requestContext.notBeforeDate, time: requestContext.notBeforeTime },
  };
  const planningDetailsNotApplied = semantic.normalization.conversationOnly?.planningContentPresent === true;
  // The normalizer kept its first valid reading after an audit-reported omission could not be
  // integrated: say so instead of silently dropping what the audit found (safe failure).
  const possibleCompletenessOmission = semantic.normalization.completenessAbstention !== undefined;
  // The final accepted reading is entirely empty (no delta, no act the renderer answers): the application says nothing
  // was read. Only under an accepted plan or a pending question; a first-turn greeting has its own clarify reply.
  const rateUnitProjected = rateUnitProjectedFromRepairsV5(semantic.normalization.diagnostics.algorithmicRepairs) ?? undefined;
  const nothingRead = semantic.normalization.document !== null && semantic.normalization.document !== undefined
    && isNothingReadV5(semantic.normalization.document)
    && (semantic.graph.tasks.length > 0 || Boolean(input.previousState?.lastQuestionContext));
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
    const respondOutcome = interactionPlan
      ? classifyWeeklyPlanningInteraction({
          plan: interactionPlan,
          output,
          previousQuestion: input.previousState?.lastQuestionContext,
          presentation: semanticTurn.pendingQuestionPresentation,
          graph: semantic.graph,
        })
      : undefined;
    return {
      ...output,
      ...(interactionPlan
        ? {
            interactionOutcome: respondOutcome,
            communicationFacts: communicationFacts({
              heldOpenItems: respondOutcome?.kind === 'aside',
              calendar,
              evaluation: routingEvaluation,
              output,
              statusReason: responseRoute.statusReason,
              planningDetailsNotApplied,
              possibleCompletenessOmission,
              nothingRead,
              rateUnitProjected,
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
            nothingRead,
            rateUnitProjected,
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
