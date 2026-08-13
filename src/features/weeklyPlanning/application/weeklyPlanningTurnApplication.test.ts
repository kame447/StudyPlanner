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
      finalize: vi.fn(),
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
  it('delegates runtime execution and committed lifecycle work', async () => {
    const { store, params } = baseParams();
    const resultState = createInitialPlanningIntakeState();
    const runtimeGateway = {
      execute: vi.fn(async () => ({
        state: resultState,
        message: '期間を確認しました。',
        draftCandidates: [],
      })),
    };
    const services = createServices({ runtimeGateway });

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
    expect(services.stagingLifecycle.finalize).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'user-1',
      pending: expect.objectContaining({
        conversationId: 'conversation-1',
        requestId: 'conversation-1:request:1',
      }),
    }));
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
    expect(services.stagingLifecycle.finalize).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'user-1',
    }));
    expect(services.outcomeLifecycle.committed).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'normalized-owner',
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
