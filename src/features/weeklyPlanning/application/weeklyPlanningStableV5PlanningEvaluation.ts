import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import {
  createWeeklyPlanningActiveSchedulerGraphViewV5,
} from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import {
  applyAcceptedMemorySessionProjectionV5,
} from '../semantic/weeklyPlanningAcceptedMemorySessionProjectionV5';
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
  decideWeeklyPlanningStableDialogueV5,
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
}): boolean {
  if (params.planningIntent === 'create_plan' && !params.hadMachinePendingQuestion) return true;
  if (params.previousStatus === 'draft_ready') {
    return params.planningIntent === 'update_plan' && params.semanticChanged;
  }
  return params.previousDraftGenerationIntent === 'user_authorized';
}

function hadMachinePendingQuestion(state: PlanningIntakeState | undefined): boolean {
  return state?.lastQuestionContext?.targetSlot?.startsWith('stable_v5:') ?? false;
}

export function evaluateWeeklyPlanningStableV5Planning(params: {
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput;
  semanticTurn: SuccessfulSemanticTurn;
}) {
  const { input, semanticTurn } = params;
  const { requestContext, runtimeSession, semantic } = semanticTurn;
  const semanticDiff = semantic.canonicalization?.diff ?? undefined;
  const preliminaryHorizon = resolveWeeklyPlanningPlanningHorizon({
    graph: semantic.graph,
    selectedDate: input.selectedDate,
    requestContext,
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
    graph: semantic.graph,
    selectedDate: input.selectedDate,
    requestContext,
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
    templates: input.scheduleTemplates,
    timetableTermId: input.timetableTermId,
    horizon,
    timeZone: requestContext.timeZone,
  });
  const activeGraph = createWeeklyPlanningActiveSchedulerGraphViewV5(semantic.graph);
  const observedPaceProjection = projectWeeklyPlanningMemoryObservedPaceV5({
    ownerId: input.userId,
    graph: activeGraph,
    document: semantic.normalization.document,
    localToFactId: semantic.canonicalization?.localToFactId ?? {},
    previousRecords: input.previousState?.learningStrategyProposalRecords ?? [],
  });
  const baselineCompilation = compileGenericSchedulerInput({
    graph: activeGraph,
    context: schedulerContext,
    externalSources,
    observedEstimateOverrides: observedPaceProjection.estimateOverrides,
  });
  const learningStrategyProposals = semantic.normalization.document
    ? evaluateWeeklyPlanningLearningStrategyProposalsV5({
        previousState: input.previousState,
        document: semantic.normalization.document,
        localToFactId: semantic.canonicalization?.localToFactId ?? {},
        compilation: baselineCompilation,
        effortEstimates: activeGraph.effortEstimates,
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
      })
    : null;
  const acceptedMemorySessionCompilation = applyAcceptedMemorySessionProjectionV5({
    compilation: baselineCompilation,
    graph: activeGraph,
    acceptedSpacedProposal: learningStrategyProposals.acceptedSpacedProposal,
    acceptedCalibrationProposal: acceptedCalibration,
  });
  const compilation = calibrationCompilation ?? acceptedMemorySessionCompilation;
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
  const memorySessionDurationQuestion = acceptedSpacedProposal
    && !acceptedCalibration
    && !hasAcceptedMemorySessionDuration
    ? {
        domain: 'work_item' as const,
        code: 'missing_effort_estimate' as const,
        factId: acceptedSpacedProposal.workloadFactId,
        details: { measurement: 'session_duration' },
      }
    : null;
  const baselineDialogue = decideWeeklyPlanningStableDialogueV5(compilation);
  const dialogue = repairDecision.question
    ? { status: 'ask_question' as const, question: repairDecision.question }
    : memorySessionDurationQuestion
      ? { status: 'ask_question' as const, question: memorySessionDurationQuestion }
      : baselineDialogue;
  const planningIntent = semantic.normalization.document?.planningIntent ?? null;
  const semanticChanged = Boolean(
    semanticDiff
    && (semanticDiff.added.length > 0
      || semanticDiff.superseded.length > 0
      || semanticDiff.removed.length > 0),
  );
  const previousDraftGenerationIntent = input.previousState?.draftGenerationIntent ?? null;
  const authorized = isWeeklyPlanningStableV5PreviewAuthorized({
    previousStatus: input.previousState?.status ?? null,
    previousDraftGenerationIntent,
    planningIntent,
    semanticChanged,
    hadMachinePendingQuestion: hadMachinePendingQuestion(input.previousState),
  });

  return {
    semanticDiff,
    continuationAccepted,
    groundingRecords,
    horizon,
    schedulerContext,
    externalSources,
    activeGraph,
    observedPaceProjection,
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
