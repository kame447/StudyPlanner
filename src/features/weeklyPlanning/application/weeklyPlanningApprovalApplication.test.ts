import { describe, expect, it } from 'vitest';
import { createPlanFromDraft } from '../../../domain/planner';
import type { Plan, PlanDraft } from '../../../types/domain';
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

function readSourceBlockId(draft: PlanDraft): string {
  const match = draft.memo.match(/\[weekly-source:([^\]]+)\]/);
  if (!match) throw new Error('weekly source marker was not added');
  return match[1];
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
    expect(approvalOperations[0].items[0].planId).toBe('persisted-plan-block-1');
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
    expect(approvalOperations[0].items.map((item) => item.planId)).toEqual([
      'persisted-plan-block-1',
      'persisted-plan-block-2',
    ]);
    expect(store.getState().draftBlocks).toEqual([]);
    expect(store.getState().pendingApproval).toBeUndefined();
    expect(store.getState().lastAssistantMessage).toBe('2件の仮予定を通常予定として保存しました。');
  });
});
