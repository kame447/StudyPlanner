import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bindWeeklyPlanningStableV5RuntimeSessionScope,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from './application/weeklyPlanningStableV5RuntimeSession';
import {
  getWeeklyPlanningStableV5SessionStorageKeyForTest,
} from './application/weeklyPlanningStableV5SessionStorage';
import {
  createMemoryStorageHarness,
  createWeeklyPlanningTestDraftBlock,
  installWeeklyPlanningTestStorage,
  type MemoryStorageHarness,
} from './testUtils/weeklyPlanningApplicationTestHarness';
import { createInitialPlanningState, weeklyPlanningReducer } from './weeklyPlanningReducer';
import {
  loadOwnedWeeklyPlanningState,
  saveOwnedWeeklyPlanningState,
} from './weeklyPlanningOwnedStorage';

const WEEK_START = '2026-07-13';

function key(userId: string): string {
  return `studyplanner.weeklyPlanning.${userId}.${WEEK_START}`;
}

function stateWithDraft(userId: string, id = 'draft-1') {
  return weeklyPlanningReducer(createInitialPlanningState(WEEK_START), {
    type: 'add_draft_blocks',
    blocks: [createWeeklyPlanningTestDraftBlock({ id, userId })],
  });
}

describe('weeklyPlanningOwnedStorage', () => {
  let storageHarness: MemoryStorageHarness;
  let restoreWindow: () => void;

  beforeEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    storageHarness = createMemoryStorageHarness();
    restoreWindow = installWeeklyPlanningTestStorage(storageHarness.storage);
  });

  afterEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    restoreWindow();
  });

  it('stores owner identity and planning payload in one versioned staging envelope', () => {
    const state = stateWithDraft('user-a');

    saveOwnedWeeklyPlanningState('user-a', state);

    const raw = storageHarness.values.get(key('user-a'));
    expect(raw).toBeDefined();
    const envelope = JSON.parse(raw!) as {
      version: number;
      ownerId: string;
      payload: unknown;
    };
    expect(envelope.version).toBe(3);
    expect(envelope.ownerId).toBe('user-a');
    expect(envelope.payload).toBeDefined();
    expect(loadOwnedWeeklyPlanningState('user-a', WEEK_START).draftBlocks).toEqual(
      state.draftBlocks,
    );
  });

  it('promotes staging state to the Stable V5 session after scope binding', () => {
    const state = stateWithDraft('user-a');
    saveOwnedWeeklyPlanningState('user-a', state);
    expect(storageHarness.values.has(key('user-a'))).toBe(true);

    bindWeeklyPlanningStableV5RuntimeSessionScope({
      ownerId: 'user-a',
      weekStartDate: WEEK_START,
      conversationId: 'weekly-conversation-storage-promotion',
    });
    saveOwnedWeeklyPlanningState('user-a', state);

    const stableKey = getWeeklyPlanningStableV5SessionStorageKeyForTest('user-a', WEEK_START);
    expect(storageHarness.values.has(stableKey)).toBe(true);
    expect(storageHarness.values.has(key('user-a'))).toBe(false);
    expect(loadOwnedWeeklyPlanningState('user-a', WEEK_START).draftBlocks).toEqual(
      state.draftBlocks,
    );
  });

  it('decodes an owned envelope without transient storage writes', () => {
    const state = stateWithDraft('user-a');
    saveOwnedWeeklyPlanningState('user-a', state);
    const setItem = vi.spyOn(storageHarness.storage, 'setItem');
    const removeItem = vi.spyOn(storageHarness.storage, 'removeItem');

    const loaded = loadOwnedWeeklyPlanningState('user-a', WEEK_START);

    expect(loaded.draftBlocks).toEqual(state.draftBlocks);
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('rejects and removes an envelope stored under another user key', () => {
    saveOwnedWeeklyPlanningState('user-a', stateWithDraft('user-a'));
    storageHarness.values.set(key('user-b'), storageHarness.values.get(key('user-a'))!);

    const loaded = loadOwnedWeeklyPlanningState('user-b', WEEK_START);

    expect(loaded.draftBlocks).toEqual([]);
    expect(loaded.messages).toEqual([]);
    expect(storageHarness.values.has(key('user-b'))).toBe(false);
  });

  it('refuses to save a state containing another user draft', () => {
    saveOwnedWeeklyPlanningState('user-b', stateWithDraft('user-a'));

    expect(storageHarness.values.has(key('user-b'))).toBe(false);
  });

  it('migrates a valid legacy v2 payload to the owner-bound staging envelope', () => {
    const state = stateWithDraft('user-a');
    storageHarness.values.set(
      key('user-a'),
      JSON.stringify({ version: 2, state }),
    );

    const loaded = loadOwnedWeeklyPlanningState('user-a', WEEK_START);
    const migrated = JSON.parse(storageHarness.values.get(key('user-a'))!) as {
      version: number;
      ownerId: string;
    };

    expect(loaded.draftBlocks).toEqual(state.draftBlocks);
    expect(migrated).toEqual(expect.objectContaining({
      version: 3,
      ownerId: 'user-a',
    }));
  });

  it('rejects a legacy payload whose draft ownership contradicts its key', () => {
    const state = stateWithDraft('user-a');
    storageHarness.values.set(
      key('user-b'),
      JSON.stringify({ version: 2, state }),
    );

    const loaded = loadOwnedWeeklyPlanningState('user-b', WEEK_START);

    expect(loaded.draftBlocks).toEqual([]);
    expect(storageHarness.values.has(key('user-b'))).toBe(false);
  });
});
