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

function createStore() {
  let state = createInitialPlanningState('2026-09-07');
  return {
    getState: () => state,
    dispatch: (action: WeeklyPlanningAction) => {
      state = weeklyPlanningReducer(state, action);
      return state;
    },
  };
}

describe('weekly planning application temporal context', () => {
  it('passes the captured request clock separately from selectedDate', async () => {
    const store = createStore();
    const executeTurn = vi.fn(async () => ({
      state: createInitialPlanningIntakeState(),
      message: '確認しました。',
      draftCandidates: [],
    }));
    const services = {
      submitControlledTurn: submitWeeklyPlanningControlledTurn,
      executeTurn,
      bindStableV5SessionScope: vi.fn(),
      saveOwnedState: vi.fn(),
      finalizeTurn: vi.fn(),
      discardTurn: vi.fn(),
      recordCommittedTurn: vi.fn(() => null),
      recordDiscardedTurn: vi.fn(() => null),
      recordFailedTurn: vi.fn(() => null),
    } as WeeklyPlanningTurnApplicationServices;

    await submitWeeklyPlanningApplicationTurn({
      session: createWeeklyPlanningControllerSession(
        'user-1',
        '2026-09-07',
        'conversation-1',
      ),
      userId: 'user-1',
      ownerId: 'user-1',
      userText: '来週の予定を立てたい',
      selectedDate: '2026-09-10',
      plans: [],
      scheduleTemplates: [],
      weekStartsOn: 'monday',
      timeZone: 'Asia/Tokyo',
      now: () => '2026-08-11T05:55:30.000Z',
      getState: store.getState,
      dispatch: store.dispatch,
    }, services);

    expect(executeTurn).toHaveBeenCalledWith(expect.objectContaining({
      selectedDate: '2026-09-10',
      weekStartsOn: 'monday',
      requestContext: {
        startedAtIso: '2026-08-11T05:55:30.000Z',
        timeZone: 'Asia/Tokyo',
        currentDate: '2026-08-11',
        currentTime: '14:55',
        notBeforeDate: '2026-08-11',
        notBeforeTime: '14:56',
        weekStartsOn: 'monday',
      },
    }));
  });
});
