import { describe, expect, it, vi } from 'vitest';
import { createPlanFromDraft } from '../../../domain/planner';
import type { Plan, PlanDraft } from '../../../types/domain';
import {
  parseWeeklyPlanningPlanSourceId,
  WEEKLY_PLANNING_PLAN_SOURCE_TYPE,
} from '../planning/weeklyPlanningPlanProvenance';
import type {
  WeeklyDraftApprovalOperation,
  WeeklyPreviewMetadata,
} from '../planning/weeklyPlanningApprovalTypes';
import type { PlanningState, WeeklyPlanningAction } from '../types';
import { createWeeklyPlanningTestDraftBlock } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { createInitialPlanningState, weeklyPlanningReducer } from '../weeklyPlanningReducer';
import { approveWeeklyPlanningDraftBlocks } from './weeklyPlanningApprovalApplication';

const metadata: WeeklyPreviewMetadata = {
  previewId: 'preview-partial-retry',
  stateRevision: 0,
  assumptionDependencies: [],
  approvalEligibility: 'eligible',
  stale: false,
  authorizedUserId: 'user-1',
};

function createStore(): {
  getState(): PlanningState;
  dispatch(action: WeeklyPlanningAction): PlanningState;
} {
  let state = createInitialPlanningState('2026-07-13');
  state = weeklyPlanningReducer(state, {
    type: 'add_draft_blocks',
    blocks: [
      createWeeklyPlanningTestDraftBlock({ id: 'block-1', previewMetadata: metadata }),
      createWeeklyPlanningTestDraftBlock({ id: 'block-2', previewMetadata: metadata }),
    ],
  });
  return {
    getState: () => state,
    dispatch(action) {
      state = weeklyPlanningReducer(state, action);
      return state;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function readSourceBlockId(draft: PlanDraft): string {
  expect(draft.sourceType).toBe(WEEKLY_PLANNING_PLAN_SOURCE_TYPE);
  const identity = parseWeeklyPlanningPlanSourceId(draft.sourceId);
  if (!identity) throw new Error('weekly planning source identity was not added');
  return identity.sourceDraftBlockId;
}

function createWeeklyPlanningTestDraftBlockDraft(id: string): PlanDraft {
  return { userId: 'user-1', title: id, subject: '数学', date: '2026-07-14', startTime: '18:00', endTime: '19:00', repeat: 'none', repeatUntil: null,
    excludedDates: [], recurrenceRules: [], type: 'study', memo: '', sourceType: 'manual', sourceId: null, materialId: null, materialName: '' };
}

function persistedPlan(draft: PlanDraft, id: string): Plan {
  return {
    ...createPlanFromDraft(draft),
    id,
  };
}

describe('weeklyPlanningApprovalApplication', () => {
  it('does not begin an approval operation without an authenticated user', async () => {
    const store = createStore();
    let saveCount = 0;
    let completionCount = 0;

    await approveWeeklyPlanningDraftBlocks({
      userId: null,
      plans: [],
      approvalOperations: [],
      saveWeeklyApprovedPlan: async (draft) => {
        saveCount += 1;
        return persistedPlan(draft, 'unused-plan');
      },
      getState: store.getState,
      dispatch: store.dispatch,
      onOperationCompleted: () => {
        completionCount += 1;
      },
    });

    expect(saveCount).toBe(0);
    expect(completionCount).toBe(0);
    expect(store.getState().pendingApproval).toBeUndefined();
    expect(store.getState().draftBlocks).toHaveLength(2);
  });

  it('reuses the approval operation, records real Plan IDs, and retries only the failed item', async () => {
    const store = createStore();
    let approvalOperations: WeeklyDraftApprovalOperation[] = [];
    const savedSourceIds: string[] = [];
    const attempts = new Map<string, number>();

    const saveWeeklyApprovedPlan = async (draft: PlanDraft): Promise<Plan> => {
      const sourceBlockId = readSourceBlockId(draft);
      savedSourceIds.push(sourceBlockId);
      const attempt = (attempts.get(sourceBlockId) ?? 0) + 1;
      attempts.set(sourceBlockId, attempt);
      if (sourceBlockId === 'block-2' && attempt === 1) {
        throw new Error('forced-save-failure');
      }
      return persistedPlan(draft, `persisted-plan-${sourceBlockId}`);
    };
    const onOperationCompleted = (operation: WeeklyDraftApprovalOperation) => {
      approvalOperations = [
        ...approvalOperations.filter(
          (current) => current.approvalOperationId !== operation.approvalOperationId,
        ),
        operation,
      ];
    };

    await expect(approveWeeklyPlanningDraftBlocks({
      userId: 'user-1',
      plans: [],
      approvalOperations,
      saveWeeklyApprovedPlan,
      getState: store.getState,
      dispatch: store.dispatch,
      onOperationCompleted,
    })).rejects.toThrow('一部の仮予定を保存できませんでした');

    expect(savedSourceIds).toEqual(['block-1', 'block-2']);
    expect(store.getState().draftBlocks.map((block) => block.id)).toEqual(['block-2']);
    expect(approvalOperations).toHaveLength(1);
    expect(approvalOperations[0].status).toBe('partially_saved');
    expect(approvalOperations[0].items.map((item) => item.status)).toEqual(['saved', 'failed']);
    expect(approvalOperations[0].items[0].savedPlanId).toBe('persisted-plan-block-1');
    const approvalOperationId = approvalOperations[0].approvalOperationId;

    await expect(approveWeeklyPlanningDraftBlocks({
      userId: 'user-1',
      plans: [],
      approvalOperations,
      saveWeeklyApprovedPlan,
      getState: store.getState,
      dispatch: store.dispatch,
      onOperationCompleted,
    })).resolves.toBeUndefined();

    expect(savedSourceIds).toEqual(['block-1', 'block-2', 'block-2']);
    expect(attempts.get('block-1')).toBe(1);
    expect(attempts.get('block-2')).toBe(2);
    expect(approvalOperations).toHaveLength(1);
    expect(approvalOperations[0].approvalOperationId).toBe(approvalOperationId);
    expect(approvalOperations[0].status).toBe('completed');
    expect(approvalOperations[0].items.map((item) => item.status)).toEqual(['saved', 'saved']);
    expect(approvalOperations[0].items.map((item) => item.savedPlanId)).toEqual([
      'persisted-plan-block-1',
      'persisted-plan-block-2',
    ]);
    expect(store.getState().draftBlocks).toEqual([]);
    expect(store.getState().pendingApproval).toBeUndefined();
    expect(store.getState().lastAssistantMessage).toBe('2件の仮予定を通常予定として保存しました。');
  });

  it('stops before the second save after session reset and does not dispatch an old completion message', async () => {
    const store = createStore();
    const firstSave = deferred<Plan>();
    const savedSourceIds: string[] = [];
    let firstDraft: PlanDraft | undefined;
    let completedOperation: WeeklyDraftApprovalOperation | undefined;

    const approval = approveWeeklyPlanningDraftBlocks({
      userId: 'user-1',
      plans: [],
      approvalOperations: [],
      async saveWeeklyApprovedPlan(draft) {
        const sourceBlockId = readSourceBlockId(draft);
        savedSourceIds.push(sourceBlockId);
        if (sourceBlockId === 'block-1') {
          firstDraft = draft;
          return firstSave.promise;
        }
        return persistedPlan(draft, `persisted-plan-${sourceBlockId}`);
      },
      getState: store.getState,
      dispatch: store.dispatch,
      onOperationCompleted(operation) {
        completedOperation = operation;
      },
    });

    await vi.waitFor(() => expect(savedSourceIds).toEqual(['block-1']));
    store.dispatch({ type: 'reset_session' });
    firstSave.resolve(persistedPlan(firstDraft!, 'persisted-plan-block-1'));
    await expect(approval).resolves.toBeUndefined();

    expect(savedSourceIds).toEqual(['block-1']);
    expect(completedOperation?.status).toBe('partially_saved');
    expect(completedOperation?.items.map((item) => item.status)).toEqual(['saved', 'pending']);
    expect(store.getState().pendingApproval).toBeUndefined();
    expect(store.getState().lastAssistantMessage).toBeUndefined();
  });

  it('stops before the second save after the selected week is replaced', async () => {
    const store = createStore();
    const firstSave = deferred<Plan>();
    const savedSourceIds: string[] = [];
    let firstDraft: PlanDraft | undefined;
    let completedOperation: WeeklyDraftApprovalOperation | undefined;

    const approval = approveWeeklyPlanningDraftBlocks({
      userId: 'user-1',
      plans: [],
      approvalOperations: [],
      async saveWeeklyApprovedPlan(draft) {
        const sourceBlockId = readSourceBlockId(draft);
        savedSourceIds.push(sourceBlockId);
        if (sourceBlockId === 'block-1') {
          firstDraft = draft;
          return firstSave.promise;
        }
        return persistedPlan(draft, `persisted-plan-${sourceBlockId}`);
      },
      getState: store.getState,
      dispatch: store.dispatch,
      onOperationCompleted(operation) {
        completedOperation = operation;
      },
    });

    await vi.waitFor(() => expect(savedSourceIds).toEqual(['block-1']));
    store.dispatch({
      type: 'load_state',
      state: createInitialPlanningState('2026-07-20'),
    });
    firstSave.resolve(persistedPlan(firstDraft!, 'persisted-plan-block-1'));
    await expect(approval).resolves.toBeUndefined();

    expect(savedSourceIds).toEqual(['block-1']);
    expect(completedOperation?.status).toBe('partially_saved');
    expect(store.getState().weekStartDate).toBe('2026-07-20');
    expect(store.getState().pendingApproval).toBeUndefined();
    expect(store.getState().lastAssistantMessage).toBeUndefined();
  });

  describe('the saved plan memo', () => {
    function storeWith(blocks: ReturnType<typeof createWeeklyPlanningTestDraftBlock>[]) {
      let state = createInitialPlanningState('2026-07-13');
      state = weeklyPlanningReducer(state, { type: 'add_draft_blocks', blocks });
      return {
        getState: () => state,
        dispatch(action: WeeklyPlanningAction) { state = weeklyPlanningReducer(state, action); return state; },
      };
    }
    const approve = (store: ReturnType<typeof storeWith>, plans: Plan[], saved: PlanDraft[]) => approveWeeklyPlanningDraftBlocks({
      userId: 'user-1', plans, approvalOperations: [],
      saveWeeklyApprovedPlan: async draft => { saved.push(draft); return persistedPlan(draft, `persisted-${saved.length}`); },
      getState: store.getState, dispatch: store.dispatch, onOperationCompleted: () => undefined,
    });

    it('is only the user\'s own text: no source or operation marker, with the identity kept in sourceId', async () => {
      const saved: PlanDraft[] = [];
      const store = storeWith([
        createWeeklyPlanningTestDraftBlock({ id: 'block-1', previewMetadata: metadata, overrides: { memo: '図書館で' } }),
        createWeeklyPlanningTestDraftBlock({ id: 'block-2', previewMetadata: metadata, overrides: { memo: '' } }),
      ]);
      await approve(store, [], saved);
      expect(saved.map(draft => draft.memo)).toEqual(['図書館で', '']);
      for (const draft of saved) {
        expect(draft.memo).not.toMatch(/weekly-source|weekly-approval/u);
        expect(parseWeeklyPlanningPlanSourceId(draft.sourceId)).toMatchObject({ sourceDraftBlockId: draft.sourceId!.split(':')[2] });
        expect(draft.sourceType).toBe(WEEKLY_PLANNING_PLAN_SOURCE_TYPE);
      }
      expect(saved.map(readSourceBlockId)).toEqual(['block-1', 'block-2']);
    });

    it('still recognises a plan an older version saved (its memo carries the source marker) and does not save it again', async () => {
      const saved: PlanDraft[] = [];
      const store = storeWith([
        createWeeklyPlanningTestDraftBlock({ id: 'block-1', previewMetadata: metadata }),
        createWeeklyPlanningTestDraftBlock({ id: 'block-2', previewMetadata: metadata }),
      ]);
      const legacy: Plan = { ...persistedPlan({ ...createWeeklyPlanningTestDraftBlockDraft('block-1') }, 'legacy-plan-1'),
        sourceType: 'manual', memo: 'Stable V5 preview / graphRevision: 1 / workItemKey: w1 / [weekly-source:block-1] / [weekly-approval:old-op]' };
      await approve(store, [legacy], saved);
      expect(saved.map(readSourceBlockId)).toEqual(['block-2']);
    });

    it('does not take another user\'s or a weekly-planning-typed plan for the legacy marker match', async () => {
      const saved: PlanDraft[] = [];
      const store = storeWith([createWeeklyPlanningTestDraftBlock({ id: 'block-1', previewMetadata: metadata })]);
      const base = persistedPlan({ ...createWeeklyPlanningTestDraftBlockDraft('block-1') }, 'other');
      await approve(store, [{ ...base, id: 'other-user', userId: 'user-2', sourceType: 'manual', memo: '[weekly-source:block-1]' },
        { ...base, id: 'typed', sourceType: WEEKLY_PLANNING_PLAN_SOURCE_TYPE, memo: '[weekly-source:block-1]' }], saved);
      expect(saved.map(readSourceBlockId)).toEqual(['block-1']);
    });
  });
});
