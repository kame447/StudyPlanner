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
    const prepareExecutionCommit = vi.fn();
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
      prepareExecutionCommit,
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
    expect(prepareExecutionCommit).not.toHaveBeenCalled();
    expect(discardExecutionResult).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'stale' }),
    );
    expect(state.messages.filter((message) => message.role === 'assistant')).toHaveLength(0);
  });

  it('prepares authoritative runtime state before the reducer exposes success', async () => {
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
      prepareExecutionCommit() {
        order.push('runtime_prepare');
        return {
          rollback() {
            order.push('runtime_rollback');
          },
          complete() {
            order.push('runtime_complete');
          },
        };
      },
      onCommittedTurn() {
        order.push('committed_callback');
      },
      now: () => '2026-07-23T09:00:00.000Z',
    });

    expect(result.accepted).toBe(true);
    expect(order).toEqual([
      'begin_turn',
      'runtime_prepare',
      'commit_turn',
      'runtime_complete',
      'committed_callback',
    ]);
    expect(state.pendingTurn).toBeUndefined();
    expect(state.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
  });

  it('rolls prepared runtime state back when the reducer rejects commit_turn', async () => {
    let state = createInitialPlanningState('2026-07-20');
    const session = createWeeklyPlanningControllerSession(
      'owner-1',
      '2026-07-20',
      'conversation-1',
    );
    const rollback = vi.fn();
    const complete = vi.fn();
    const prepareExecutionCommit = vi.fn(() => ({ rollback, complete }));
    const discardExecutionResult = vi.fn();

    const result = await submitWeeklyPlanningControlledTurn({
      session,
      ownerId: 'owner-1',
      userText: '予定を立てたい',
      getState: () => state,
      dispatch(action) {
        if (action.type === 'commit_turn') return state;
        state = weeklyPlanningReducer(state, action);
        return state;
      },
      execute: async () => executionResult(),
      prepareExecutionCommit,
      discardExecutionResult,
      now: () => '2026-07-23T09:00:00.000Z',
    });

    expect(result).toEqual({ accepted: false, draftCandidates: [] });
    expect(prepareExecutionCommit).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(complete).not.toHaveBeenCalled();
    expect(discardExecutionResult).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'commit_rejected' }),
    );
    expect(state.pendingTurn).toBeDefined();
  });

  it('re-checks the pending turn after preparation and rolls back if it became stale', async () => {
    let state = createInitialPlanningState('2026-07-20');
    const session = createWeeklyPlanningControllerSession(
      'owner-1',
      '2026-07-20',
      'conversation-1',
    );
    const rollback = vi.fn();
    const complete = vi.fn();
    const discardExecutionResult = vi.fn();

    const result = await submitWeeklyPlanningControlledTurn({
      session,
      ownerId: 'owner-1',
      userText: '予定を立てたい',
      getState: () => state,
      dispatch(action) {
        state = weeklyPlanningReducer(state, action);
        return state;
      },
      execute: async () => executionResult(),
      prepareExecutionCommit() {
        const pending = state.pendingTurn;
        if (pending) {
          state = weeklyPlanningReducer(state, { type: 'cancel_turn', pending });
        }
        return { rollback, complete };
      },
      discardExecutionResult,
      now: () => '2026-07-23T09:00:00.000Z',
    });

    expect(result).toEqual({ accepted: false, draftCandidates: [] });
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(complete).not.toHaveBeenCalled();
    expect(discardExecutionResult).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'stale' }),
    );
    expect(state.messages.filter((message) => message.role === 'assistant')).toHaveLength(0);
  });
});
