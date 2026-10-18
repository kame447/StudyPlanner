import { expect } from 'vitest';
import type { ExecuteWeeklyPlanningStableV5RuntimeTurnInput } from '../../application/weeklyPlanningStableV5RuntimeExecutor';
import { getWeeklyPlanningStableV5StagedGraph } from '../../application/weeklyPlanningStableV5RuntimeSession';
import { weeklyPlanningTurnStagingLifecycle } from '../../application/weeklyPlanningTurnSideEffects';
import { resolveWeeklyPlanningQuestionPresentationFreshness } from '../../intake/weeklyPlanningQuestionPresentation';
import type { PlanningState, WeeklyPlanningAction } from '../../types';
import { createInitialPlanningState, weeklyPlanningReducer } from '../../weeklyPlanningReducer';
import { createWeeklyPlanningControllerSession, isSameWeeklyPlanningPendingTurn, submitWeeklyPlanningControlledTurn } from '../../weeklyPlanningTurnController';
import { executeWeeklyPlanningTurn, type WeeklyPlanningTurnExecutionResult } from '../../weeklyPlanningTurnExecutor';

/** Conversation fixtures keep the typed normalizer mock, but use the actual outer
 * renderer, message commit, presentation binding and staged-graph finalization.
 * No presentation receipt is constructed by this helper. One instance = one conversation.
 */
export function createPresentedWeeklyPlanningConversation() {
  let state: PlanningState;
  let session: ReturnType<typeof createWeeklyPlanningControllerSession>;
  const dispatch = (action: WeeklyPlanningAction) => (state = weeklyPlanningReducer(state, action));
  return {
    getState: () => state,
    dispatch,
    async run(input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput): Promise<WeeklyPlanningTurnExecutionResult> {
      if (!session) {
        state = createInitialPlanningState(input.selectedDate);
        session = createWeeklyPlanningControllerSession(input.userId, state.weekStartDate, input.conversationId);
      }
      expect([session.ownerId, session.conversationId]).toEqual([input.userId, input.conversationId]);
      let execution: WeeklyPlanningTurnExecutionResult | undefined;
      const submission = await submitWeeklyPlanningControlledTurn({
        session, ownerId: input.userId, userText: input.userText,
        getState: () => state, dispatch,
        now: () => input.requestContext.startedAtIso,
        async execute({ snapshot, pending }) {
          execution = await executeWeeklyPlanningTurn({
            ...input, previousState: snapshot.intakeState, messages: snapshot.messages,
            traceRequestId: pending.requestId, inputStateRevision: pending.baseRevision,
            retainedPreviewCount: snapshot.previewCandidates?.length ?? 0,
            isCurrentTurn: () => state.revision === pending.baseRevision + 1
              && isSameWeeklyPlanningPendingTurn(state.pendingTurn, pending),
          });
          return execution;
        },
        prepareExecutionCommit: ({ pending }) => {
          const staged = getWeeklyPlanningStableV5StagedGraph({
            ownerId: input.userId, conversationId: pending.conversationId, requestId: pending.requestId,
          });
          expect(staged, execution?.message).not.toBeNull();
          expect(staged).toEqual(execution?.stableV5Graph);
          return weeklyPlanningTurnStagingLifecycle.prepare({ ownerId: input.userId, pending });
        },
        discardExecutionResult: ({ pending }) => weeklyPlanningTurnStagingLifecycle.discard(pending),
      });
      expect(submission.accepted).toBe(true);
      expect(execution).toBeDefined();
      expect(state.intakeState).toBeDefined();
      if (!execution!.failure && execution!.questionPresentationContent && execution!.state.lastQuestionContext) {
        expect(resolveWeeklyPlanningQuestionPresentationFreshness({
          previousState: state.intakeState, messages: state.messages,
          inputStateRevision: state.revision, graphRevision: execution!.stableV5Graph!.revision,
        }).status).toBe('fresh');
      }
      return { ...execution!, state: state.intakeState! };
    },
  };
}
