import { describe, expect, it } from 'vitest';
import { createWeeklyPlanningTestDraftBlock } from './testUtils/weeklyPlanningApplicationTestHarness';
import { createInitialPlanningState, weeklyPlanningReducer } from './weeklyPlanningReducer';
import { decodeWeeklyPlanningStatePayload } from './weeklyPlanningStorage';

const WEEK_START = '2026-07-13';

function validStoredState() {
  return weeklyPlanningReducer(createInitialPlanningState(WEEK_START), {
    type: 'add_draft_blocks',
    blocks: [createWeeklyPlanningTestDraftBlock({ id: 'draft-1', userId: 'user-a' })],
  });
}

describe('decodeWeeklyPlanningStatePayload', () => {
  it('decodes a valid versioned payload without browser storage', () => {
    const state = validStoredState();

    const decoded = decodeWeeklyPlanningStatePayload({ version: 2, state }, WEEK_START);

    expect(decoded.draftBlocks).toEqual(state.draftBlocks);
    expect(decoded.weekStartDate).toBe(WEEK_START);
    expect(decoded.pendingTurn).toBeUndefined();
    expect(decoded.pendingApproval).toBeUndefined();
  });

  it('fails closed for unknown versions and additional state fields', () => {
    const state = validStoredState();
    const unknownVersion = decodeWeeklyPlanningStatePayload({ version: 99, state }, WEEK_START);
    const unknownField = decodeWeeklyPlanningStatePayload({
      version: 2,
      state: { ...state, unexpected: true },
    }, WEEK_START);

    expect(unknownVersion.draftBlocks).toEqual([]);
    expect(unknownVersion.messages).toEqual([]);
    expect(unknownField.draftBlocks).toEqual([]);
    expect(unknownField.messages).toEqual([]);
  });
});
