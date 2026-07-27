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
    executeTurn: vi.fn(async () => ({
      state: createInitialPlanningIntakeState(),
      message: '確認しました。',
      draftCandidates: [],
    })),
    isStableV5Enabled: vi.fn(() => true),
    bindStableV5SessionScope: vi.fn(),
    saveOwnedState: vi.fn(),
    finalizeTurn: vi.fn(),
    discardTurn: vi.fn(),
    recordCommittedTurn: vi.fn(() => null),
    recordFailedTurn: vi.fn(() => null),
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
      ownerId: 'user-1',
      userText: '来週の予定を作りたい',
      selectedDate: '2026-07-27',
      plans: [],
      scheduleTemplates: [],
      timetableTermId: '2026-full-year',
      weekStartsOn: 1 as const,
      getState: store.getState,
      dispatch: store.dispatch,
    },
  };
}

describe('submitWeeklyPlanningApplicationTurn', () => {
  it('binds Stable V5 scope, executes the semantic turn and commits side effects', async () => {
    const { store, params } = baseParams();
    const resultState = createInitialPlanningIntakeState();
    const services = createServices({
      executeTurn: vi.fn(async () => ({
        state: resultState,
        message: '期間を確認しました。',
        draftCandidates: [],
      })),
    });

    const submission = await submitWeeklyPlanningApplicationTurn(params, services);

    expect(submission.accepted).toBe(true);
    expect(services.bindStableV5SessionScope).toHaveBeenCalledWith({
      ownerId: 'user-1',
      weekStartDate: '2026-07-27',
      conversationId: 'conversation-1',
    });
    expect(services.executeTurn).toHaveBeenCalledWith(expect.objectContaining({
      previousState: undefined,
      messages: [],
      userText: '来週の予定を作りたい',
      selectedDate: '2026-07-27',
      userId: 'user-1',
      timetableTermId: '2026-full-year',
      conversationId: 'conversation-1',
      traceRequestId: 'conversation-1:request:1',
      weekStartsOn: 1,
    }));
    expect(services.finalizeTurn).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'user-1',
      pending: expect.objectContaining({
        conversationId: 'conversation-1',
        requestId: 'conversation-1:request:1',
      }),
    }));
    expect(services.saveOwnedState).toHaveBeenCalledWith('user-1', store.getState());
    expect(services.recordCommittedTurn).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'user-1',
      userText: '来週の予定を作りたい',
      result: expect.objectContaining({ state: resultState }),
    }));
    expect(store.getState().intakeState).toBe(resultState);
  });

  it('does not bind Stable V5 runtime when the legacy runtime is active', async () => {
    const { params } = baseParams();
    const services = createServices({ isStableV5Enabled: vi.fn(() => false) });

    await submitWeeklyPlanningApplicationTurn(params, services);

    expect(services.bindStableV5SessionScope).not.toHaveBeenCalled();
    expect(services.executeTurn).toHaveBeenCalledOnce();
  });

  it('persists and traces the controlled failure state before rethrowing', async () => {
    const { store, params } = baseParams();
    const failure = new Error('provider unavailable');
    const services = createServices({
      executeTurn: vi.fn(async () => { throw failure; }),
    });

    await expect(submitWeeklyPlanningApplicationTurn(params, services)).rejects.toBe(failure);

    expect(services.discardTurn).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-1',
      requestId: 'conversation-1:request:1',
    }));
    expect(services.saveOwnedState).toHaveBeenCalledWith('user-1', store.getState());
    expect(services.recordFailedTurn).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'user-1',
      userText: '来週の予定を作りたい',
      error: failure,
      assistantMessage: expect.objectContaining({
        role: 'assistant',
        content: '週間計画の会話状態を更新できませんでした。',
      }),
    }));
    expect(store.getState().pendingTurn).toBeUndefined();
  });
});
