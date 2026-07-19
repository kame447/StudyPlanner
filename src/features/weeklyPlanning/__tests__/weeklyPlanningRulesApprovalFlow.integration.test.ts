import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlanFromDraft } from '../../../domain/planner';
import type { Plan, PlanDraft } from '../../../types/domain';
import { approveWeeklyPlanningDraftBlocks } from '../application/weeklyPlanningApprovalApplication';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import { clearWeeklyPlanningSessionRuntime } from '../planning/weeklyPlanningSessionRuntime';
import {
  createWeeklyDraftBlocksFromPreviewCandidates,
  createWeeklyPlanningPreviewBlocks,
  createWeeklyPlanningPreviewDisplayBlock,
} from '../preview/weeklyPlanningPreviewBlocks';
import type { WeeklyDraftApprovalOperation } from '../planning/weeklyPlanningApprovalTypes';
import type { PlanningState, WeeklyPlanningAction } from '../types';
import { createInitialPlanningState, weeklyPlanningReducer } from '../weeklyPlanningReducer';

vi.mock('../../../lib/aiConfig', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/aiConfig')>(
    '../../../lib/aiConfig',
  );
  return {
    ...actual,
    getAiConfig: () => ({
      provider: 'rules' as const,
      baseUrl: '',
      model: '',
      apiKey: '',
    }),
    getAiConfigValidationMessage: () => undefined,
  };
});

import { executeWeeklyPlanningTurn } from '../weeklyPlanningTurnExecutor';

function completeExamIntakeState(): PlanningIntakeState {
  return {
    status: 'draft_ready',
    intent: 'exam_prep_planning',
    range: {
      startDateTime: '2026-07-20T09:00:00',
      endDateTime: '2026-07-26T22:00:00',
      sourceText: '7月20日から7月26日まで',
      calendarDayCount: 7,
      confidence: 'explicit',
    },
    examPrepScope: {
      examType: '院試',
      fields: ['OS'],
      totalFields: 1,
      totalYears: 1,
      yearRange: {
        startYear: 2025,
        endYear: 2025,
        sourceText: '2025年度',
      },
      strategyHint: 'field_first',
      unitModel: 'year_field_chunk',
      unitCountHint: 1,
      rawText: ['院試のOSの2025年度過去問'],
    },
    tasks: [
      {
        title: '院試のOS過去問',
        subject: 'OS',
        examType: '院試',
        field: 'OS',
        year: 2025,
        unit: 'year_field_chunk',
        amount: 1,
        rawText: '院試のOSの2025年度過去問を1年分進める',
        requiresTimeEstimate: true,
        source: 'command',
      },
    ],
    progress: [
      {
        field: 'OS',
        completedYears: [],
        completionTarget: {
          kind: 'all',
          rawText: '全部終わらせる',
        },
        incomplete: ['2025年度'],
        ambiguity: 'none',
        rawText: '未着手で2025年度を終わらせる',
      },
    ],
    unitRates: [
      {
        unit: 'year_field_chunk',
        minutesPerUnit: 120,
        source: 'user',
        uncertainty: 'low',
        rawText: '1年分2時間',
      },
    ],
    constraints: [
      {
        kind: 'sleep',
        start: '23:00',
        end: '07:00',
        hardness: 'hard',
        rawText: '23時から7時まで睡眠',
      },
      {
        kind: 'meal',
        durationMinutes: 60,
        hardness: 'soft',
        rawText: '夕食は1時間',
      },
      {
        kind: 'bath',
        durationMinutes: 30,
        hardness: 'soft',
        rawText: '風呂は30分',
      },
    ],
    fixedEventsDeclaredNone: true,
    priorityPolicy: {
      kind: 'field_first',
      order: ['OS'],
    },
    priorityPolicySource: 'user',
    missing: [],
    assumptions: [],
    uncertainties: [],
    questions: [],
    shouldCreateDraft: false,
    shouldSavePlan: false,
    draftGenerationIntent: 'not_requested',
    sourceTurns: [
      '7月20日から7月26日まで、院試のOSの2025年度過去問を進めたい。1年分2時間。固定予定はなく、23時から7時まで寝る。',
    ],
  };
}

function persistedPlan(draft: PlanDraft, index: number): Plan {
  return {
    ...createPlanFromDraft(draft),
    id: `persisted-weekly-plan-${index}`,
  };
}

afterEach(() => {
  clearWeeklyPlanningSessionRuntime();
  vi.restoreAllMocks();
});

describe('weekly planning rules input-to-approval integration', () => {
  it('runs creation input through preview promotion, approval, persistence, and completion', async () => {
    const execution = await executeWeeklyPlanningTurn({
      previousState: completeExamIntakeState(),
      messages: [],
      userText: 'この条件で仮予定を作成してください',
      selectedDate: '2026-07-20',
      userId: 'integration-user',
      plans: [],
      scheduleTemplates: [],
      conversationId: 'rules-approval-integration-conversation',
      traceRequestId: 'rules-approval-integration-request',
      weekStartsOn: 'monday',
    });

    expect(execution.state.missing).toEqual([]);
    expect(execution.draftCandidates.length).toBeGreaterThan(0);
    expect(execution.message).not.toContain('教えてください');

    const previewBlocks = createWeeklyPlanningPreviewBlocks(execution.draftCandidates);
    expect(previewBlocks).toHaveLength(execution.draftCandidates.length);
    expect(previewBlocks[0]).toEqual(expect.objectContaining({
      id: execution.draftCandidates[0]?.stableKey,
      status: 'preview',
      isSaved: false,
      source: 'weekly_exam_prep',
    }));

    const displayBlock = createWeeklyPlanningPreviewDisplayBlock(
      previewBlocks[0]!,
      'integration-user',
    );
    expect(displayBlock).toEqual(expect.objectContaining({
      id: execution.draftCandidates[0]?.stableKey,
      status: 'draft',
      userId: 'integration-user',
    }));
    expect(displayBlock.memo).toContain('unsaved-preview');

    const promotedBlocks = createWeeklyDraftBlocksFromPreviewCandidates({
      candidates: execution.draftCandidates,
      userId: 'integration-user',
      createdAt: '2026-07-19T02:00:00.000Z',
    });
    expect(promotedBlocks).toHaveLength(execution.draftCandidates.length);
    expect(promotedBlocks.every((block) => block.status === 'draft')).toBe(true);

    let planningState: PlanningState = {
      ...createInitialPlanningState('2026-07-20'),
      mode: 'draft_created',
      intakeState: execution.state,
      previewCandidates: execution.draftCandidates,
    };
    const dispatch = (action: WeeklyPlanningAction): PlanningState => {
      planningState = weeklyPlanningReducer(planningState, action);
      return planningState;
    };
    dispatch({ type: 'add_draft_blocks', blocks: promotedBlocks });

    expect(planningState.previewCandidates).toEqual([]);
    expect(planningState.draftBlocks).toHaveLength(promotedBlocks.length);
    expect(planningState.mode).toBe('awaiting_approval');

    let selectedDate = '2026-07-20';
    const savedDrafts: PlanDraft[] = [];
    const completedOperations: WeeklyDraftApprovalOperation[] = [];
    const ledgerOperations: WeeklyDraftApprovalOperation[] = [];

    await approveWeeklyPlanningDraftBlocks({
      userId: 'integration-user',
      plans: [],
      approvalOperations: ledgerOperations,
      async saveWeeklyApprovedPlan(draft) {
        savedDrafts.push(draft);
        selectedDate = draft.date;
        return persistedPlan(draft, savedDrafts.length);
      },
      async completeWeeklyApprovalOperation(operation) {
        completedOperations.push(operation);
      },
      getState: () => planningState,
      dispatch,
      onOperationCompleted(operation) {
        ledgerOperations.push(operation);
      },
    });

    expect(savedDrafts).toHaveLength(promotedBlocks.length);
    expect(savedDrafts.every((draft) => draft.sourceType === 'weekly_planning')).toBe(true);
    expect(savedDrafts.every((draft) => draft.sourceId?.includes(':draft:'))).toBe(true);
    expect(savedDrafts.every((draft) => draft.memo.includes('[weekly-source:'))).toBe(true);
    expect(savedDrafts.every((draft) => draft.memo.includes('[weekly-approval:'))).toBe(true);
    expect(completedOperations).toHaveLength(1);
    expect(completedOperations[0]?.status).toBe('completed');
    expect(selectedDate).toBe(savedDrafts.at(-1)?.date);
    expect(planningState.pendingApproval).toBeUndefined();
    expect(planningState.draftBlocks).toEqual([]);
    expect(planningState.mode).toBe('idle');
    expect(planningState.lastAssistantMessage).toBe(
      `${promotedBlocks.length}件の仮予定を通常予定として保存しました。`,
    );
  });
});
