import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import {
  isWeeklyPlanningStableV5QuestionSlot,
} from '../intake/weeklyPlanningStableV5QuestionSlot';
import {
  deriveWeeklyPlanningEstimateCalibration,
} from '../personalization/weeklyPlanningEstimateCalibration';
import {
  createWeeklyPlanningActiveSchedulerGraphViewV5,
} from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import {
  applyAcceptedMemorySessionProjectionV5,
} from '../semantic/weeklyPlanningAcceptedMemorySessionProjectionV5';
import {
  createWeeklyPlanningEffortQuestionPlanV5,
} from '../semantic/weeklyPlanningEffortQuestionPolicyV5';
import {
  compileGenericSchedulerInput,
} from '../semantic/weeklyPlanningGenericSchedulerInput';
import {
  reconcileWeeklyPlanningGroundingRecordsV5,
} from '../semantic/weeklyPlanningGroundingV5';
import {
  compileWeeklyPlanningMemoryCalibrationSchedulerInputV5,
} from '../semantic/weeklyPlanningMemoryCalibrationSchedulerInputV5';
import {
  projectWeeklyPlanningMemoryObservedPaceV5,
} from '../semantic/weeklyPlanningMemoryObservedPaceProjectionV5';
import {
  resolveWeeklyPlanningDateExpressionsV5,
} from '../semantic/weeklyPlanningResolvedDateExpressionsV5';
import {
  resolveWeeklyPlanningTemporalConstraintsV5,
} from '../semantic/weeklyPlanningResolvedTemporalConstraintsV5';
import {
  decideWeeklyPlanningStableDialogueV5,
  type WeeklyPlanningStableQuestionV5,
} from '../semantic/weeklyPlanningStableDialoguePolicyV5';
import {
  decideWeeklyPlanningStableRepairPolicyV5,
} from '../semantic/weeklyPlanningStableRepairPolicyV5';
import {
  createStableV5ExternalConstraintSources,
} from './weeklyPlanningStableV5ExternalSources';
import {
  stableV5RelevantContinuationAccepted,
} from './weeklyPlanningStableV5GroundingFlow';
import {
  evaluateWeeklyPlanningLearningStrategyProposalsV5,
} from './weeklyPlanningStableV5LearningStrategyProposal';
import {
  projectWeeklyPlanningProvisionalTimeboxGraphV5,
  resolveWeeklyPlanningProvisionalTimeboxV5,
} from './weeklyPlanningStableV5ProvisionalTimebox';
import type {
  ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
} from './weeklyPlanningStableV5RuntimeContracts';
import type {
  WeeklyPlanningStableV5SemanticTurnResult,
} from './weeklyPlanningStableV5SemanticTurn';
import {
  createWeeklyPlanningSchedulerContext,
  resolveWeeklyPlanningPlanningHorizon,
} from './weeklyPlanningTemporalContext';

type SuccessfulSemanticTurn = Extract<
  WeeklyPlanningStableV5SemanticTurnResult,
  { status: 'success' }
>;

export function isWeeklyPlanningStableV5PreviewAuthorized(params: {
  previousStatus: PlanningIntakeState['status'] | null;
  previousDraftGenerationIntent: PlanningIntakeState['draftGenerationIntent'] | null;
  planningIntent: 'create_plan' | 'update_plan' | 'discuss' | 'unknown' | null;
  semanticChanged: boolean;
  hadMachinePendingQuestion?: boolean;
  provisionalTimeboxRequested?: boolean;
}): boolean {
  if (params.provisionalTimeboxRequested) return true;
  if (params.planningIntent === 'create_plan' && !params.hadMachinePendingQuestion) return true;
  if (params.previousStatus === 'draft_ready') {
    return params.planningIntent === 'update_plan' && params.semanticChanged;
  }
  return params.previousDraftGenerationIntent === 'user_authorized';
}

function hadMachinePendingQuestion(state: PlanningIntakeState | undefined): boolean {
  return isWeeklyPlanningStableV5QuestionSlot(state?.lastQuestionContext?.targetSlot);
}

function workloadSupersessions(
  graph: SuccessfulSemanticTurn['semantic']['graph'],
): Record<string, string> {
  const workloadIds = new Set(graph.workloads.map((workload) => workload.id));
  const result: Record<string, string> = {};
  for (const lifecycle of graph.factLifecycles) {
    if (
      lifecycle.status !== 'superseded'
      || !lifecycle.supersededByFactId
      || !workloadIds.has(lifecycle.factId)
      || !workloadIds.has(lifecycle.supersededByFactId)
    ) continue;
    result[lifecycle.factId] = lifecycle.supersededByFactId;
  }
  return result;
}

function withEffortMeasurement(params: {
  graph: ReturnType<typeof createWeeklyPlanningActiveSchedulerGraphViewV5>;
  question: WeeklyPlanningStableQuestionV5;
}): WeeklyPlanningStableQuestionV5 {
  if (
    params.question.code !== 'missing_effort_estimate'
    || params.question.effortMeasurement
  ) return params.question;

  const workload = params.question.factId
    ? params.graph.workloads.find((fact) => fact.id === params.question.factId) ?? null
    : null;
  if (!workload || workload.quantityRole === 'scope_total') return params.question;

  return {
    ...params.question,
    effortMeasurement: createWeeklyPlanningEffortQuestionPlanV5({
      amount: workload.amount,
      unitCode: workload.unitCode,
      unitLabel: workload.unitLabel,
      quantityRole: workload.quantityRole,
    }).kind,
  };
}

export function evaluateWeeklyPlanningStableV5Planning(params: {
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput;
  semanticTurn: SuccessfulSemanticTurn;
}) {
  const { input, semanticTurn } = params;
  const { requestContext, runtimeSession, semantic } = semanticTurn;
  const semanticDiff = semantic.canonicalization?.diff ?? undefined;
  const activeGraph = createWeeklyPlanningActiveSchedulerGraphViewV5(semantic.graph);
  const previousActiveGraph = createWeeklyPlanningActiveSchedulerGraphViewV5(runtimeSession.graph);
  const resolvedDateExpressions = resolveWeeklyPlanningDateExpressionsV5({
    graph: activeGraph,
    currentDate: requestContext.currentDate,
    weekStartsOn: requestContext.weekStartsOn,
  });
  const resolvedTemporalConstraints = resolveWeeklyPlanningTemporalConstraintsV5({
    graph: activeGraph,
    currentDate: requestContext.currentDate,
    weekStartsOn: requestContext.weekStartsOn,
    resolvedDateExpressions,
  });
  const preliminaryHorizon = resolveWeeklyPlanningPlanningHorizon({
    graph: activeGraph,
    selectedDate: input.selectedDate,
    requestContext,
    resolvedTemporalConstraints,
    groundingRecords: input.previousState?.groundingRecords,
  });
  const continuationAccepted = stableV5RelevantContinuationAccepted({
    previousState: input.previousState,
    diff: semanticDiff,
  });
  const groundingRecords = reconcileWeeklyPlanningGroundingRecordsV5({
    previousRecords: input.previousState?.groundingRecords ?? [],
    previousGraph: runtimeSession.graph,
    nextGraph: semantic.graph,
    resolvedHorizon: preliminaryHorizon,
    currentTurnId: input.traceRequestId,
    continuationAccepted,
  });
  const horizon = resolveWeeklyPlanningPlanningHorizon({
    graph: activeGraph,
    selectedDate: input.selectedDate,
    requestContext,
    resolvedTemporalConstraints,
    groundingRecords,
  });
  const schedulerContext = createWeeklyPlanningSchedulerContext({
    ownerId: input.userId,
    horizon,
    requestContext,
  });
  const externalSources = createStableV5ExternalConstraintSources({
    ownerId: input.userId,
    plans: input.plans,
    monthEvents: input.monthEvents,
    templates: input.scheduleTemplates,
    timetableTermId: input.timetableTermId,
    timetableTerm: input.timetableTerm,
    timetableTerms: input.timetableTerms,
    horizon,
    timeZone: requestContext.timeZone,
  });
  const actuals = input.actuals ?? [];
  const estimateCalibration = deriveWeeklyPlanningEstimateCalibration({
    plans: input.plans,
    actuals,
  });
  const observedPaceProjection = projectWeeklyPlanningMemoryObservedPaceV5({
    plans: input.plans,
    actuals,
    graph: activeGraph,
    document: semantic.normalization.document,
    localToFactId: semantic.canonicalization?.localToFactId ?? {},
    previousRecords: input.previousState?.learningStrategyProposalRecords ?? [],
  });
  const rawBaselineCompilation = compileGenericSchedulerInput({
    graph: activeGraph,
    context: schedulerContext,
    externalSources,
    estimateCalibrationMultiplier: estimateCalibration.multiplier,
    observedEstimateOverrides: observedPaceProjection.estimateOverrides,
    resolvedDateExpressions,
    resolvedTemporalConstraints,
  });
  const provisionalTimeboxProjection = resolveWeeklyPlanningProvisionalTimeboxV5({
    directive: semantic.normalization.contextualDirective,
    previousStatus: input.previousState?.status ?? null,
    previousGraph: previousActiveGraph,
    currentCompilation: rawBaselineCompilation,
  });
  const provisionalSchedulerGraph = projectWeeklyPlanningProvisionalTimeboxGraphV5({
    graph: activeGraph,
    resolution: provisionalTimeboxProjection,
  });
  const baselineCompilation = provisionalTimeboxProjection.source
    ? compileGenericSchedulerInput({
        graph: provisionalSchedulerGraph,
        context: schedulerContext,
        externalSources,
        estimateCalibrationMultiplier: estimateCalibration.multiplier,
        observedEstimateOverrides: observedPaceProjection.estimateOverrides,
        resolvedDateExpressions,
        resolvedTemporalConstraints,
      })
    : rawBaselineCompilation;
  const learningStrategyProposals = semantic.normalization.document
    ? evaluateWeeklyPlanningLearningStrategyProposalsV5({
        previousState: input.previousState,
        document: semantic.normalization.document,
        localToFactId: semantic.canonicalization?.localToFactId ?? {},
        compilation: baselineCompilation,
        effortEstimates: activeGraph.effortEstimates,
        workloadSupersessions: workloadSupersessions(semantic.graph),
        graphRevision: semantic.graph.revision,
        turnId: input.traceRequestId,
      })
    : {
        records: input.previousState?.learningStrategyProposalRecords ?? [],
        pendingProposal: null,
        acceptedProposal: null,
        acceptedSpacedProposal: null,
        acceptedCalibrationProposal: null,
      };
  const acceptedCalibration = learningStrategyProposals.acceptedCalibrationProposal;
  const calibrationCompilation = acceptedCalibration?.selectedSessionMinutes
    ? compileWeeklyPlanningMemoryCalibrationSchedulerInputV5({
        graph: activeGraph,
        workloadFactId: acceptedCalibration.workloadFactId,
        sessionMinutes: acceptedCalibration.selectedSessionMinutes,
        context: schedulerContext,
        externalSources,
        estimateCalibrationMultiplier: estimateCalibration.multiplier,
        resolvedDateExpressions,
        resolvedTemporalConstraints,
      })
    : null;
  const acceptedMemorySessionCompilation = applyAcceptedMemorySessionProjectionV5({
    compilation: baselineCompilation,
    graph: activeGraph,
    acceptedSpacedProposal: learningStrategyProposals.acceptedSpacedProposal,
    acceptedCalibrationProposal: acceptedCalibration,
  });
  const compilation = provisionalTimeboxProjection.source
    ? acceptedMemorySessionCompilation
    : calibrationCompilation ?? acceptedMemorySessionCompilation;
  const repairDecision = decideWeeklyPlanningStableRepairPolicyV5({
    graph: semantic.graph,
    compilation,
    previousAgenda: input.previousState?.repairAgenda ?? [],
    graphRevision: semantic.graph.revision,
    turnId: input.traceRequestId,
  });
  const acceptedSpacedProposal = learningStrategyProposals.acceptedSpacedProposal;
  const hasAcceptedMemorySessionDuration = acceptedSpacedProposal
    ? activeGraph.effortEstimates.some((estimate) =>
        estimate.targetFactId === acceptedSpacedProposal.workloadFactId
        && estimate.kind === 'session_duration'
        && Number.isFinite(estimate.minutes)
        && estimate.minutes > 0)
    : false;
  const memorySessionDurationQuestion: WeeklyPlanningStableQuestionV5 | null = acceptedSpacedProposal
    && !acceptedCalibration
    && !hasAcceptedMemorySessionDuration
    ? {
        domain: 'work_item',
        code: 'missing_effort_estimate',
        factId: acceptedSpacedProposal.workloadFactId,
        details: {},
        effortMeasurement: 'session_duration',
      }
    : null;
  const baselineDialogue = decideWeeklyPlanningStableDialogueV5(compilation);
  const selectedQuestion = memorySessionDurationQuestion
    ?? repairDecision.question
    ?? (baselineDialogue.status === 'ask_question' ? baselineDialogue.question : null);
  const dialogue = selectedQuestion
    ? {
        status: 'ask_question' as const,
        question: withEffortMeasurement({ graph: activeGraph, question: selectedQuestion }),
      }
    : baselineDialogue;
  const planningIntent = semantic.normalization.document?.planningIntent ?? null;
  const semanticChanged = Boolean(
    semanticDiff
    && (semanticDiff.added.length > 0
      || semanticDiff.superseded.length > 0
      || semanticDiff.removed.length > 0),
  );
  const previousDraftGenerationIntent = input.previousState?.draftGenerationIntent ?? null;
  const provisionalTimeboxRequested =
    semantic.normalization.contextualDirective?.kind === 'provisional_timebox';
  const authorized = isWeeklyPlanningStableV5PreviewAuthorized({
    previousStatus: input.previousState?.status ?? null,
    previousDraftGenerationIntent,
    planningIntent,
    semanticChanged,
    hadMachinePendingQuestion: hadMachinePendingQuestion(input.previousState),
    provisionalTimeboxRequested,
  });

  return {
    semanticDiff,
    continuationAccepted,
    groundingRecords,
    horizon,
    schedulerContext,
    externalSources,
    activeGraph,
    resolvedDateExpressions,
    resolvedTemporalConstraints,
    estimateCalibration,
    observedPaceProjection,
    rawBaselineCompilation,
    provisionalTimeboxProjection,
    baselineCompilation,
    acceptedMemorySessionCompilation,
    compilation,
    learningStrategyProposals,
    repairDecision,
    dialogue,
    planningIntent,
    semanticChanged,
    previousDraftGenerationIntent,
    authorized,
  };
}

export type WeeklyPlanningStableV5PlanningEvaluation = ReturnType<
  typeof evaluateWeeklyPlanningStableV5Planning
>;
