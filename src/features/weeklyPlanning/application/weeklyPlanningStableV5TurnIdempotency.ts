import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutionTypes';
import {
  weeklyPlanningStableV5ResultProjector,
} from './weeklyPlanningStableV5ResultProjection';
import type { ExecuteWeeklyPlanningStableV5RuntimeTurnInput } from './weeklyPlanningStableV5RuntimeContracts';
import {
  getWeeklyPlanningStableV5RuntimeSession,
} from './weeklyPlanningStableV5RuntimeSession';

export type WeeklyPlanningStableV5IdempotencyDecision =
  | { kind: 'proceed' }
  | {
      kind: 'duplicate';
      result: WeeklyPlanningTurnExecutionResult;
    };

function emptyCompatibilityState(): PlanningIntakeState {
  return {
    status: 'idle',
    intent: 'weekly_study_planning',
    tasks: [],
    progress: [],
    unitRates: [],
    constraints: [],
    priorityPolicy: { kind: 'unknown' },
    missing: [],
    assumptions: [],
    uncertainties: [],
    questions: [],
    shouldCreateDraft: false,
    shouldSavePlan: false,
    draftGenerationIntent: 'not_requested',
    sourceTurns: [],
  };
}

function duplicateTurnResult(
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
): WeeklyPlanningTurnExecutionResult {
  const previous = input.previousState ?? emptyCompatibilityState();
  return {
    state: {
      ...previous,
      shouldCreateDraft: false,
      shouldSavePlan: false,
      draftGenerationIntent: 'not_requested',
    },
    message: '同じ送信はすでに処理済みのため、予定を重複して作成しませんでした。',
    draftCandidates: [],
    responseSource: 'system',
  };
}

function isDuplicateCommittedTurn(input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput): boolean {
  const session = getWeeklyPlanningStableV5RuntimeSession(input.conversationId);
  if (!session || session.ownerId !== input.userId) return false;
  return session.graph.appliedTurnKeys.includes(
    `${input.conversationId}:${input.traceRequestId}`,
  );
}

function evaluateIdempotency(
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
): WeeklyPlanningStableV5IdempotencyDecision {
  if (!isDuplicateCommittedTurn(input)) return { kind: 'proceed' };
  return {
    kind: 'duplicate',
    result: weeklyPlanningStableV5ResultProjector.duplicate({
      input,
      result: duplicateTurnResult(input),
    }),
  };
}

export const weeklyPlanningStableV5IdempotencyGate = {
  evaluate: evaluateIdempotency,
} as const;
