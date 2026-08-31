import { describe, expect, it, vi } from 'vitest';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import type { WeeklyPlanningAction } from '../types';
import { createInitialPlanningState, weeklyPlanningReducer } from '../weeklyPlanningReducer';
import {
  createWeeklyPlanningControllerSession,
  submitWeeklyPlanningControlledTurn,
} from '../weeklyPlanningTurnController';
import {
  submitWeeklyPlanningApplicationTurn,
  type WeeklyPlanningTurnApplicationServices,
} from './weeklyPlanningTurnApplication';

function createHarness() {
  let state = createInitialPlanningState('2026-07-27');
  return {
    getState: () => state,
    dispatch: (action: WeeklyPlanningAction) => {
      state = weeklyPlanningReducer(state, action);
      return state;
    },
  };
}

function createServices(overrides: Partial<WeeklyPlanningTurnApplicationServices> = {}) {
  return {
    submitControlledTurn: submitWeeklyPlanningControlledTurn,
    runtimeGateway: {
      execute: vi.fn(async () => ({
        state: createInitialPlanningIntakeState(),
        message: '確認しました。',
        draftCandidates: [],
      })),
    },
    stagingLifecycle: {
      prepare: vi.fn(() => ({
        rollback: vi.fn(),
        complete: vi.fn(),
      })),
      discard: vi.fn(),
    },
    outcomeLifecycle: {
      committed: vi.fn(),
      discarded: vi.fn(),
      failed: vi.fn(),
    },
    ...overrides,
  } as WeeklyPlanningTurnApplicationServices;
}

function baseParams() {
  const store = createHarness();
  return {
    store,
    params: {
      session: createWeeklyPlanningControllerSession(
        'user-1',
        '2026-07-27',
        'conversation-1',
      ),
      userId: 'user-1',
      ownerId: 'user-1',
      userText: '来週の予定を作りたい',
      selectedDate: '2026-07-27',
      plans: [],
      scheduleTemplates: [],
      timetableTermId: '2026-full-year',
      weekStartsOn: 'monday' as const,
      getState: store.getState,
      dispatch: store.dispatch,
    },
  };
}

describe('submitWeeklyPlanningApplicationTurn', () => {
  it('prepares authoritative state before completing a committed turn', async () => {
    const { store, params } = baseParams();
    const resultState = createInitialPlanningIntakeState();
    const runtimeGateway = {
      execute: vi.fn(async () => ({
        state: resultState,
        message: '期間を確認しました。',
        draftCandidates: [],
      })),
    };
    const rollback = vi.fn();
    const complete = vi.fn();
    const stagingLifecycle = {
      prepare: vi.fn(() => ({ rollback, complete })),
      discard: vi.fn(),
    };
    const services = createServices({ runtimeGateway, stagingLifecycle });

    const submission = await submitWeeklyPlanningApplicationTurn(params, services);

    expect(submission.accepted).toBe(true);
    expect(runtimeGateway.execute).toHaveBeenCalledWith(expect.objectContaining({
      snapshot: expect.objectContaining({
        weekStartDate: '2026-07-27',
        messages: [],
      }),
      pending: expect.objectContaining({
        conversationId: 'conversation-1',
        requestId: 'conversation-1:request:1',
      }),
      userText: '来週の予定を作りたい',
      selectedDate: '2026-07-27',
      userId: 'user-1',
      timetableTermId: '2026-full-year',
      weekStartsOn: 'monday',
      timeZone: undefined,
    }));
    expect(stagingLifecycle.prepare).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'user-1',
      pending: expect.objectContaining({
        conversationId: 'conversation-1',
        requestId: 'conversation-1:request:1',
      }),
    }));
    expect(complete).toHaveBeenCalledTimes(1);
    expect(rollback).not.toHaveBeenCalled();
    expect(services.outcomeLifecycle.committed).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'user-1',
      userText: '来週の予定を作りたい',
      result: expect.objectContaining({ state: resultState }),
      committed: store.getState(),
    }));
    expect(services.outcomeLifecycle.discarded).not.toHaveBeenCalled();
    expect(store.getState().intakeState).toBe(resultState);
  });

  it('keeps authenticated runtime identity separate from normalized storage ownership', async () => {
    const { params } = baseParams();
    params.ownerId = 'normalized-owner';
    const services = createServices();

    await submitWeeklyPlanningApplicationTurn(params, services);

    expect(services.runtimeGateway.execute).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
    }));
    expect(services.stagingLifecycle.prepare).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'user-1',
    }));
    expect(services.outcomeLifecycle.committed).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'normalized-owner',
    }));
  });

  it('does not expose a success turn when authoritative preparation fails', async () => {
    const { store, params } = baseParams();
    const failure = new Error('graph finalize failed');
    const resultState = createInitialPlanningIntakeState();
    const services = createServices({
      runtimeGateway: {
        execute: vi.fn(async () => ({
          state: resultState,
          message: '成功しました。',
          draftCandidates: [],
        })),
      },
      stagingLifecycle: {
        prepare: vi.fn(() => { throw failure; }),
        discard: vi.fn(),
      },
    });

    await expect(submitWeeklyPlanningApplicationTurn(params, services)).rejects.toBe(failure);

    expect(services.outcomeLifecycle.committed).not.toHaveBeenCalled();
    expect(store.getState().intakeState).not.toBe(resultState);
    expect(store.getState().messages.some((message) => message.content === '成功しました。')).toBe(false);
    expect(store.getState().pendingTurn).toBeUndefined();
    const messages = store.getState().messages;
    expect(messages[messages.length - 1]).toMatchObject({
      role: 'assistant',
      content: '週間計画の会話状態を更新できませんでした。',
    });
  });

  it('rolls prepared authoritative state back when the conversation commit is rejected', async () => {
    const { store, params } = baseParams();
    const rollback = vi.fn();
    const complete = vi.fn();
    const stagingLifecycle = {
      prepare: vi.fn(() => ({ rollback, complete })),
      discard: vi.fn(),
    };
    const services = createServices({ stagingLifecycle });
    const realDispatch = params.dispatch;
    params.dispatch = (action: WeeklyPlanningAction) => (
      action.type === 'commit_turn' ? store.getState() : realDispatch(action)
    );

    const submission = await submitWeeklyPlanningApplicationTurn(params, services);

    expect(submission.accepted).toBe(false);
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(complete).not.toHaveBeenCalled();
    expect(services.outcomeLifecycle.committed).not.toHaveBeenCalled();
    expect(services.outcomeLifecycle.discarded).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'commit_rejected',
    }));
  });

  it('delegates controlled failure cleanup and persistence before rethrowing', async () => {
    const { store, params } = baseParams();
    const failure = new Error('provider unavailable');
    const services = createServices({
      runtimeGateway: {
        execute: vi.fn(async () => { throw failure; }),
      },
    });

    await expect(submitWeeklyPlanningApplicationTurn(params, services)).rejects.toBe(failure);

    expect(services.stagingLifecycle.discard).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-1',
      requestId: 'conversation-1:request:1',
    }));
    expect(services.outcomeLifecycle.discarded).not.toHaveBeenCalled();
    expect(services.outcomeLifecycle.failed).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'user-1',
      userText: '来週の予定を作りたい',
      error: failure,
      failedState: store.getState(),
      assistantMessage: expect.objectContaining({
        role: 'assistant',
        content: '週間計画の会話状態を更新できませんでした。',
      }),
    }));
    expect(store.getState().pendingTurn).toBeUndefined();
  });
});
