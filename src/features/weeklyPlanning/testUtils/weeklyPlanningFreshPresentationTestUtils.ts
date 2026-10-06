import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import {
  bindWeeklyPlanningQuestionPresentation,
  resolveWeeklyPlanningQuestionPresentationFreshness,
  type WeeklyPlanningQuestionPresentationFreshness,
} from '../intake/weeklyPlanningQuestionPresentation';
import { getWeeklyPlanningStableV5RuntimeSession } from '../application/weeklyPlanningStableV5RuntimeSession';
import type { WeeklyPlanningMessage } from '../types';

export const FRESH_PRESENTATION_TEST_STATE_REVISION = 4;

/**
 * Test fixture for a pending question that was committed together with its presenting
 * assistant message, exactly as the turn controller binds it. Use it wherever a test
 * needs the question to be eligible as the one the user is answering.
 */
export function withFreshQuestionPresentationForTest(params: {
  state: PlanningIntakeState;
  graphRevision: number;
  stateRevision?: number;
}): {
  state: PlanningIntakeState;
  messages: WeeklyPlanningMessage[];
  inputStateRevision: number;
} {
  const stateRevision = params.stateRevision ?? FRESH_PRESENTATION_TEST_STATE_REVISION;
  const assistantMessage: WeeklyPlanningMessage = {
    id: 'fixture-turn:assistant',
    role: 'assistant',
    content: 'fixture question',
    createdAt: '2026-10-07T09:00:00.000Z',
  };
  return {
    state: bindWeeklyPlanningQuestionPresentation({
      state: params.state,
      content: {
        responseSource: 'deterministic_fallback',
        currentTurnGrounding: 'none',
        selfRepairNotice: false,
        groundingContext: { proposed: 0, contested: 0 },
        previewPromotionControl: false,
      },
      turnId: 'fixture-turn',
      assistantMessageId: assistantMessage.id,
      planningStateRevision: stateRevision,
      graphRevision: params.graphRevision,
    }),
    messages: [assistantMessage],
    inputStateRevision: stateRevision,
  };
}

export function freshnessForTest(params: {
  state: PlanningIntakeState;
  graphRevision: number;
  stateRevision?: number;
}): {
  freshness: WeeklyPlanningQuestionPresentationFreshness;
  state: PlanningIntakeState;
  messages: WeeklyPlanningMessage[];
} {
  const fixture = withFreshQuestionPresentationForTest(params);
  return {
    state: fixture.state,
    messages: fixture.messages,
    freshness: resolveWeeklyPlanningQuestionPresentationFreshness({
      previousState: fixture.state,
      inputStateRevision: fixture.inputStateRevision,
      messages: fixture.messages,
      graphRevision: params.graphRevision,
    }),
  };
}

/**
 * What the controller hands the next turn after it committed `result`: the state with the
 * pending question bound to the presenting assistant message, the message list ending in
 * that message, and the planning-state revision of the commit. Multi-turn runtime tests
 * chain through this so they exercise the production freshness gate instead of bypassing it.
 */
export function committedTurnForTest(params: {
  result: { state: PlanningIntakeState; message: string; stableV5Graph?: { revision: number } };
  graphRevision?: number;
  precedingMessages?: readonly WeeklyPlanningMessage[];
  stateRevision?: number;
}): {
  previousState: PlanningIntakeState;
  messages: WeeklyPlanningMessage[];
  inputStateRevision: number;
} {
  const stateRevision = params.stateRevision ?? FRESH_PRESENTATION_TEST_STATE_REVISION;
  const assistantMessage: WeeklyPlanningMessage = {
    id: `committed-turn-${stateRevision}:assistant`,
    role: 'assistant',
    content: params.result.message,
    createdAt: '2026-10-07T09:00:00.000Z',
  };
  const graphRevision = params.graphRevision ?? params.result.stableV5Graph?.revision;
  return {
    previousState: graphRevision === undefined
      ? params.result.state
      : bindWeeklyPlanningQuestionPresentation({
          state: params.result.state,
          content: {
            responseSource: 'deterministic_fallback',
            currentTurnGrounding: 'none',
            selfRepairNotice: false,
            groundingContext: { proposed: 0, contested: 0 },
            previewPromotionControl: false,
          },
          turnId: `committed-turn-${stateRevision}`,
          assistantMessageId: assistantMessage.id,
          planningStateRevision: stateRevision,
          graphRevision,
        }),
    messages: [...(params.precedingMessages ?? []), assistantMessage],
    inputStateRevision: stateRevision,
  };
}

/**
 * Chains a runtime-level test turn to the state of the previous turn the way the
 * controller would: binds the pending question to its presenting message at the graph
 * revision the (finalized) runtime session currently holds.
 */
export function chainedPreviousTurnForTest(params: {
  previousState: PlanningIntakeState | undefined;
  conversationId: string;
  messages?: readonly WeeklyPlanningMessage[];
}): {
  previousState: PlanningIntakeState | undefined;
  messages: readonly WeeklyPlanningMessage[];
  inputStateRevision: number | undefined;
} {
  if (!params.previousState) {
    return { previousState: undefined, messages: params.messages ?? [], inputStateRevision: undefined };
  }
  const graphRevision = getWeeklyPlanningStableV5RuntimeSession(params.conversationId)?.graph.revision;
  const committed = committedTurnForTest({
    result: { state: params.previousState, message: params.previousState.questions[0] ?? '' },
    graphRevision,
    precedingMessages: params.messages ?? [],
  });
  return committed;
}
