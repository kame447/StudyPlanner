import { beforeEach, describe, expect, it } from 'vitest';
import {
  classifyWeeklyPlanningApprovalAvailability,
} from '../application/weeklyPlanningApprovalAvailability';
import {
  hydrateWeeklyPlanningStableV5RuntimeSession,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from '../application/weeklyPlanningStableV5RuntimeSession';
import type {
  PlanningIntakeState,
} from '../intake/weeklyPlanningIntakeTypes';
import {
  createWeeklyDraftBlocksFromPreviewCandidates,
} from '../preview/weeklyPlanningPreviewBlocks';
import type {
  WeeklyDraftCandidate,
} from '../scheduling/weeklyDraftCandidateGenerator';
import {
  createEmptyWeeklyPlanningFactGraphV5,
} from '../semantic/weeklyPlanningFactGraphV5';
import type {
  PlanningState,
  WeeklyPlanningAction,
  WeeklyPlanningPendingTurn,
} from '../types';
import {
  createInitialPlanningState,
  weeklyPlanningReducer,
} from '../weeklyPlanningReducer';

const USER_ID = 'preview-correction-lifecycle-user';
const WEEK_START_DATE = '2026-08-10';
const CONVERSATION_ID = 'conversation-preview-correction-lifecycle';

function intakeState(): PlanningIntakeState {
  return {
    status: 'revision_pending',
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
    shouldCreateDraft: false,
    shouldSavePlan: false,
    draftGenerationIntent: 'not_requested',
    sourceTurns: [],
  };
}

function candidate(params: {
  revision: number;
  durationMinutes: number;
  sequence: number;
}): WeeklyDraftCandidate {
  return {
    stableKey: `stable-v5:${params.revision}:task-math:${params.sequence}`,
    date: '2026-08-11',
    startTime: params.sequence === 0 ? '10:00' : '11:10',
    endTime: params.sequence === 0 ? '11:00' : '12:10',
    durationMinutes: params.durationMinutes,
    title: `数学 ${params.durationMinutes}分`,
    field: '数学',
    year: 0,
    estimatedMinutes: params.durationMinutes,
    source: 'weekly_exam_prep',
    approvalStatus: 'unapproved',
    workItemKey: 'work-item-math',
    stableV5Metadata: {
      runtime: 'stable_v5',
      conversationId: CONVERSATION_ID,
      graphRevision: params.revision,
      taskId: 'task-math',
      sourceFactRefs: ['task-math', `workload-math-r${params.revision}`],
      planType: 'study',
    },
  } as WeeklyDraftCandidate;
}

function publishGraphRevision(revision: number): void {
  hydrateWeeklyPlanningStableV5RuntimeSession({
    ownerId: USER_ID,
    weekStartDate: WEEK_START_DATE,
    conversationId: CONVERSATION_ID,
    graph: {
      ...createEmptyWeeklyPlanningFactGraphV5(),
      revision,
    },
  });
}

function pendingTurn(state: PlanningState, turn: number): WeeklyPlanningPendingTurn {
  return {
    conversationId: CONVERSATION_ID,
    turnId: `turn-${turn}`,
    requestId: `request-${turn}`,
    weekStartDate: WEEK_START_DATE,
    baseRevision: state.revision,
    startedAt: `2026-08-10T00:0${turn}:00.000Z`,
  };
}

function applyTurn(params: {
  state: PlanningState;
  turn: number;
  draftCandidates?: WeeklyDraftCandidate[];
  assistantText: string;
}): PlanningState {
  const pending = pendingTurn(params.state, params.turn);
  const begin: WeeklyPlanningAction = {
    type: 'begin_turn',
    pending,
    requestSequence: params.turn,
    userMessage: {
      id: `user-${params.turn}`,
      role: 'user',
      content: params.turn === 1
        ? '数学は3時間ではなく1時間にしてください'
        : '修正後の条件で予定を作って',
      createdAt: pending.startedAt,
    },
  };
  const begun = weeklyPlanningReducer(params.state, begin);
  expect(begun.pendingTurn).toEqual(pending);

  return weeklyPlanningReducer(begun, {
    type: 'commit_turn',
    pending,
    intakeState: intakeState(),
    assistantMessage: {
      id: `assistant-${params.turn}`,
      role: 'assistant',
      content: params.assistantText,
      createdAt: `2026-08-10T00:0${params.turn}:30.000Z`,
    },
    draftCandidates: params.draftCandidates,
  });
}

describe('weekly planning preview correction lifecycle', () => {
  beforeEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  });

  it('clears the old preview, rejects its revision, and accepts only the recomputed preview', () => {
    publishGraphRevision(3);
    const oldCandidates = [
      candidate({ revision: 3, durationMinutes: 60, sequence: 0 }),
      candidate({ revision: 3, durationMinutes: 60, sequence: 1 }),
    ];
    let state: PlanningState = {
      ...createInitialPlanningState(WEEK_START_DATE),
      mode: 'draft_created',
      previewCandidates: oldCandidates,
      intakeState: intakeState(),
    };
    const oldBlocks = createWeeklyDraftBlocksFromPreviewCandidates({
      candidates: oldCandidates,
      userId: USER_ID,
      createdAt: '2026-08-10T00:00:00.000Z',
    });
    expect(classifyWeeklyPlanningApprovalAvailability({
      blocks: oldBlocks,
      userId: USER_ID,
    })).toMatchObject({ kind: 'eligible', reason: 'current_session' });

    publishGraphRevision(4);
    state = applyTurn({
      state,
      turn: 1,
      draftCandidates: [],
      assistantText: '数学の時間を修正しました。仮予定を作り直します。',
    });
    expect(state.previewCandidates).toEqual([]);
    expect(state.mode).toBe('collecting_tasks');
    expect(classifyWeeklyPlanningApprovalAvailability({
      blocks: oldBlocks,
      userId: USER_ID,
    })).toMatchObject({
      kind: 'recompute_required',
      reason: 'state_revision_mismatch',
    });

    publishGraphRevision(5);
    const recomputedCandidates = [
      candidate({ revision: 5, durationMinutes: 60, sequence: 0 }),
    ];
    state = applyTurn({
      state,
      turn: 2,
      draftCandidates: recomputedCandidates,
      assistantText: '修正後の条件で仮予定を作りました。',
    });
    expect(state.previewCandidates).toEqual(recomputedCandidates);
    expect(state.previewCandidates).not.toEqual(oldCandidates);
    expect(state.mode).toBe('draft_created');

    const recomputedBlocks = createWeeklyDraftBlocksFromPreviewCandidates({
      candidates: recomputedCandidates,
      userId: USER_ID,
      createdAt: '2026-08-10T00:02:00.000Z',
    });
    expect(classifyWeeklyPlanningApprovalAvailability({
      blocks: recomputedBlocks,
      userId: USER_ID,
    })).toMatchObject({ kind: 'eligible', reason: 'current_session' });
    expect(classifyWeeklyPlanningApprovalAvailability({
      blocks: oldBlocks,
      userId: USER_ID,
    })).toMatchObject({
      kind: 'recompute_required',
      reason: 'state_revision_mismatch',
    });
  });
});
