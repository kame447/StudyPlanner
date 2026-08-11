import { describe, expect, it, vi } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
} from '../semantic/weeklyPlanningFactGraphV5';
import {
  bindWeeklyPlanningStableV5RuntimeSessionScope,
  getWeeklyPlanningStableV5RuntimeSession,
  hydrateWeeklyPlanningStableV5RuntimeSession,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from './weeklyPlanningStableV5RuntimeSession';
import {
  synchronizeWeeklyPlanningApplicationSession,
  type WeeklyPlanningSessionLifecycleServices,
} from './weeklyPlanningSessionLifecycle';
import {
  createWeeklyPlanningControllerSession,
  resetWeeklyPlanningControlledSession,
  resetWeeklyPlanningControllerSession,
} from '../weeklyPlanningTurnController';

function lifecycleServices(): WeeklyPlanningSessionLifecycleServices {
  return {
    loadPersistedSession: vi.fn(() => null),
    hydrateRuntimeSession: vi.fn(),
    bindRuntimeSessionScope: vi.fn(),
    clearPersistedSession: vi.fn(),
    clearRuntimeSession: vi.fn(),
    clearRuntimeSessionsForScope: vi.fn(),
    resetControllerSession: vi.fn(resetWeeklyPlanningControllerSession),
    resetControlledSession: resetWeeklyPlanningControlledSession,
  };
}

describe('cross-week weekly planning session scope', () => {
  it('reanchors one runtime conversation without losing its committed Fact Graph', () => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    const graph = {
      ...createEmptyWeeklyPlanningFactGraphV5(),
      revision: 3,
      appliedTurnKeys: ['conversation-1:request:3'],
    };
    hydrateWeeklyPlanningStableV5RuntimeSession({
      ownerId: 'user-1',
      weekStartDate: '2026-08-10',
      conversationId: 'conversation-1',
      graph,
    });

    expect(() => bindWeeklyPlanningStableV5RuntimeSessionScope({
      ownerId: 'user-1',
      weekStartDate: '2026-08-17',
      conversationId: 'conversation-1',
    })).not.toThrow();

    const session = getWeeklyPlanningStableV5RuntimeSession('conversation-1');
    expect(session).toMatchObject({
      ownerId: 'user-1',
      conversationId: 'conversation-1',
      weekStartDate: '2026-08-17',
    });
    expect(session?.graph).toEqual(graph);
  });

  it('updates the controller week anchor without consulting week-scoped persistence or rotating identity', () => {
    const services = lifecycleServices();
    const session = createWeeklyPlanningControllerSession(
      'user-1',
      '2026-08-10',
      'conversation-1',
    );
    session.requestSequence = 4;

    synchronizeWeeklyPlanningApplicationSession({
      session,
      ownerId: 'user-1',
      weekStartDate: '2026-08-17',
      services,
    });

    expect(session).toMatchObject({
      ownerId: 'user-1',
      conversationId: 'conversation-1',
      weekStartDate: '2026-08-17',
      requestSequence: 4,
    });
    expect(services.loadPersistedSession).not.toHaveBeenCalled();
    expect(services.hydrateRuntimeSession).not.toHaveBeenCalled();
    expect(services.resetControllerSession).not.toHaveBeenCalled();
    expect(services.bindRuntimeSessionScope).toHaveBeenCalledWith({
      ownerId: 'user-1',
      weekStartDate: '2026-08-17',
      conversationId: 'conversation-1',
    });
  });
});
