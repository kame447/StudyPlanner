import { afterEach, describe, expect, it } from 'vitest';
import { createPlanFromDraft } from '../../../domain/planner';
import type { PlanDraft } from '../../../types/domain';
import {
  clearWeeklyPlanningSessionRuntime,
  publishWeeklyPlanningSessionRuntime,
} from '../planning/weeklyPlanningSessionRuntime';
import {
  createEmptyWeeklyPlanningFactGraphV5,
} from '../semantic/weeklyPlanningFactGraphV5';
import { createWeeklyPlanningTestDraftBlock } from '../testUtils/weeklyPlanningApplicationTestHarness';
import type { PlanningState, WeeklyPlanningAction } from '../types';
import { createInitialPlanningState, weeklyPlanningReducer } from '../weeklyPlanningReducer';
import { approveWeeklyPlanningDraftBlocks } from './weeklyPlanningApprovalApplication';
import {
  hydrateWeeklyPlanningStableV5RuntimeSession,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from './weeklyPlanningStableV5RuntimeSession';

const CONVERSATION_ID = 'stable-conversation-1';
const REVISION = 3;

function stableV5Block() {
  const block = createWeeklyPlanningTestDraftBlock({
    id: 'stable-block-1',
    previewMetadata: {
      previewId: `stable-v5-preview:${CONVERSATION_ID}:${REVISION}`,
      conversationId: CONVERSATION_ID,
      stateRevision: REVISION,
      assumptionDependencies: [],
      approvalEligibility: 'eligible',
      stale: false,
      authorizedUserId: 'user-1',
    },
  });
  block.behaviorMetadata = {
    ...block.behaviorMetadata!,
    conversationId: CONVERSATION_ID,
    stateRevision: REVISION,
    reasoningKey: 'stable-v5-explicit-duration',
    compatibility: {
      workItemSemantic: 'generic_semantic_task',
      schedulerInputSource: 'stable_v5_generic_scheduler_input',
      candidateSource: 'stable_v5',
    },
  };
  return block;
}

function createStore(): {
  getState(): PlanningState;
  dispatch(action: WeeklyPlanningAction): PlanningState;
} {
  let state = createInitialPlanningState('2026-07-13');
  state = weeklyPlanningReducer(state, {
    type: 'add_draft_blocks',
    blocks: [stableV5Block()],
  });
  return {
    getState: () => state,
    dispatch(action) {
      state = weeklyPlanningReducer(state, action);
      return state;
    },
  };
}

function hydrateStableRuntime(): void {
  hydrateWeeklyPlanningStableV5RuntimeSession({
    ownerId: 'user-1',
    weekStartDate: '2026-07-13',
    conversationId: CONVERSATION_ID,
    graph: {
      ...createEmptyWeeklyPlanningFactGraphV5(),
      revision: REVISION,
    },
  });
}

afterEach(() => {
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  clearWeeklyPlanningSessionRuntime();
});

describe('Stable V5 approval application runtime selection', () => {
  it('saves against the preview own conversation even when another legacy runtime is current', async () => {
    const store = createStore();
    hydrateStableRuntime();
    publishWeeklyPlanningSessionRuntime({
      conversationId: 'another-current-conversation',
      stateRevision: REVISION,
      proposalRecords: [],
    });
    const saved: PlanDraft[] = [];

    await approveWeeklyPlanningDraftBlocks({
      userId: 'user-1',
      plans: [],
      approvalOperations: [],
      async saveWeeklyApprovedPlan(draft) {
        saved.push(draft);
        return {
          ...createPlanFromDraft(draft),
          id: 'saved-plan-1',
        };
      },
      getState: store.getState,
      dispatch: store.dispatch,
      onOperationCompleted: () => undefined,
    });

    expect(saved).toHaveLength(1);
    expect(store.getState().draftBlocks).toEqual([]);
  });

  it('does not fall back to a matching legacy runtime when the Stable V5 conversation runtime is missing', async () => {
    const store = createStore();
    publishWeeklyPlanningSessionRuntime({
      conversationId: CONVERSATION_ID,
      stateRevision: REVISION,
      proposalRecords: [],
    });
    let saveCount = 0;

    await expect(approveWeeklyPlanningDraftBlocks({
      userId: 'user-1',
      plans: [],
      approvalOperations: [],
      async saveWeeklyApprovedPlan(draft) {
        saveCount += 1;
        return {
          ...createPlanFromDraft(draft),
          id: 'should-not-save',
        };
      },
      getState: store.getState,
      dispatch: store.dispatch,
      onOperationCompleted: () => undefined,
    })).rejects.toThrow('最新条件で再計算してください');

    expect(saveCount).toBe(0);
  });
});
