import { describe, expect, it, vi } from 'vitest';
import type { WeeklyPlanningStableV5PersistedSession } from './weeklyPlanningStableV5SessionStorage';
import {
  resetWeeklyPlanningApplicationSession,
  synchronizeWeeklyPlanningApplicationSession,
  type WeeklyPlanningSessionLifecycleServices,
} from './weeklyPlanningSessionLifecycle';
import type { WeeklyPlanningAction } from '../types';
import { createInitialPlanningState, weeklyPlanningReducer } from '../weeklyPlanningReducer';
import {
  createWeeklyPlanningControllerSession,
  resetWeeklyPlanningControlledSession,
  resetWeeklyPlanningControllerSession,
} from '../weeklyPlanningTurnController';

function createServices(overrides: Partial<WeeklyPlanningSessionLifecycleServices> = {}) {
  return {
    loadPersistedSession: vi.fn(() => null),
    hydrateRuntimeSession: vi.fn(),
    bindRuntimeSessionScope: vi.fn(),
    clearPersistedSession: vi.fn(),
    clearRuntimeSession: vi.fn(),
    clearRuntimeSessionsForScope: vi.fn(),
    resetControllerSession: resetWeeklyPlanningControllerSession,
    resetControlledSession: resetWeeklyPlanningControlledSession,
    ...overrides,
  } as WeeklyPlanningSessionLifecycleServices;
}

function createStateHarness() {
  let state = createInitialPlanningState('2026-07-27');
  state = weeklyPlanningReducer(state, {
    type: 'append_message',
    message: {
      id: 'conversation-1:turn:1:user',
      role: 'user',
      content: '来週の予定を作りたい',
      createdAt: '2026-07-24T10:00:00.000Z',
    },
  });
  return {
    getState: () => state,
    dispatch: (action: WeeklyPlanningAction) => {
      state = weeklyPlanningReducer(state, action);
      return state;
    },
  };
}

function persistedSession(conversationId: string): WeeklyPlanningStableV5PersistedSession {
  return {
    version: 'studyplanner-weekly-planning-stable-v5-session-v1',
    ownerId: 'user-1',
    weekStartDate: '2026-07-27',
    conversationId,
    graph: {} as WeeklyPlanningStableV5PersistedSession['graph'],
    planningState: createInitialPlanningState('2026-07-27'),
    savedAt: '2026-07-24T10:00:00.000Z',
  };
}

describe('weeklyPlanningSessionLifecycle', () => {
  it('binds a new Stable V5 runtime scope even without persisted state', () => {
    const services = createServices();
    const session = createWeeklyPlanningControllerSession(
      'user-1',
      '2026-07-27',
      'conversation-1',
    );

    const restored = synchronizeWeeklyPlanningApplicationSession({
      session,
      ownerId: 'user-1',
      weekStartDate: '2026-07-27',
      services,
    });

    expect(restored).toBeNull();
    expect(services.bindRuntimeSessionScope).toHaveBeenCalledWith({
      ownerId: 'user-1',
      weekStartDate: '2026-07-27',
      conversationId: 'conversation-1',
    });
  });

  it('restores the persisted conversation and synchronizes controller identity', () => {
    const persisted = persistedSession('conversation-2');
    const services = createServices({
      loadPersistedSession: vi.fn(() => persisted),
    });
    const session = createWeeklyPlanningControllerSession(
      'user-1',
      '2026-07-27',
      'conversation-1',
    );
    session.requestSequence = 8;

    const restored = synchronizeWeeklyPlanningApplicationSession({
      session,
      ownerId: 'user-1',
      weekStartDate: '2026-07-27',
      services,
    });

    expect(restored).toBe(persisted);
    expect(services.hydrateRuntimeSession).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'user-1',
      weekStartDate: '2026-07-27',
      conversationId: 'conversation-2',
    }));
    expect(session.conversationId).toBe('conversation-2');
    expect(session.requestSequence).toBe(0);
    expect(services.bindRuntimeSessionScope).toHaveBeenCalledWith({
      ownerId: 'user-1',
      weekStartDate: '2026-07-27',
      conversationId: 'conversation-2',
    });
  });

  it('explicit reset clears the current runtime and every runtime in the same scope', () => {
    const store = createStateHarness();
    const services = createServices();
    const session = createWeeklyPlanningControllerSession(
      'user-1',
      '2026-07-27',
      'conversation-1',
    );
    session.requestSequence = 3;

    const reset = resetWeeklyPlanningApplicationSession({
      session,
      ownerId: 'user-1',
      ...store,
    }, services);

    expect(services.clearPersistedSession).toHaveBeenCalledWith({
      ownerId: 'user-1',
      weekStartDate: '2026-07-27',
    });
    expect(services.clearRuntimeSession).toHaveBeenCalledWith('conversation-1');
    expect(services.clearRuntimeSessionsForScope).toHaveBeenCalledWith({
      ownerId: 'user-1',
      weekStartDate: '2026-07-27',
    });
    expect(reset.messages).toEqual([]);
    expect(reset.conversationRequestSequence).toBe(0);
    expect(session.conversationId).not.toBe('conversation-1');
    expect(session.requestSequence).toBe(0);
  });


});
