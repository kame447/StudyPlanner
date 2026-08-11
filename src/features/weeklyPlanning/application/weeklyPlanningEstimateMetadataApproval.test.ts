import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlanFromDraft } from '../../../domain/planner';
import type { Plan, PlanDraft } from '../../../types/domain';
import {
  createWeeklyPlanningTestDraftBlock,
} from '../testUtils/weeklyPlanningApplicationTestHarness';
import {
  createEmptyWeeklyPlanningFactGraphV5,
} from '../semantic/weeklyPlanningFactGraphV5';
import type { PlanningState, WeeklyPlanningAction } from '../types';
import { createInitialPlanningState, weeklyPlanningReducer } from '../weeklyPlanningReducer';
import {
  hydrateWeeklyPlanningStableV5RuntimeSession,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from './weeklyPlanningStableV5RuntimeSession';
import { approveWeeklyPlanningDraftBlocks } from './weeklyPlanningApprovalApplication';

const OWNER_ID = 'user-estimate-metadata';
const CONVERSATION_ID = 'conversation-estimate-metadata';
const WEEK_START = '2026-08-10';

function graph() {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 1,
    tasks: [{
      id: 'task-math',
      category: 'study' as const,
      title: '数学ワーク',
      source: {
        conversationId: CONVERSATION_ID,
        turnId: `${CONVERSATION_ID}:request:1`,
        semanticLocalId: 'task-local',
        sourceText: '数学ワークを20問',
        origin: 'user' as const,
      },
      createdRevision: 1,
    }],
    workloads: [{
      id: 'workload-math',
      taskId: 'task-math',
      componentId: null,
      quantityRole: 'target' as const,
      amount: 20,
      unitCode: 'problem' as const,
      unitLabel: '問',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      source: {
        conversationId: CONVERSATION_ID,
        turnId: `${CONVERSATION_ID}:request:1`,
        semanticLocalId: 'workload-local',
        sourceText: '20問',
        origin: 'user' as const,
      },
      createdRevision: 1,
    }],
    effortEstimates: [{
      id: 'estimate-math',
      taskId: 'task-math',
      targetFactId: 'workload-math',
      kind: 'total_duration' as const,
      minutes: 61,
      unitCode: null,
      precision: 'approximate' as const,
      source: {
        conversationId: CONVERSATION_ID,
        turnId: `${CONVERSATION_ID}:request:1`,
        semanticLocalId: 'estimate-local',
        sourceText: '61分くらい',
        origin: 'user' as const,
      },
      createdRevision: 1,
    }],
    factLifecycles: [
      { factId: 'task-math', status: 'active' as const, createdRevision: 1, terminalRevision: null, supersededByFactId: null },
      { factId: 'workload-math', status: 'active' as const, createdRevision: 1, terminalRevision: null, supersededByFactId: null },
      { factId: 'estimate-math', status: 'active' as const, createdRevision: 1, terminalRevision: null, supersededByFactId: null },
    ],
  };
}

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
  beforeEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    hydrateWeeklyPlanningStableV5RuntimeSession({
      ownerId: OWNER_ID,
      weekStartDate: WEEK_START,
      conversationId: CONVERSATION_ID,
      graph: graph(),
    });
  });

  afterEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  });

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
