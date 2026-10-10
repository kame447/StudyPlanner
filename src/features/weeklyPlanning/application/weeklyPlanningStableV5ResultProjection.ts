import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { areWeeklyPlanningJsonValuesEqual } from '../semantic/weeklyPlanningJsonValueEquality';
import { resolveWeeklyPlanningAcceptedPlanningWindow } from './weeklyPlanningTemporalContext';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
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

/** Scope the scheduler's existing view, retaining all present and future domain fields. */
function previewPlacementBasis(
  view: ReturnType<typeof createWeeklyPlanningActiveSchedulerGraphViewV5>,
  previousTaskIds: ReadonlySet<string>,
): unknown {
  const taskOwnedCollections = new Set([
    'studyContexts', 'components', 'workloads', 'effortEstimates',
    'temporalConstraints', 'taskDateRules', 'recurrences',
  ]);
  const basis = Object.fromEntries(Object.entries(view)
    .filter(([key]) => key !== 'revision' && key !== 'uncertainties')
    .map(([key, value]) => {
      if (!Array.isArray(value)) return [key, value];
      const facts = value.filter((fact) => {
        if (key === 'tasks') return previousTaskIds.has(fact.id);
        if (taskOwnedCollections.has(key)) return previousTaskIds.has(fact.taskId);
        if (key === 'relations') {
          return previousTaskIds.has(fact.fromTaskId) || previousTaskIds.has(fact.toTaskId);
        }
        // New/global collections remain compared until their scope is explicitly understood.
        return true;
      }).map((fact) => fact !== null && typeof fact === 'object' && !Array.isArray(fact)
        ? Object.fromEntries(Object.entries(fact)
          .filter(([field]) => field !== 'source' && field !== 'createdRevision'))
        : fact);
      return [key, facts];
    }));
  // The accepted graph uses JSON-wire semantics for optional fields, as persistence does.
  // Array order stays meaningful; only object-key order is canonicalized by the existing owner.
  return JSON.parse(JSON.stringify(basis));
}

function acceptedPreviewBasisUnchanged(
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
  result: WeeklyPlanningTurnExecutionResult,
): boolean {
  const session = getWeeklyPlanningStableV5RuntimeSession(input.conversationId);
  if (!session || session.ownerId !== input.userId || !result.stableV5Graph) return false;
  const before = createWeeklyPlanningActiveSchedulerGraphViewV5(session.graph);
  const after = createWeeklyPlanningActiveSchedulerGraphViewV5(result.stableV5Graph);
  const previousWindow = resolveWeeklyPlanningAcceptedPlanningWindow({
    graph: before,
    requestContext: input.requestContext,
    groundingRecords: input.previousState?.groundingRecords,
    requireEstablishedRange: true,
  });
  if (before.planningWindows.length > 0 && !previousWindow) return false;
  if (previousWindow && (previousWindow.endDate < input.requestContext.notBeforeDate
    || (previousWindow.endDate === input.requestContext.notBeforeDate && input.requestContext.notBeforeTime === '24:00'))) return false;
  const currentWindow = resolveWeeklyPlanningAcceptedPlanningWindow({
    graph: after,
    requestContext: input.requestContext,
    groundingRecords: result.state.groundingRecords,
  });
  if (!areWeeklyPlanningJsonValuesEqual(previousWindow, currentWindow)) return false;
  const relevantTaskIds = new Set([
    ...before.tasks.map((task) => task.id),
    // TaskCommitmentResolver owns this discriminant: even a new task's fixed interval
    // creates global busy time (or a blocking unresolved commitment), unlike new movable work.
    ...after.temporalConstraints.filter((fact) => fact.kind === 'fixed_interval').map((fact) => fact.taskId),
  ]);
  // Candidate membership is unavailable here. Including all previously active tasks may
  // conservatively invalidate after an earlier turn added unresolved unrelated work.
  return areWeeklyPlanningJsonValuesEqual(
    previewPlacementBasis(before, relevantTaskIds),
    previewPlacementBasis(after, relevantTaskIds),
  );
}

function withRepairSafePreview(
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
  result: WeeklyPlanningTurnExecutionResult,
): WeeklyPlanningTurnExecutionResult {
  const repairPending = result.draftCandidates.length === 0
    && result.state.questions.length > 0;
  const retainRepairPreview = repairPending && previousTurnMayHoldPreview(input.previousState);
  const retentionRequested = retainRepairPreview || result.preserveExistingPreview === true;
  if (result.draftCandidates.length > 0 || !retentionRequested) return result;
  if (!acceptedPreviewBasisUnchanged(input, result)) {
    return { ...result, preserveExistingPreview: false };
  }
  if (!retainRepairPreview) return result;

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
    withFreshestAvailableGraph(params.input, params.result),
  );
}

export const weeklyPlanningStableV5ResultProjector = {
  duplicate: projectDuplicateResult,
  core: projectCoreResult,
} as const;
