import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getWeeklyPlanningStableV5SessionStorageKeyForTest } from '../../application/weeklyPlanningStableV5SessionStorage';
import { hydrateWeeklyPlanningStableV5RuntimeSession, resetWeeklyPlanningStableV5RuntimeSessionsForTest } from '../../application/weeklyPlanningStableV5RuntimeSession';
import { applyWeeklyPlanningPreviewMove } from '../../preview/weeklyPlanningPreviewEdits';
import { classifyWeeklyPlanningApprovalAvailability } from '../../application/weeklyPlanningApprovalAvailability';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../../semantic/weeklyPlanningFactGraphV5';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import type { WeeklyPlanDraftBlock } from '../../types';
import { loadOwnedWeeklyPlanningState, saveOwnedWeeklyPlanningState } from '../../weeklyPlanningOwnedStorage';
import { createInitialPlanningState } from '../../weeklyPlanningReducer';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';

const OWNER = 'c1-owner';
const WEEK = '2026-07-20';
const CONVERSATION = 'c1-conversation';
const NOW = '2026-07-23T08:05:00.000Z';

// weeklyPlanningOwnedStorage.ts and weeklyPlanningStateCodec.ts are unchanged from cc1cbce6;
// saveOwnedWeeklyPlanningState is the V5 writer, not a hand-written storage envelope.
function editedV5Draft(): WeeklyPlanDraftBlock {
  return {
    id: 'stable-v5-draft-1', userId: OWNER, date: '2026-07-23', startTime: '10:00', endTime: '10:30',
    title: '英単語 30分', subject: '英単語', type: 'study', label: '英単語', memo: '利用者が変更した未保存の仮予定',
    source: 'ai', status: 'draft', userEdited: true, createdAt: NOW, updatedAt: NOW,
    behaviorMetadata: {
      conversationId: CONVERSATION, stateRevision: 0, sourceFactRefs: [], usedAssumptionProposalRefs: [],
      taskRef: 'v5-task', opportunityTags: [], reasoningKey: 'stable-v5-explicit-duration',
      compatibility: { workItemSemantic: 'generic_semantic_task', schedulerInputSource: 'stable_v5_generic_scheduler_input', candidateSource: 'stable_v5' },
      previewMetadata: { previewId: 'stable-v5-preview', conversationId: CONVERSATION, stateRevision: 0,
        assumptionDependencies: [], approvalEligibility: 'eligible', stale: false, authorizedUserId: OWNER },
    },
  };
}

describe('C1: an edited V5 draft remains visible and editable after the first VNext load', () => {
  let memory: ReturnType<typeof createMemoryStorageHarness>;
  let restoreStorage: () => void;
  beforeEach(() => {
    memory = createMemoryStorageHarness();
    restoreStorage = installWeeklyPlanningTestStorage(memory.storage);
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  });
  afterEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    restoreStorage();
  });

  function savedV5Draft() {
    const block = editedV5Draft();
    hydrateWeeklyPlanningStableV5RuntimeSession({ ownerId: OWNER, weekStartDate: WEEK,
      conversationId: CONVERSATION, graph: createEmptyWeeklyPlanningFactGraphV5() });
    const state = { ...createInitialPlanningState(WEEK), mode: 'awaiting_approval' as const,
      draftBlocks: [block], previewCandidates: [], messages: [{
        id: 'c1-message', role: 'user' as const, content: '英単語を30分進めたい', createdAt: NOW,
      }] };
    saveOwnedWeeklyPlanningState(OWNER, state);
    const key = getWeeklyPlanningStableV5SessionStorageKeyForTest(OWNER, WEEK);
    const raw = memory.storage.getItem(key);
    expect(raw).not.toBeNull();
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    expect(loadOwnedWeeklyPlanningState(OWNER, WEEK).draftBlocks).toEqual([block]);
    return { block, key, raw, state };
  }

  it('retains the edited draft for display and editing without restoring old approval authority', () => {
    const { block, key, raw, state } = savedV5Draft();
    const local = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: memory.storage });
    const loaded = local.load();
    expect(loaded.conversationId).toBe(CONVERSATION);
    expect(loaded.state.messages).toEqual(state.messages);
    expect(loaded.state.draftBlocks).toEqual([block]);
    expect(applyWeeklyPlanningPreviewMove(loaded.state.draftBlocks[0], {
      date: '2026-07-24', startTime: '11:00', endTime: '11:30',
    }, NOW)).toMatchObject({ userEdited: true, startTime: '11:00', endTime: '11:30', memo: block.memo });
    expect(loaded.state.previewCandidates).toEqual([]);
    expect(classifyWeeklyPlanningApprovalAvailability({ blocks: loaded.state.draftBlocks,
      userId: OWNER, resolveRuntime: local.resolveRuntime })).toMatchObject({ kind: 'recompute_required' });
    expect(memory.storage.getItem(key)).toBe(raw);
    const reopened = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: memory.storage });
    expect(reopened.load().state.draftBlocks).toEqual([block]);
  });

  it('keeps the original V5 bytes and refuses a different owner or corrupted source', () => {
    const { key, raw } = savedV5Draft();
    const other = createWeeklyPlanningVNextLocalSession({ ownerId: 'different-owner', weekStartDate: WEEK,
      storage: memory.storage, legacyV5Raw: raw });
    expect(other.load().state.draftBlocks).toEqual([]);
    expect(other.checkpoint.read()).toBeNull();
    const corrupt = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK,
      storage: memory.storage, chatId: 'corrupt-isolated-chat', legacyV5Raw: '{invalid-json' });
    expect(corrupt.load().state.draftBlocks).toEqual([]);
    expect(corrupt.checkpoint.read()).toBeNull();
    expect(memory.storage.getItem(key)).toBe(raw);
  });
});
