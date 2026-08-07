import type { WeeklyPlanningDialogueRendererTrace } from '../trace/weeklyPlanningDialogueRendererTrace';
import type { WeeklyPlanningTraceResponseSource } from '../trace/weeklyPlanningTraceTypes';

export const WEEKLY_PLANNING_REAL_EVAL_MAX_SEMANTIC_REQUESTS_PER_TURN = 2;
export const WEEKLY_PLANNING_REAL_EVAL_MAX_RENDERER_REQUESTS_PER_TURN = 1;
export const WEEKLY_PLANNING_REAL_EVAL_MAX_API_REQUESTS_PER_TURN =
  WEEKLY_PLANNING_REAL_EVAL_MAX_SEMANTIC_REQUESTS_PER_TURN
  + WEEKLY_PLANNING_REAL_EVAL_MAX_RENDERER_REQUESTS_PER_TURN;
export const WEEKLY_PLANNING_REAL_EVAL_MAX_TURNS_PER_SCENARIO = 8;
export const WEEKLY_PLANNING_REAL_EVAL_ABSOLUTE_MAX_TURNS = 40;
export const WEEKLY_PLANNING_REAL_EVAL_ABSOLUTE_MAX_API_REQUESTS =
  WEEKLY_PLANNING_REAL_EVAL_ABSOLUTE_MAX_TURNS
  * WEEKLY_PLANNING_REAL_EVAL_MAX_API_REQUESTS_PER_TURN;

export interface WeeklyPlanningConversationEvalTurnAiUsage {
  semanticRequestCount: number;
  rendererRequestCount: number;
  totalRequestCount: number;
  meaningInterpretationUsedAi: boolean;
  assistantResponseUsedAi: boolean;
  withinPerTurnRequestBudget: boolean;
  errors: string[];
}

export interface WeeklyPlanningConversationEvalSuiteAiUsage {
  turnCount: number;
  semanticRequestCount: number;
  rendererRequestCount: number;
  totalRequestCount: number;
  maximumAllowedRequestCount: number;
  absoluteMaximumTurnCount: number;
  absoluteMaximumRequestCount: number;
  allTurnsUsedRequiredAiPaths: boolean;
  withinSuiteRequestBudget: boolean;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function countWeeklyPlanningSemanticProviderRequests(
  trace: readonly unknown[],
): number {
  return trace.filter((entry) =>
    isRecord(entry) && entry.stage === 'semantic_provider_request').length;
}

export function evaluateWeeklyPlanningConversationTurnAiUsage(params: {
  responseSource: WeeklyPlanningTraceResponseSource | null;
  semanticTrace: readonly unknown[];
  dialogueRendererTrace: WeeklyPlanningDialogueRendererTrace | null | undefined;
}): WeeklyPlanningConversationEvalTurnAiUsage {
  const semanticRequestCount = countWeeklyPlanningSemanticProviderRequests(
    params.semanticTrace,
  );
  const rendererRequestCount = params.dialogueRendererTrace?.request ? 1 : 0;
  const totalRequestCount = semanticRequestCount + rendererRequestCount;
  const meaningInterpretationUsedAi = semanticRequestCount >= 1;
  const assistantResponseUsedAi =
    params.responseSource === 'ai'
    && params.dialogueRendererTrace?.response.status === 'rendered'
    && params.dialogueRendererTrace.decision.branch === 'ai_rendered'
    && params.dialogueRendererTrace.decision.responseSource === 'ai';
  const withinPerTurnRequestBudget =
    semanticRequestCount <= WEEKLY_PLANNING_REAL_EVAL_MAX_SEMANTIC_REQUESTS_PER_TURN
    && rendererRequestCount <= WEEKLY_PLANNING_REAL_EVAL_MAX_RENDERER_REQUESTS_PER_TURN
    && totalRequestCount <= WEEKLY_PLANNING_REAL_EVAL_MAX_API_REQUESTS_PER_TURN;
  const errors: string[] = [];

  if (!meaningInterpretationUsedAi) {
    errors.push('meaning-interpretation-did-not-use-ai');
  }
  if (!assistantResponseUsedAi) {
    errors.push('assistant-response-did-not-use-ai-renderer');
  }
  if (!withinPerTurnRequestBudget) {
    errors.push(
      `api-request-budget-exceeded:${semanticRequestCount}:${rendererRequestCount}:${totalRequestCount}`,
    );
  }

  return {
    semanticRequestCount,
    rendererRequestCount,
    totalRequestCount,
    meaningInterpretationUsedAi,
    assistantResponseUsedAi,
    withinPerTurnRequestBudget,
    errors,
  };
}

export function shouldContinueWeeklyPlanningRealEvalAfterScenario(
  status: 'passed' | 'failed',
): boolean {
  return status === 'passed';
}

export function maximumWeeklyPlanningRealEvalRequestsForTurns(
  turnCount: number,
): number {
  if (!Number.isInteger(turnCount) || turnCount < 0) {
    throw new Error(`Invalid turn count: ${turnCount}`);
  }
  return Math.min(
    turnCount * WEEKLY_PLANNING_REAL_EVAL_MAX_API_REQUESTS_PER_TURN,
    WEEKLY_PLANNING_REAL_EVAL_ABSOLUTE_MAX_API_REQUESTS,
  );
}

export function summarizeWeeklyPlanningConversationEvalAiUsage(
  turns: readonly WeeklyPlanningConversationEvalTurnAiUsage[],
): WeeklyPlanningConversationEvalSuiteAiUsage {
  const semanticRequestCount = turns.reduce(
    (total, turn) => total + turn.semanticRequestCount,
    0,
  );
  const rendererRequestCount = turns.reduce(
    (total, turn) => total + turn.rendererRequestCount,
    0,
  );
  const totalRequestCount = semanticRequestCount + rendererRequestCount;
  const maximumAllowedRequestCount = maximumWeeklyPlanningRealEvalRequestsForTurns(
    turns.length,
  );
  const allTurnsUsedRequiredAiPaths = turns.every(
    (turn) => turn.meaningInterpretationUsedAi && turn.assistantResponseUsedAi,
  );
  const withinSuiteRequestBudget =
    turns.length <= WEEKLY_PLANNING_REAL_EVAL_ABSOLUTE_MAX_TURNS
    && turns.every((turn) => turn.withinPerTurnRequestBudget)
    && totalRequestCount <= maximumAllowedRequestCount
    && totalRequestCount <= WEEKLY_PLANNING_REAL_EVAL_ABSOLUTE_MAX_API_REQUESTS;
  const errors = turns.flatMap((turn, index) =>
    turn.errors.map((error) => `turn-${index + 1}:${error}`));

  if (turns.length > WEEKLY_PLANNING_REAL_EVAL_ABSOLUTE_MAX_TURNS) {
    errors.push(
      `suite-turn-budget-exceeded:${turns.length}:${WEEKLY_PLANNING_REAL_EVAL_ABSOLUTE_MAX_TURNS}`,
    );
  }
  if (totalRequestCount > maximumAllowedRequestCount) {
    errors.push(
      `suite-api-request-budget-exceeded:${totalRequestCount}:${maximumAllowedRequestCount}`,
    );
  }
  if (totalRequestCount > WEEKLY_PLANNING_REAL_EVAL_ABSOLUTE_MAX_API_REQUESTS) {
    errors.push(
      `suite-absolute-api-request-budget-exceeded:${totalRequestCount}:${WEEKLY_PLANNING_REAL_EVAL_ABSOLUTE_MAX_API_REQUESTS}`,
    );
  }

  return {
    turnCount: turns.length,
    semanticRequestCount,
    rendererRequestCount,
    totalRequestCount,
    maximumAllowedRequestCount,
    absoluteMaximumTurnCount: WEEKLY_PLANNING_REAL_EVAL_ABSOLUTE_MAX_TURNS,
    absoluteMaximumRequestCount: WEEKLY_PLANNING_REAL_EVAL_ABSOLUTE_MAX_API_REQUESTS,
    allTurnsUsedRequiredAiPaths,
    withinSuiteRequestBudget,
    errors,
  };
}
