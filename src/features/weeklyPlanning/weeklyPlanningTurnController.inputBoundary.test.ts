import { describe, expect, it, vi } from 'vitest';
import {
  MAX_WEEKLY_PLANNING_USER_TEXT_LENGTH,
  createWeeklyPlanningControllerSession,
  submitWeeklyPlanningControlledTurn,
} from './weeklyPlanningTurnController';
import { createInitialPlanningState } from './weeklyPlanningReducer';

describe('weekly planning controller input boundary', () => {
  it('rejects oversized input before dispatch or interpreter execution', async () => {
    const state = createInitialPlanningState('2026-07-20');
    const dispatch = vi.fn(() => state);
    const execute = vi.fn();
    const result = await submitWeeklyPlanningControlledTurn({
      session: createWeeklyPlanningControllerSession(
        'input-boundary-user',
        '2026-07-20',
        'weekly-conversation-123e4567-e89b-12d3-a456-426614174000',
      ),
      ownerId: 'input-boundary-user',
      userText: 'x'.repeat(MAX_WEEKLY_PLANNING_USER_TEXT_LENGTH + 1),
      getState: () => state,
      dispatch,
      execute,
    });
    expect(result).toEqual({ accepted: false, draftCandidates: [] });
    expect(dispatch).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
