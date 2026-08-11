import { describe, expect, it } from 'vitest';
import { createPlanFromDraft } from '../../../domain/planner';
import type { Plan, PlanDraft } from '../../../types/domain';
import {
  createWeeklyPlanningTestDraftBlock,
} from '../testUtils/weeklyPlanningApplicationTestHarness';
import type { PlanningState, WeeklyPlanningAction } from '../types';
import { createInitialPlanningState, weeklyPlanningReducer } from '../weeklyPlanningReducer';
import { approveWeeklyPlanningDraftBlocks } from './weeklyPlanningApprovalApplication';

const OWNER_ID = 'user-estimate-metadata';
const CONVERSATION_ID = 'conversation-estimate-metadata';
const WEEK_START = '2026-08-10';

function store(): {
  getState(): PlanningState;
  dispatch(action: WeeklyPlanningAction): PlanningState;
} {
  const previewMetadata = {
    previewId: `stable-v5-preview:${CONVERSATION_ID}:1`,
    conversationId: CONVERSATION_ID,
    stateRevision: 1,
    assumptionDependencies: [],
    approvalEligibility: 'eligible' as const,
    stale: false,
    authorizedUserId: OWNER_ID,
  };
  let state = createInitialPlanningState(WEEK_START);
  state = weeklyPlanningReducer(state, {
    type: 'add_draft_blocks',
    blocks: [createWeeklyPlanningTestDraftBlock({
      id: 'block-math',
      userId: OWNER_ID,
      previewMetadata,
      overrides: {
        date: '2026-08-11',
        startTime: '19:00',
        endTime: '20:15',
        title: '数学ワーク 20問',
        subject: '数学ワーク',
        behaviorMetadata: {
          conversationId: CONVERSATION_ID,
          stateRevision: 1,
          sourceFactRefs: ['task-math', 'workload-math', 'estimate-math'],
          usedAssumptionProposalRefs: [],
          taskRef: 'task-math',
          opportunityTags: [],
          reasoningKey: 'stable-v5-explicit-duration',
          compatibility: {
            workItemSemantic: 'generic_semantic_task',
            schedulerInputSource: 'stable_v5_generic_scheduler_input',
            candidateSource: 'stable_v5',
          },
          previewMetadata,
          estimateMetadata: {
            version: 1,
            baseEstimateMinutes: 61,
            estimateBasis: 'direct_effort',
            calibrationMultiplier: 1,
            allocationMinutes: 75,
            roundingStepMinutes: 15,
            sourceFactRefs: ['task-math', 'workload-math', 'estimate-math'],
          },
        },
      },
    })],
  });
  state = {
    ...state,
    intakeState: {
      status: 'draft_ready',
      intent: 'weekly_study_planning',
      tasks: [],
      progress: [],
      unitRates: [],
      constraints: [],
      priorityPolicy: { kind: 'unknown' },
      missing: [],
      assumptions: [],
      uncertainties: [],
      questions: [],
      shouldCreateDraft: true,
      shouldSavePlan: false,
      draftGenerationIntent: 'user_authorized',
      sourceTurns: ['数学ワークを20問、61分くらい'],
    },
  };
  return {
    getState: () => state,
    dispatch(action) {
      state = weeklyPlanningReducer(state, action);
      return state;
    },
  };
}

describe('weekly planning estimate metadata approval', () => {
  it('persists the unrounded baseline separately from the 75-minute calendar allocation', async () => {
    const state = store();
    let savedDraft: PlanDraft | null = null;

    await approveWeeklyPlanningDraftBlocks({
      userId: OWNER_ID,
      plans: [],
      approvalOperations: [],
      async saveWeeklyApprovedPlan(draft) {
        savedDraft = structuredClone(draft);
        return createPlanFromDraft(draft);
      },
      getState: state.getState,
      dispatch: state.dispatch,
      onOperationCompleted() {},
    });

    const estimate = (savedDraft as PlanDraft & {
      weeklyPlanningEstimate?: {
        baseEstimateMinutes: number;
        allocationMinutes: number;
        roundingStepMinutes: number;
        sourceFactRefs: string[];
      };
    } | null)?.weeklyPlanningEstimate;
    expect(estimate).toMatchObject({
      baseEstimateMinutes: 61,
      allocationMinutes: 75,
      roundingStepMinutes: 15,
      sourceFactRefs: expect.arrayContaining(['workload-math', 'estimate-math']),
    });

    const persisted = createPlanFromDraft(savedDraft! as PlanDraft) as Plan & {
      weeklyPlanningEstimate?: unknown;
    };
    expect(persisted.weeklyPlanningEstimate).toEqual(estimate);
  });
});
