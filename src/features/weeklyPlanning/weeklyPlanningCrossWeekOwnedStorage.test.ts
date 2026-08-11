import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createMemoryStorageHarness,
  installWeeklyPlanningTestStorage,
  type MemoryStorageHarness,
} from './testUtils/weeklyPlanningApplicationTestHarness';
import {
  createEmptyWeeklyPlanningFactGraphV5,
} from './semantic/weeklyPlanningFactGraphV5';
import {
  bindWeeklyPlanningStableV5RuntimeSessionScope,
  hydrateWeeklyPlanningStableV5RuntimeSession,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from './application/weeklyPlanningStableV5RuntimeSession';
import {
  getWeeklyPlanningStableV5SessionStorageKeyForTest,
} from './application/weeklyPlanningStableV5SessionStorage';
import {
  loadOwnedWeeklyPlanningState,
  saveOwnedWeeklyPlanningState,
} from './weeklyPlanningOwnedStorage';
import { createInitialPlanningState, weeklyPlanningReducer } from './weeklyPlanningReducer';

const OWNER_ID = 'cross-week-storage-owner';
const CONVERSATION_ID = 'cross-week-storage-conversation';
const WEEK_A = '2026-08-10';
const WEEK_B = '2026-08-17';
const WEEK_C = '2026-08-24';
const ACTIVE_INDEX_KEY = `studyplanner.weeklyPlanning.activeSession.${OWNER_ID}`;

function stateWithConversation(weekStartDate: string) {
  let state = createInitialPlanningState(weekStartDate);
  state = weeklyPlanningReducer(state, {
    type: 'append_message',
    message: {
      id: `${CONVERSATION_ID}:turn:1:user`,
      role: 'user',
      content: '数学の予定を相談したい',
      createdAt: '2026-08-11T10:00:00.000Z',
    },
  });
  state = weeklyPlanningReducer(state, {
    type: 'append_message',
    message: {
      id: `${CONVERSATION_ID}:turn:1:assistant`,
      role: 'assistant',
      content: '条件を確認します。',
      createdAt: '2026-08-11T10:00:01.000Z',
    },
  });
  return state;
}

function createBoundConversation() {
  const graph = createEmptyWeeklyPlanningFactGraphV5();
  hydrateWeeklyPlanningStableV5RuntimeSession({
    ownerId: OWNER_ID,
    weekStartDate: WEEK_A,
    conversationId: CONVERSATION_ID,
    graph,
  });
  const weekAState = stateWithConversation(WEEK_A);
  saveOwnedWeeklyPlanningState(OWNER_ID, weekAState);

  bindWeeklyPlanningStableV5RuntimeSessionScope({
    ownerId: OWNER_ID,
    weekStartDate: WEEK_B,
    conversationId: CONVERSATION_ID,
  });
  const weekBState = weeklyPlanningReducer(weekAState, {
    type: 'set_week_anchor',
    weekStartDate: WEEK_B,
  });
  return { weekAState, weekBState };
}

describe('cross-week owned weekly planning storage', () => {
  let storageHarness: MemoryStorageHarness;
  let restoreWindow: () => void;

  beforeEach(() => {
    storageHarness = createMemoryStorageHarness();
    restoreWindow = installWeeklyPlanningTestStorage(storageHarness.storage);
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  });

  afterEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    restoreWindow();
  });

  it('moves the active conversation checkpoint across week anchors and loads it independent of displayed week', () => {
    const { weekBState } = createBoundConversation();
    saveOwnedWeeklyPlanningState(OWNER_ID, weekBState);

    const loaded = loadOwnedWeeklyPlanningState(OWNER_ID, WEEK_C);
    expect(loaded.weekStartDate).toBe(WEEK_B);
    expect(loaded.messages.map((message) => message.content)).toEqual([
      '数学の予定を相談したい',
      '条件を確認します。',
    ]);

    const oldKey = getWeeklyPlanningStableV5SessionStorageKeyForTest(OWNER_ID, WEEK_A);
    const currentKey = getWeeklyPlanningStableV5SessionStorageKeyForTest(OWNER_ID, WEEK_B);
    expect(storageHarness.values.has(oldKey)).toBe(false);
    expect(storageHarness.values.has(currentKey)).toBe(true);
  });

  it('recovers from a stale active index when the new checkpoint succeeded but index update failed', () => {
    const { weekBState } = createBoundConversation();
    const originalSetItem = storageHarness.storage.setItem.bind(storageHarness.storage);
    storageHarness.storage.setItem = (key: string, value: string) => {
      if (key === ACTIVE_INDEX_KEY) {
        const parsed = JSON.parse(value) as { weekStartDate?: string | null };
        if (parsed.weekStartDate === WEEK_B) {
          throw new Error('injected active-index write failure');
        }
      }
      originalSetItem(key, value);
    };

    saveOwnedWeeklyPlanningState(OWNER_ID, weekBState);
    storageHarness.storage.setItem = originalSetItem;

    const oldKey = getWeeklyPlanningStableV5SessionStorageKeyForTest(OWNER_ID, WEEK_A);
    const currentKey = getWeeklyPlanningStableV5SessionStorageKeyForTest(OWNER_ID, WEEK_B);
    expect(storageHarness.values.has(oldKey)).toBe(false);
    expect(storageHarness.values.has(currentKey)).toBe(true);
    expect(JSON.parse(storageHarness.values.get(ACTIVE_INDEX_KEY)!)?.weekStartDate).toBe(WEEK_A);

    const loaded = loadOwnedWeeklyPlanningState(OWNER_ID, WEEK_C);
    expect(loaded.weekStartDate).toBe(WEEK_B);
    expect(loaded.messages.map((message) => message.content)).toEqual([
      '数学の予定を相談したい',
      '条件を確認します。',
    ]);
    expect(JSON.parse(storageHarness.values.get(ACTIVE_INDEX_KEY)!)?.weekStartDate).toBe(WEEK_B);
  });
});
