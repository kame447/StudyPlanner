import { describe, expect, it, vi } from 'vitest';
import {
  createInitialPlanningState,
  weeklyPlanningReducer,
} from './weeklyPlanningReducer';
import {
  cancelWeeklyPlanningControlledTurn,
  createWeeklyPlanningControllerSession,
  submitWeeklyPlanningControlledTurn,
} from './weeklyPlanningTurnController';
import type { WeeklyPlanningTurnExecutionResult } from './weeklyPlanningTurnExecutor';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function executionResult(): WeeklyPlanningTurnExecutionResult {
  return {
    state: {
      status: 'revision_pending',
      intent: 'weekly_study_planning',
      tasks: [],
      progress: [],
      unitRates: [],
      constraints: [],
      priorityPolicy: { kind: 'unknown' },
      missing: [],
      assumptions: [],
      uncertainties: [],
      questions: ['次の条件を教えてください。'],
      shouldCreateDraft: false,
      shouldSavePlan: false,
      draftGenerationIntent: 'not_requested',
      sourceTurns: ['予定を立てたい'],
    },
    message: '次の条件を教えてください。',
    draftCandidates: [],
  };
}

describe('weekly planning controller runtime commit boundary', () => {
  it('discards an async execution result when its pending turn was cancelled', async () => {
    let state = createInitialPlanningState('2026-07-20');
    const session = createWeeklyPlanningControllerSession(
      'owner-1',
      '2026-07-20',
      'conversation-1',
    );
    const pendingResult = deferred<WeeklyPlanningTurnExecutionResult>();
    const commitExecutionResult = vi.fn();
    const discardExecutionResult = vi.fn();

    const submission = submitWeeklyPlanningControlledTurn({
      session,
      ownerId: 'owner-1',
      userText: '予定を立てたい',
      getState: () => state,
      dispatch(action) {
        state = weeklyPlanningReducer(state, action);
        return state;
      },
      execute: async () => pendingResult.promise,
      commitExecutionResult,
      discardExecutionResult,
      now: () => '2026-07-23T09:00:00.000Z',
    });

    expect(state.pendingTurn).toBeDefined();
    expect(cancelWeeklyPlanningControlledTurn({
      getState: () => state,
      dispatch(action) {
        state = weeklyPlanningReducer(state, action);
        return state;
      },
    })).toBe(true);

    pendingResult.resolve(executionResult());
    await expect(submission).resolves.toEqual({
      accepted: false,
      draftCandidates: [],
    });
    expect(commitExecutionResult).not.toHaveBeenCalled();
    expect(discardExecutionResult).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'stale' }),
    );
    expect(state.messages.filter((message) => message.role === 'assistant')).toHaveLength(0);
  });

  it('commits runtime state only after confirming the same pending turn', async () => {
    let state = createInitialPlanningState('2026-07-20');
    const session = createWeeklyPlanningControllerSession(
      'owner-1',
      '2026-07-20',
      'conversation-1',
    );
    const order: string[] = [];

    const result = await submitWeeklyPlanningControlledTurn({
      session,
      ownerId: 'owner-1',
      userText: '予定を立てたい',
      getState: () => state,
      dispatch(action) {
        order.push(action.type);
        state = weeklyPlanningReducer(state, action);
        return state;
      },
      execute: async () => executionResult(),
      commitExecutionResult() {
        order.push('runtime_commit');
      },
      onCommittedTurn() {
        order.push('committed_callback');
      },
      now: () => '2026-07-23T09:00:00.000Z',
    });

    expect(result.accepted).toBe(true);
    expect(order).toEqual([
      'begin_turn',
      'runtime_commit',
      'commit_turn',
      'committed_callback',
    ]);
    expect(state.pendingTurn).toBeUndefined();
    expect(state.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
  });
});
