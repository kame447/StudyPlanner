import { describe, expect, it, vi } from 'vitest';
import { createPlanFromDraft } from '../../../domain/planner';
import type { PlanDraft } from '../../../types/domain';
import type {
  WeeklyDraftApprovalOperation,
  WeeklyPreviewMetadata,
} from '../planning/weeklyPlanningApprovalTypes';
import type { PlanningState, WeeklyPlanningAction } from '../types';
import { createWeeklyPlanningTestDraftBlock } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { createInitialPlanningState, weeklyPlanningReducer } from '../weeklyPlanningReducer';
import { approveWeeklyPlanningDraftBlocks } from './weeklyPlanningApprovalApplication';

const metadata: WeeklyPreviewMetadata = {
  previewId: 'preview-server-completion',
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
  let state = weeklyPlanningReducer(createInitialPlanningState('2026-07-13'), {
    type: 'add_draft_blocks',
    blocks: [createWeeklyPlanningTestDraftBlock({
      id: 'block-1',
      previewMetadata: metadata,
    })],
  });
  return {
    getState: () => state,
    dispatch(action) {
      state = weeklyPlanningReducer(state, action);
      return state;
    },
  };
}

describe('weeklyPlanningApprovalApplication server completion', () => {
  it('retries only server finalization after every Plan item was already saved', async () => {
    const store = createStore();
    let operations: WeeklyDraftApprovalOperation[] = [];
    const savePlan = vi.fn(async (draft: PlanDraft) => ({
      ...createPlanFromDraft(draft),
      id: 'persisted-plan-1',
    }));
    const completeServerOperation = vi
      .fn<(operation: WeeklyDraftApprovalOperation) => Promise<void>>()
      .mockRejectedValueOnce(new Error('server-finalization-failed'))
      .mockResolvedValue(undefined);
    const recordOperation = (operation: WeeklyDraftApprovalOperation) => {
      operations = [operation];
    };

    await expect(approveWeeklyPlanningDraftBlocks({
      userId: 'user-1',
      plans: [],
      approvalOperations: operations,
      saveWeeklyApprovedPlan: savePlan,
      completeWeeklyApprovalOperation: completeServerOperation,
      getState: store.getState,
      dispatch: store.dispatch,
      onOperationCompleted: recordOperation,
    })).rejects.toThrow('server-finalization-failed');

    expect(savePlan).toHaveBeenCalledTimes(1);
    expect(operations[0].status).toBe('completed');
    expect(store.getState().draftBlocks).toHaveLength(1);
    expect(store.getState().pendingApproval).toBeUndefined();

    await expect(approveWeeklyPlanningDraftBlocks({
      userId: 'user-1',
      plans: [],
      approvalOperations: operations,
      saveWeeklyApprovedPlan: savePlan,
      completeWeeklyApprovalOperation: completeServerOperation,
      getState: store.getState,
      dispatch: store.dispatch,
      onOperationCompleted: recordOperation,
    })).resolves.toBeUndefined();

    expect(savePlan).toHaveBeenCalledTimes(1);
    expect(completeServerOperation).toHaveBeenCalledTimes(2);
    expect(store.getState().draftBlocks).toEqual([]);
    expect(store.getState().lastAssistantMessage).toBe(
      '1件の仮予定を通常予定として保存しました。',
    );
  });
});
