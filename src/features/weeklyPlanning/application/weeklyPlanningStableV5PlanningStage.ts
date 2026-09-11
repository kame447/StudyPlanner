import { recordWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import {
  evaluateWeeklyPlanningStableV5Planning,
  type WeeklyPlanningStableV5PlanningEvaluation,
} from './weeklyPlanningStableV5PlanningEvaluation';
import type { ExecuteWeeklyPlanningStableV5RuntimeTurnInput } from './weeklyPlanningStableV5RuntimeContracts';
import { stableV5BlockingIssueCode } from './weeklyPlanningStableV5RuntimeQuestions';
import { activeStableV5PlanningWindows } from './weeklyPlanningStableV5SemanticContext';
import type { WeeklyPlanningStableV5SemanticTurnResult } from './weeklyPlanningStableV5SemanticTurn';

type SuccessfulSemanticTurn = Extract<
  WeeklyPlanningStableV5SemanticTurnResult,
  { status: 'success' }
>;

function recordPlanningEvaluationTrace(params: {
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput;
  semanticTurn: SuccessfulSemanticTurn;
  evaluation: WeeklyPlanningStableV5PlanningEvaluation;
}): void {
  const { input, semanticTurn, evaluation } = params;
  const { requestContext, semantic } = semanticTurn;
  const {
    continuationAccepted,
    groundingRecords,
    horizon,
    schedulerContext,
    externalSources,
    activeGraph,
    compilation,
    provisionalTimeboxProjection,
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
      provisionalTimeboxProjection,
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
        provisionalTimeboxRequested:
          semantic.normalization.contextualDirective?.kind === 'provisional_timebox',
        criterion:
          'create_plan OR explicit provisional_timebox OR durable user_authorized before draft_ready OR (draft_ready + update_plan + semanticChanged)',
        authorized,
      },
    },
  });
}

export function runWeeklyPlanningStableV5PlanningStage(params: {
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput;
  semanticTurn: SuccessfulSemanticTurn;
}): WeeklyPlanningStableV5PlanningEvaluation {
  const evaluation = evaluateWeeklyPlanningStableV5Planning(params);
  recordPlanningEvaluationTrace({
    ...params,
    evaluation,
  });
  return evaluation;
}
