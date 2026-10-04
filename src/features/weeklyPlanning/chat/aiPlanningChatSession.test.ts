import { expect, it } from 'vitest';
import fc from 'fast-check';
import { createAiPlanningChatSession } from './aiPlanningChatSession';
import { createAiPlanningChat, loadAiPlanningChatIndex, loadAiPlanningChatSnapshot, saveAiPlanningChatIndex, saveAiPlanningChatSnapshot, setActiveAiPlanningChat, updateAiPlanningChatRecord } from './aiPlanningChatStore';
import { createMemoryStorageHarness, createWeeklyPlanningTestDraftBlock, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { createInitialPlanningState } from '../weeklyPlanningReducer';
import { WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION } from '../application/weeklyPlanningStableV5SessionCodec';

const OWNER = 'checkpoint-owner';
const WEEK = '2026-10-05';
function snapshot(id: string) {
  return { version: WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION, ownerId: OWNER,
    weekStartDate: WEEK, conversationId: `conversation-${id}`, graph: createEmptyWeeklyPlanningFactGraphV5(),
    planningState: { ...createInitialPlanningState(WEEK), draftBlocks: [createWeeklyPlanningTestDraftBlock({ id, userId: OWNER })] },
    savedAt: '2026-10-04T00:00:00.000Z' };
}
const stages = ['snapshot', 'checkpoint-index', 'navigation-index', 'search-cache'] as const;
const actions = ['select', 'create', 'delete'] as const;
it('never replaces or deletes an unsaved conversation across generated write failures and navigation actions', () => {
  fc.assert(fc.property(fc.constantFrom(...stages), fc.constantFrom(...actions), (stage, action) => {
    const { storage } = createMemoryStorageHarness(); const restore = installWeeklyPlanningTestStorage(storage);
    try {
      let index = loadAiPlanningChatIndex(OWNER); const first = index.activeChatId;
      const created = createAiPlanningChat(index); const second = created.chat.id;
      index = setActiveAiPlanningChat(created.index, first);
      for (const [id, input] of [[first, snapshot('a')], [second, snapshot('b')]] as const) {
        index = updateAiPlanningChatRecord(index, id, { weekStartDate: WEEK });
        expect(saveAiPlanningChatSnapshot(OWNER, id, input)).toBe(true);
      }
      expect(saveAiPlanningChatIndex(OWNER, index)).toBe(true);
      let active = snapshot('a'); let commits = 0;
      const session = createAiPlanningChatSession(OWNER, { isCurrent: () => true, isBusy: () => false,
        exportSnapshot: () => structuredClone(active), changed() {},
        prepareImport: (input) => () => { active = structuredClone(input); commits += 1; },
        prepareNew: () => () => { active = snapshot('new'); commits += 1; },
      });
      expect(session.initialize().status).toBe('saved'); commits = 0;
      active.planningState.draftBlocks = []; // Authoritative empty state must replace the old checkpoint.
      const originalWrite = storage.setItem.bind(storage); let indexWrites = 0;
      storage.setItem = (key, value) => {
        if (key.includes('.chats.v1.')) indexWrites += 1;
        if ((stage === 'snapshot' && key.includes('.chat.v1.'))
          || (stage === 'checkpoint-index' && key.includes('.chats.v1.'))
          || (stage === 'navigation-index' && key.includes('.chats.v1.') && indexWrites === 2)
          || (stage === 'search-cache' && key.includes('.chatSearch.v1.'))) throw new Error(`forced-${stage}`);
        originalWrite(key, value);
      };
      const navigate = () => action === 'select' ? session.select(second) : action === 'create' ? session.create() : session.remove(first);
      const outcome = navigate();
      if (stage === 'search-cache') {
        expect(outcome.status).toBe('saved'); expect(commits).toBe(1); expect(session.dirty).toBe(false);
      } else {
        expect(outcome.status).toBe('blocked'); expect(commits).toBe(0);
        expect(session.index.activeChatId).toBe(first);
        expect(loadAiPlanningChatIndex(OWNER).activeChatId).toBe(first);
        expect(active.planningState.draftBlocks).toHaveLength(0);
        expect(loadAiPlanningChatSnapshot(OWNER, { ...index.chats.find(chat => chat.id === first)!, weekStartDate: WEEK })).not.toBeNull();
        expect(session.dirty).toBe(true);
        storage.setItem = originalWrite;
        expect(session.retry().status).toBe('saved'); expect(session.index.activeChatId).toBe(first);
        expect(navigate().status).toBe('saved'); expect(commits).toBe(1);
      }
      expect(session.index.activeChatId).not.toBe(first);
      if (action === 'delete') expect(loadAiPlanningChatSnapshot(OWNER, { ...index.chats.find(chat => chat.id === first)!, weekStartDate: WEEK })).toBeNull();
    } finally { restore(); }
  }), { seed: 20261004, numRuns: 24, examples: stages.flatMap(stage => actions.map(action => [stage, action] as [typeof stages[number], typeof actions[number]])) });
});

it('rejects busy, stale-owner and unavailable-target commands before writes or runtime replacement', () => {
  const { storage, values } = createMemoryStorageHarness(); const restore = installWeeklyPlanningTestStorage(storage);
  try {
    let current = true; let busy = false; let commits = 0;
    const session = createAiPlanningChatSession(OWNER, { isCurrent: () => current, isBusy: () => busy,
      exportSnapshot: () => snapshot('active'), changed() {},
      prepareImport: () => () => { commits += 1; }, prepareNew: () => () => { commits += 1; },
    });
    session.initialize(); const before = new Map(values); const id = session.index.activeChatId;
    expect(Object.isFrozen(session.index)).toBe(true); expect(Object.isFrozen(session.index.chats)).toBe(true);
    expect(() => Object.assign(session.index.chats[0], { title: 'external mutation' })).toThrow();
    busy = true; expect(session.create()).toEqual({ status: 'blocked', reason: 'busy' });
    busy = false; current = false; expect(session.remove(id)).toEqual({ status: 'blocked', reason: 'owner-changed' });
    current = true; expect(session.select('unknown')).toEqual({ status: 'blocked', reason: 'target-unavailable' });
    expect(values).toEqual(before); expect(commits).toBe(0); expect(session.index.activeChatId).toBe(id);
  } finally { restore(); }
});

it('keeps unavailable index/snapshot reads distinct from a missing store, and retries binding before writes', () => {
  fc.assert(fc.property(fc.constantFrom('index', 'snapshot', 'corrupt-index'), fc.boolean(), (failure, escape) => {
    const { storage, values } = createMemoryStorageHarness(); const restore = installWeeklyPlanningTestStorage(storage);
    try {
      const initial = loadAiPlanningChatIndex(OWNER);
      const savedIndex = updateAiPlanningChatRecord(initial, initial.activeChatId, { weekStartDate: WEEK });
      saveAiPlanningChatIndex(OWNER, savedIndex);
      saveAiPlanningChatSnapshot(OWNER, initial.activeChatId, snapshot('valuable'));
      const indexKey = [...values.keys()].find(key => key.includes('.chats.v1.'))!;
      const originalIndex = values.get(indexKey)!;
      if (failure === 'corrupt-index') values.set(indexKey, '{invalid-json');
      const before = new Map(values);
      const originalRead = storage.getItem.bind(storage);
      storage.getItem = (key) => {
        if ((failure === 'index' && key.includes('.chats.v1.')) || (failure === 'snapshot' && key.includes('.chat.v1.'))) throw new Error('read unavailable');
        return originalRead(key);
      };
      let active = snapshot('unrelated-empty'); active.planningState.draftBlocks = [];
      const session = createAiPlanningChatSession(OWNER, { isCurrent: () => true, isBusy: () => false,
        exportSnapshot: () => active, changed() {}, prepareImport: input => () => { active = structuredClone(input); },
        prepareNew: () => () => { active = snapshot('new'); },
      });
      expect(session.initialize().status).toBe('blocked');
      expect(session.requiresInitialization).toBe(true);
      storage.getItem = originalRead; // Access recovers, but unbound live state still must not be checkpointed.
      expect(session.checkpoint().status).toBe('blocked');
      expect(session.create().status).toBe('blocked'); expect(values).toEqual(before);
      if (escape && failure === 'snapshot') {
        expect(session.startWithoutRestoring().status).toBe('saved');
        expect(session.index.activeChatId).not.toBe(initial.activeChatId);
        expect(session.index.chats.some(chat => chat.id === initial.activeChatId)).toBe(true);
        expect(loadAiPlanningChatSnapshot(OWNER, savedIndex.chats[0])?.planningState.draftBlocks[0].id).toBe('valuable');
        expect(session.select(initial.activeChatId).status).toBe('saved');
      } else {
        if (escape) { expect(session.startWithoutRestoring().status).toBe('blocked'); expect(values).toEqual(before); }
        if (failure === 'corrupt-index') values.set(indexKey, originalIndex);
        expect(session.retry().status).toBe('saved');
      }
      expect(active.planningState.draftBlocks[0].id).toBe('valuable');
      expect(session.index.activeChatId).toBe(initial.activeChatId);
      expect(session.requiresInitialization).toBe(false);
    } finally { restore(); }
  }), { seed: 20261004, numRuns: 8, examples: [['index', false], ['snapshot', false], ['corrupt-index', false], ['snapshot', true]] });
});
