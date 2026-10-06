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

describe('decodeWeeklyPlanningStatePayload conversation architecture (Issue #488 switch)', () => {
  it('round-trips the pinned architecture', () => {
    for (const architecture of ['legacy_v5', 'interaction_v1'] as const) {
      const state = { ...validStoredState(), conversationArchitecture: architecture };
      expect(decodeWeeklyPlanningStatePayload({ version: 2, state }, WEEK_START).conversationArchitecture)
        .toBe(architecture);
    }
  });

  it('hydrates a checkpoint with content but no field as legacy_v5 (never silently migrated)', () => {
    const state = validStoredState();
    expect(state).not.toHaveProperty('conversationArchitecture');
    expect(decodeWeeklyPlanningStatePayload({ version: 2, state }, WEEK_START).conversationArchitecture)
      .toBe('legacy_v5');
  });

  it('keeps an empty checkpoint unpinned so it captures the default at its first turn', () => {
    const decoded = decodeWeeklyPlanningStatePayload(
      { version: 2, state: createInitialPlanningState(WEEK_START) },
      WEEK_START,
    );
    expect(decoded).not.toHaveProperty('conversationArchitecture');
  });

  it('fails closed on an invalid architecture value or an extra free-text field', () => {
    const state = validStoredState();
    for (const tampered of [
      { ...state, conversationArchitecture: 'both' },
      { ...state, conversationArchitecture: 1 },
      { ...state, conversationArchitecture: 'legacy_v5', conversationArchitectureNote: 'free text' },
    ]) {
      const decoded = decodeWeeklyPlanningStatePayload({ version: 2, state: tampered }, WEEK_START);
      expect(decoded.draftBlocks).toEqual([]);
      expect(decoded.messages).toEqual([]);
      expect(decoded).not.toHaveProperty('conversationArchitecture');
    }
  });
});
