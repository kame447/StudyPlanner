import { describe, expect, it } from 'vitest';
import { createInitialPlanningIntakeState } from './intake/weeklyPlanningIntakeReducer';
import type { WeeklyPlanningAction } from './types';
import { createInitialPlanningState, weeklyPlanningReducer } from './weeklyPlanningReducer';
import {
  cancelWeeklyPlanningControlledTurn,
  clearWeeklyPlanningControlledConversation,
  createWeeklyPlanningControllerSession,
  resetWeeklyPlanningControlledSession,
  submitWeeklyPlanningControlledTurn,
} from './weeklyPlanningTurnController';

function harness() {
  let state = createInitialPlanningState('2026-07-13');
  return {
    getState: () => state,
    dispatch: (action: WeeklyPlanningAction) => {
      state = weeklyPlanningReducer(state, action);
      return state;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

const result = {
  state: createInitialPlanningIntakeState(),
  message: '確認しました。',
  draftCandidates: [],
};

describe('weeklyPlanningTurnController', () => {
  it('creates one envelope with conversation, turn, request, revision and week identity', async () => {
    const store = harness();
    const session = createWeeklyPlanningControllerSession('user-1', '2026-07-13', 'conversation-1');
    let captured: Parameters<Parameters<typeof submitWeeklyPlanningControlledTurn>[0]['execute']>[0] | undefined;
    const submission = await submitWeeklyPlanningControlledTurn({
      session,
      ownerId: 'user-1',
      userText: '来週の予定を作りたい',
      getState: store.getState,
      dispatch: store.dispatch,
      now: () => '2026-07-17T10:00:00.000Z',
      async execute(input) {
        captured = input;
        return result;
      },
    });

    expect(submission.accepted).toBe(true);
    expect(captured?.pending).toMatchObject({
      conversationId: 'conversation-1',
      turnId: 'conversation-1:turn:1',
      requestId: 'conversation-1:request:1',
      weekStartDate: '2026-07-13',
      baseRevision: 0,
    });
    expect(store.getState().messages.map((message) => message.id)).toEqual([
      'conversation-1:turn:1:user',
      'conversation-1:turn:1:assistant',
    ]);
  });

  it('rejects a second active submission and silently discards a cancelled result', async () => {
    const store = harness();
    const session = createWeeklyPlanningControllerSession('user-1', '2026-07-13', 'conversation-1');
    const pendingResult = deferred<typeof result>();
    const first = submitWeeklyPlanningControlledTurn({
      session,
      ownerId: 'user-1',
      userText: '来週の予定を作りたい',
      getState: store.getState,
      dispatch: store.dispatch,
      execute: () => pendingResult.promise,
    });
    const second = await submitWeeklyPlanningControlledTurn({
      session,
      ownerId: 'user-1',
      userText: '二重送信',
      getState: store.getState,
      dispatch: store.dispatch,
      execute: async () => result,
    });

    expect(second.accepted).toBe(false);
    expect(cancelWeeklyPlanningControlledTurn(store)).toBe(true);
    pendingResult.resolve(result);
    await expect(first).resolves.toEqual({ accepted: false, draftCandidates: [] });
    expect(store.getState().messages).toHaveLength(1);
    expect(store.getState().messages[0].role).toBe('user');
  });

  it('reset invalidates the current result and retry uses a new conversation identity', async () => {
    const store = harness();
    const session = createWeeklyPlanningControllerSession('user-1', '2026-07-13', 'conversation-1');
    const pendingResult = deferred<typeof result>();
    const first = submitWeeklyPlanningControlledTurn({
      session,
      ownerId: 'user-1',
      userText: '最初の送信',
      getState: store.getState,
      dispatch: store.dispatch,
      execute: () => pendingResult.promise,
    });

    const reset = resetWeeklyPlanningControlledSession({
      session,
      ownerId: 'user-1',
      ...store,
      conversationId: 'conversation-2',
    });
    expect(reset.pendingTurn).toBeUndefined();
    expect(reset.messages).toEqual([]);
    pendingResult.resolve(result);
    await expect(first).resolves.toEqual({ accepted: false, draftCandidates: [] });

    let retryRequestId = '';
    const retry = await submitWeeklyPlanningControlledTurn({
      session,
      ownerId: 'user-1',
      userText: '再送信',
      getState: store.getState,
      dispatch: store.dispatch,
      async execute(input) {
        retryRequestId = input.pending.requestId;
        return result;
      },
    });
    expect(retry.accepted).toBe(true);
    expect(retryRequestId).toBe('conversation-2:request:1');
  });

  it('rotates conversation identity when the owner changes in the same week', async () => {
    const store = harness();
    const session = createWeeklyPlanningControllerSession(
      'user-1',
      '2026-07-13',
      'conversation-1',
    );
    let pendingConversationId = '';

    const submission = await submitWeeklyPlanningControlledTurn({
      session,
      ownerId: 'user-2',
      userText: '別ユーザーの予定',
      getState: store.getState,
      dispatch: store.dispatch,
      async execute(input) {
        pendingConversationId = input.pending.conversationId;
        return result;
      },
    });

    expect(submission.accepted).toBe(true);
    expect(session.ownerId).toBe('user-2');
    expect(session.conversationId).not.toBe('conversation-1');
    expect(session.requestSequence).toBe(1);
    expect(pendingConversationId).toBe(session.conversationId);
  });

  it('clears conversation only while idle and preserves drafts', () => {
    const store = harness();
    store.dispatch({
      type: 'append_message',
      message: {
        id: 'message-1',
        role: 'assistant',
        content: '確認します。',
        createdAt: '2026-07-17T10:00:00.000Z',
      },
    });
    const beforeClear = store.getState();
    expect(clearWeeklyPlanningControlledConversation(store)).toBe(true);
    expect(store.getState().messages).toEqual([]);
    expect(store.getState().revision).toBe(beforeClear.revision + 1);
  });

  it('commits a turn even when the assistant text matches the previous response', async () => {
    const store = harness();
    store.dispatch({
      type: 'append_message',
      message: {
        id: 'previous-assistant',
        role: 'assistant',
        content: result.message,
        createdAt: '2026-07-17T09:00:00.000Z',
      },
    });
    const session = createWeeklyPlanningControllerSession('user-1', '2026-07-13', 'conversation-1');
    const submission = await submitWeeklyPlanningControlledTurn({
      session,
      ownerId: 'user-1',
      userText: '続けます',
      getState: store.getState,
      dispatch: store.dispatch,
      execute: async () => result,
    });

    expect(submission.accepted).toBe(true);
    expect(store.getState().pendingTurn).toBeUndefined();
    expect(store.getState().intakeState).toEqual(result.state);
  });
});
