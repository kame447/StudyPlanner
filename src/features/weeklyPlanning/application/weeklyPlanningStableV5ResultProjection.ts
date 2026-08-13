import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import {
  rewriteWeeklyPlanningEffortQuestionV5,
} from '../semantic/weeklyPlanningEffortQuestionRendererV5';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutionTypes';
import type { ExecuteWeeklyPlanningStableV5RuntimeTurnInput } from './weeklyPlanningStableV5RuntimeContracts';
import {
  getWeeklyPlanningStableV5RuntimeSession,
  getWeeklyPlanningStableV5StagedGraph,
} from './weeklyPlanningStableV5RuntimeSession';

function withFreshestAvailableGraph(
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
  result: WeeklyPlanningTurnExecutionResult,
): WeeklyPlanningTurnExecutionResult {
  const stagedGraph = getWeeklyPlanningStableV5StagedGraph({
    ownerId: input.userId,
    conversationId: input.conversationId,
    requestId: input.traceRequestId,
  });
  if (stagedGraph) {
    return {
      ...result,
      stableV5Graph: stagedGraph,
    };
  }

  const session = getWeeklyPlanningStableV5RuntimeSession(input.conversationId);
  if (!session || session.ownerId !== input.userId) return result;

  const resultGraph = result.stableV5Graph;
  if (resultGraph && resultGraph.revision >= session.graph.revision) {
    return result;
  }

  return {
    ...result,
    stableV5Graph: session.graph,
  };
}

function withHumanScaleEffortQuestion(
  result: WeeklyPlanningTurnExecutionResult,
): WeeklyPlanningTurnExecutionResult {
  const context = result.state.lastQuestionContext;
  const workloadFactId = context?.targetSlot === 'stable_v5:missing_effort_estimate'
    ? context.topicId
    : undefined;
  const graph = result.stableV5Graph;
  if (!graph || !workloadFactId) return result;

  const message = rewriteWeeklyPlanningEffortQuestionV5({
    graph,
    workloadFactId,
    message: result.message,
  });
  if (message === result.message) return result;
  return {
    ...result,
    message,
    state: {
      ...result.state,
      questions: result.state.questions.map((question) =>
        rewriteWeeklyPlanningEffortQuestionV5({
          graph,
          workloadFactId,
          message: question,
        })),
    },
  };
}

function previousTurnMayHoldPreview(
  previousState: PlanningIntakeState | undefined,
): boolean {
  if (!previousState) return false;
  return previousState.status === 'draft_ready'
    || (
      previousState.status === 'revision_pending'
      && previousState.draftGenerationIntent === 'user_authorized'
    );
}

function withRepairSafePreview(
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
  result: WeeklyPlanningTurnExecutionResult,
): WeeklyPlanningTurnExecutionResult {
  const repairPending = result.draftCandidates.length === 0
    && result.state.questions.length > 0;
  if (!repairPending || !previousTurnMayHoldPreview(input.previousState)) {
    return result;
  }

  return {
    ...result,
    preserveExistingPreview: true,
    state: {
      ...result.state,
      status: 'revision_pending',
      shouldCreateDraft: false,
      shouldSavePlan: false,
      draftGenerationIntent: 'user_authorized',
    },
  };
}

function projectDuplicateResult(params: {
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput;
  result: WeeklyPlanningTurnExecutionResult;
}): WeeklyPlanningTurnExecutionResult {
  return withFreshestAvailableGraph(params.input, params.result);
}

function projectCoreResult(params: {
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput;
  result: WeeklyPlanningTurnExecutionResult;
}): WeeklyPlanningTurnExecutionResult {
  return withRepairSafePreview(
    params.input,
    withHumanScaleEffortQuestion(
      withFreshestAvailableGraph(params.input, params.result),
    ),
  );
}

export const weeklyPlanningStableV5ResultProjector = {
  duplicate: projectDuplicateResult,
  core: projectCoreResult,
} as const;
