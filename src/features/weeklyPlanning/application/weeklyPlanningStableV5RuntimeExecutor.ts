import type {
  GenericSchedulerInputCompilationResult,
} from '../semantic/weeklyPlanningGenericSchedulerInput';
import {
  recordWeeklyPlanningStableV5DebugTrace,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutionTypes';
import {
  evaluateWeeklyPlanningStableV5Planning,
} from './weeklyPlanningStableV5PlanningEvaluation';
import {
  executeWeeklyPlanningStableV5Preview,
} from './weeklyPlanningStableV5PreviewExecution';
import {
  weeklyPlanningStableV5ResponseRouter,
} from './weeklyPlanningStableV5ResponseRouting';
import type {
  ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
} from './weeklyPlanningStableV5RuntimeContracts';
import {
  stableV5BlockingIssueCode,
} from './weeklyPlanningStableV5RuntimeQuestions';
import {
  activeStableV5PlanningWindows,
} from './weeklyPlanningStableV5SemanticContext';
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

export async function executeWeeklyPlanningStableV5RuntimeTurn(
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
): Promise<WeeklyPlanningTurnExecutionResult> {
  const semanticTurn = await executeWeeklyPlanningStableV5SemanticTurn(input);
  if (semanticTurn.status === 'failure') return semanticTurn.output;

  const { requestContext, semantic } = semanticTurn;
  stageWeeklyPlanningStableV5Turn({ input, semanticTurn });

  const evaluation = evaluateWeeklyPlanningStableV5Planning({
    input,
    semanticTurn,
  });
  const {
    continuationAccepted,
    groundingRecords,
    horizon,
    schedulerContext,
    externalSources,
    activeGraph,
    compilation,
    repairDecision,
    dialogue,
    planningIntent,
    semanticChanged,
    previousDraftGenerationIntent,
    authorized,
  } = evaluation;

  recordWeeklyPlanningStableV5DebugTrace({
    requestId: input.traceRequestId,
    stage: 'runtime_scheduler_dialogue_evaluated',
    severity: dialogue.status === 'ask_question' ? 'warn' : 'info',
    data: {
      activePlanningWindows: activeStableV5PlanningWindows(semantic.graph),
      selectedDate: input.selectedDate,
      requestContext,
      resolvedHorizon: horizon,
      grounding: { continuationAccepted, records: groundingRecords },
      repair: {
        mode: repairDecision.mode,
        deferredIssueIds: repairDecision.deferredIssueIds,
        reopenedIssueIds: repairDecision.reopenedIssueIds,
        agenda: repairDecision.agenda,
      },
      schedulerInput: {
        graph: activeGraph,
        context: schedulerContext,
        externalSources,
      },
      compilation,
      dialogue,
      firstBlockingIssueCodeInCompilationOrder: stableV5BlockingIssueCode(compilation) ?? null,
      selectedQuestion: dialogue.status === 'ask_question' ? dialogue.question : null,
      authorization: {
        planningIntent,
        semanticChanged,
        previousDraftGenerationIntent,
        criterion: 'create_plan OR durable user_authorized before draft_ready OR (draft_ready + update_plan + semanticChanged)',
        authorized,
      },
    },
  });

  const responseRoute = weeklyPlanningStableV5ResponseRouter.beforePreview({
    input,
    graph: semantic.graph,
    evaluation,
  });
  if (responseRoute.kind === 'respond') return responseRoute.output;

  const preview = executeWeeklyPlanningStableV5Preview({
    input,
    graph: semantic.graph,
    schedulerInput: responseRoute.schedulerInput,
    requestContext,
  });

  return weeklyPlanningStableV5ResponseRouter.afterPreview({
    input,
    semanticTurn,
    evaluation,
    preview,
  });
}

export function getWeeklyPlanningStableV5BlockingIssueCode(
  compilation: GenericSchedulerInputCompilationResult,
): string | undefined {
  return stableV5BlockingIssueCode(compilation);
}
