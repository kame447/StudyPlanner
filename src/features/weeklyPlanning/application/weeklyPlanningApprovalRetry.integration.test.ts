import { loadWeeklyPlanningStableV5PersistedSession } from './weeklyPlanningStableV5SessionStorage';
import { hydrateWeeklyPlanningStableV5RuntimeSession, resetWeeklyPlanningStableV5RuntimeSessionsForTest } from './weeklyPlanningStableV5RuntimeSession';
import { saveOwnedWeeklyPlanningState, loadOwnedWeeklyPlanningState } from '../weeklyPlanningOwnedStorage';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { largestWeeklyPlanningStableV5Checkpoint, parseWeeklyPlanningStableV5PersistedSession, prepareWeeklyPlanningStableV5Checkpoint } from './weeklyPlanningStableV5SessionCodec';
import { describe, expect, it, vi } from 'vitest';
import * as approvalTrace from '../trace/weeklyPlanningTraceRuntime';
import fc from 'fast-check';
import type { WeeklyDraftApprovalOperation } from '../planning/weeklyPlanningApprovalTypes';
import { createInitialPlanningState, weeklyPlanningReducer } from '../weeklyPlanningReducer';
import { decodeWeeklyPlanningStatePayload } from '../weeklyPlanningStorage';
import { createWeeklyPlanningTestDraftBlock } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { parseWeeklyPlanningPlanSourceId } from '../planning/weeklyPlanningPlanProvenance';
import { approveWeeklyPlanningDraftBlocks } from './weeklyPlanningApprovalApplication';
import { createMemoryWeeklyPlanningApprovalPlanRepository, createWeeklyPlanningApprovalMemoryState } from './weeklyPlanningApprovalMemoryRepository';

async function interruptedBatch(count: number, failedIndex: number, metadata: boolean, loseLedger: boolean, committed: boolean, finalizationFailure = false, idSuffix = '', options: { stable?: boolean; memoSize?: number; failRest?: boolean; probeInvalid?: boolean; oldPartial?: boolean } = {}) {
  const blocks = Array.from({ length: count }, (_, index) => createWeeklyPlanningTestDraftBlock({
    id: `retry-block-${index}${idSuffix}`,
    overrides: { memo: 'private-recovery-payload' },
    ...(metadata ? { previewMetadata: { previewId: 'original-preview', stateRevision: 0,
      ...(options.stable ? { conversationId: 'recovery-session' } : {}),
      assumptionDependencies: [], approvalEligibility: 'eligible' as const, stale: false, authorizedUserId: 'user-1' } } : {}),
  }));
  if (options.stable) {
    for (const block of blocks) {
      block.memo = 'x'.repeat(options.memoSize ?? 0);
      block.behaviorMetadata = { ...block.behaviorMetadata!, conversationId: 'recovery-session',
        reasoningKey: 'stable-v5-explicit-duration', compatibility: {
          workItemSemantic: 'generic_semantic_task', schedulerInputSource: 'stable_v5_generic_scheduler_input', candidateSource: 'stable_v5',
        } };
    }
    hydrateWeeklyPlanningStableV5RuntimeSession({ ownerId: 'user-1', weekStartDate: '2026-07-13',
      conversationId: 'recovery-session', graph: createEmptyWeeklyPlanningFactGraphV5(), updatedAt: Date.now() });
  }
  const interruptedIds = new Set<string>();
  const failedBlocks = options.failRest ? blocks.slice(failedIndex) : [blocks[failedIndex]];
  let state = weeklyPlanningReducer(createInitialPlanningState('2026-07-13'), { type: 'add_draft_blocks', blocks });
  const db = createWeeklyPlanningApprovalMemoryState();
  const repository = createMemoryWeeklyPlanningApprovalPlanRepository(db);
  let operations: WeeklyDraftApprovalOperation[] = [];
  let finalizationInterrupted = false;
  let saveCalls = 0;
  const run = () => approveWeeklyPlanningDraftBlocks({
    userId: 'user-1', plans: [], approvalOperations: operations,
    getState: () => state, dispatch: (action) => (state = weeklyPlanningReducer(state, action)),
    onOperationCompleted: (operation) => { operations = [operation]; },
    completeWeeklyApprovalOperation: async (operation) => {
      await repository.completeOperation(operation);
      if (finalizationFailure && !finalizationInterrupted) {
        finalizationInterrupted = true;
        throw new Error('finalization-response-lost');
      }
    },
    saveWeeklyApprovedPlan: async (draft) => {
      saveCalls += 1;
      const id = parseWeeklyPlanningPlanSourceId(draft.sourceId)!.sourceDraftBlockId;
      if (!interruptedIds.has(id) && failedBlocks.some((block) => block.id === id)) {
        interruptedIds.add(id);
        if (committed) await repository.saveApprovedPlan(draft);
        throw new Error('interrupted-response');
      }
      return repository.saveApprovedPlan(draft);
    },
  }, { recordApprovalStarted() {}, recordApprovalCompleted() {}, recordApprovalFailure() {} });
  await expect(run()).rejects.toThrow('一部の仮予定');
  const originalOperationId = operations[0].approvalOperationId;
  if (options.oldPartial) {
    delete state.approvalRecovery;
    interruptedIds.clear();
    await expect(run()).rejects.toThrow('一部の仮予定');
    expect(state.approvalRecovery).toBeDefined();
  }
  if (options.probeInvalid) {
    const good = structuredClone(state);
    const mutations: Array<(candidate: typeof state) => void> = [
      (candidate) => { candidate.draftBlocks[0].title = 'changed unresolved payload'; },
      (candidate) => { candidate.approvalRecovery!.operation.userId = 'other-owner'; },
      (candidate) => { candidate.approvalRecovery!.operation.approvalOperationId = 'invented-operation'; },
      (candidate) => { candidate.approvalRecovery!.operation.previewStateRevision += 1; },
      (candidate) => { candidate.approvalRecovery!.operation.status = 'completed'; },
      (candidate) => { candidate.approvalRecovery!.blocks.pop(); },
    ];
    for (const mutate of mutations) {
      state = structuredClone(good); mutate(state);
      const callsBeforeInvalid = saveCalls;
      await expect(run()).rejects.toThrow();
      expect(saveCalls).toBe(callsBeforeInvalid);
      expect(decodeWeeklyPlanningStatePayload(JSON.parse(JSON.stringify({ version: 2, state })), state.weekStartDate).draftBlocks).toHaveLength(0);
    }
    state = good;
    expect(weeklyPlanningReducer(state, { type: 'remove_draft_block', blockId: state.draftBlocks[0].id })).toBe(state);
    expect(weeklyPlanningReducer(state, { type: 'set_week_anchor', weekStartDate: '2026-07-20' })).toBe(state);
  }
  expect(state.draftBlocks.map((block) => block.id)).toEqual(failedBlocks.map((block) => block.id));
  if (!options.stable) state = decodeWeeklyPlanningStatePayload(JSON.parse(JSON.stringify({ version: 2, state })), state.weekStartDate);
  expect(state.draftBlocks).toHaveLength(failedBlocks.length);
  const checkpoint = { ownerId: 'user-1', weekStartDate: state.weekStartDate,
    conversationId: 'recovery-session', graph: createEmptyWeeklyPlanningFactGraphV5(), planningState: state };
  expect(prepareWeeklyPlanningStableV5Checkpoint(checkpoint).status).toBe('ready');
  const encoded = largestWeeklyPlanningStableV5Checkpoint({ ...checkpoint, savedAt: '2026-10-04T00:00:00.000Z' });
  expect(encoded).not.toBeNull();
  if (options.probeInvalid) {
    const corrupt = JSON.parse(encoded!.raw);
    const duplicate = JSON.parse(encoded!.raw);
    duplicate.planningState.draftBlocks.push({ ...duplicate.planningState.draftBlocks[0] });
    const clone = vi.spyOn(globalThis, 'structuredClone');
    try {
      expect(parseWeeklyPlanningStableV5PersistedSession({ ...checkpoint, raw: JSON.stringify(duplicate) })).toBeNull();
      expect(clone).not.toHaveBeenCalled();
    } finally { clone.mockRestore(); }
    corrupt.planningState.draftBlocks[0].recoveryBlockId = 'missing-original';
    expect(parseWeeklyPlanningStableV5PersistedSession({ ...checkpoint, raw: JSON.stringify(corrupt) })).toBeNull();
  }
  const restored = parseWeeklyPlanningStableV5PersistedSession({ ...checkpoint, raw: encoded!.raw });
  expect(restored).not.toBeNull();
  state = restored!.planningState;
  if (options.stable) {
    const storage = createMemoryStorageHarness();
    const restore = installWeeklyPlanningTestStorage(storage.storage);
    try {
      saveOwnedWeeklyPlanningState('user-1', state);
      resetWeeklyPlanningStableV5RuntimeSessionsForTest();
      state = loadOwnedWeeklyPlanningState('user-1', state.weekStartDate);
      expect(state.draftBlocks).toHaveLength(failedBlocks.length);
      const writesBeforeMissingRuntime = db.metrics.planWrites;
      await expect(run()).rejects.toThrow('現在の条件と一致しない');
      expect(db.metrics.planWrites).toBe(writesBeforeMissingRuntime);
      const saved = loadWeeklyPlanningStableV5PersistedSession({ ownerId: 'user-1', weekStartDate: state.weekStartDate });
      expect(saved).not.toBeNull();
      hydrateWeeklyPlanningStableV5RuntimeSession({ ...saved!, updatedAt: Date.parse(saved!.savedAt) });
    } finally { restore(); }
  }
  if (loseLedger) operations = [];
  if (finalizationFailure) {
    await expect(run()).rejects.toThrow('finalization-response-lost');
    const callsBeforeFinalizationRetry = saveCalls;
    operations = [];
    state = decodeWeeklyPlanningStatePayload(JSON.parse(JSON.stringify({ version: 2, state })), state.weekStartDate);
    expect(state.draftBlocks).toHaveLength(1);
    await run();
    expect(saveCalls).toBe(callsBeforeFinalizationRetry);
  } else {
    await run();
  }
  expect(db.metrics.planWrites).toBe(count);
  expect(db.plans.size).toBe(count);
  expect(operations[0].approvalOperationId).toBe(originalOperationId);
  expect(operations[0].items).toHaveLength(count);
  expect(operations[0].status).toBe('completed');
  expect(state.draftBlocks).toHaveLength(0);
  expect(state.approvalRecovery).toBeUndefined();
  if (options.stable) resetWeeklyPlanningStableV5RuntimeSessionsForTest();
}

describe('approval batch identity across partial-save recovery', () => {
  it('does not duplicate B when A is acknowledged, B commits without a response, and the ledger is lost', async () => {
    const trace = vi.spyOn(approvalTrace, 'recordWeeklyPlanningApprovalTrace');
    try {
      await interruptedBatch(2, 1, true, true, true, false, '', { probeInvalid: true });
      await interruptedBatch(2, 1, true, true, true, true, '', { oldPartial: true });
      expect(trace).toHaveBeenCalled();
      expect(JSON.stringify(trace.mock.calls)).not.toContain('private-recovery-payload');
      expect(JSON.stringify(trace.mock.calls)).not.toContain('approvalRecovery');
    } finally { trace.mockRestore(); }
  });
  it('restores conversation-bound Stable V5 recovery without duplicating large draft payloads', async () => {
    await interruptedBatch(5, 1, true, true, true, false, '', { stable: true, memoSize: 250_000, failRest: true });
  });
  it('retains recovery for batches above the optional ledger limit through the session maximum', async () => {
    await interruptedBatch(201, 100, true, true, true);
    await interruptedBatch(500, 499, false, true, true);
    await interruptedBatch(2, 1, true, true, true, true, 'x'.repeat(310));
  });
  it('preserves the original batch across generated interruption positions and compatibility shapes', async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 2, max: 5 }), fc.nat(), fc.boolean(), fc.boolean(), fc.boolean(), fc.boolean(),
      async (count, position, metadata, loseLedger, committed, finalizationFailure) => {
        await interruptedBatch(count, position % count, metadata, loseLedger, committed, finalizationFailure);
      }), { seed: 20261004, numRuns: 40 });
  });
});
