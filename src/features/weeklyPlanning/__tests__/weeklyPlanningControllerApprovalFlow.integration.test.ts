import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlanFromDraft } from '../../../domain/planner';
import type { Plan, PlanDraft } from '../../../types/domain';
import { approveWeeklyPlanningDraftBlocks } from '../application/weeklyPlanningApprovalApplication';
import type { PlanningIntakeMissing } from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyDraftApprovalOperation } from '../planning/weeklyPlanningApprovalTypes';
import { parseWeeklyPlanningPlanSourceId } from '../planning/weeklyPlanningPlanProvenance';
import { clearWeeklyPlanningSessionRuntime } from '../planning/weeklyPlanningSessionRuntime';
import { createWeeklyDraftBlocksFromPreviewCandidates } from '../preview/weeklyPlanningPreviewBlocks';
import type { PlanningState, WeeklyPlanningAction } from '../types';
import {
  createWeeklyPlanningControllerSession,
  submitWeeklyPlanningControlledTurn,
} from '../weeklyPlanningTurnController';
import { createInitialPlanningState, weeklyPlanningReducer } from '../weeklyPlanningReducer';

import { executeLegacyWeeklyPlanningTurnForTests } from '../weeklyPlanningLegacyTurnExecutor.testSupport';

const USER_ID = 'controller-approval-integration-user';
const SELECTED_DATE = '2026-07-19';
const WEEK_START_DATE = '2026-07-13';
const CONVERSATION_ID = 'weekly-conversation-123e4567-e89b-12d3-a456-426614174000';

const ANSWERS: Partial<Record<PlanningIntakeMissing | string, string>> = {
  planning_period: '今日の勉強計画を立ててください',
  planning_start_date: '7月19日からです',
  planning_duration: '1日です',
  tasks_or_goals: '院試の過去問はOSを進めたいです',
  year_range: '対象年度は2025〜2025です',
  progress: 'OSは未着手で、2025年度を全部終わらせたいです',
  completion_direction: '2025年度まで全部終わらせたいです',
  unit_duration_estimate: '2時間です',
  unit_rate: '2時間です',
  priority_policy: 'OSを優先します',
  fixed_events: '固定予定はありません',
  sleep_cycle: '睡眠時間は23時から7時です',
  meal_bath_constraints: '食事時間は60分、風呂は30分です',
  life_constraints: '固定予定はありません。睡眠時間は23時から7時です。食事時間は60分、風呂は30分です',
  next_field_after_math: '次の分野はありません',
};

function persistedPlan(draft: PlanDraft, index: number): Plan {
  return { ...createPlanFromDraft(draft), id: `controller-persisted-plan-${index}` };
}

afterEach(() => {
  clearWeeklyPlanningSessionRuntime();
  vi.restoreAllMocks();
});

describe('weekly planning controller input-to-approval integration', () => {
  it('runs natural-language turns through controller ownership, preview, approval, persistence, and completion', async () => {
    let planningState: PlanningState = createInitialPlanningState(WEEK_START_DATE);
    const dispatch = (action: WeeklyPlanningAction): PlanningState => {
      planningState = weeklyPlanningReducer(planningState, action);
      return planningState;
    };
    const session = createWeeklyPlanningControllerSession(
      USER_ID,
      WEEK_START_DATE,
      CONVERSATION_ID,
    );
    let timestampSequence = 0;

    const submit = async (userText: string) => {
      const revisionBefore = planningState.revision;
      const result = await submitWeeklyPlanningControlledTurn({
        session,
        ownerId: USER_ID,
        userText,
        getState: () => planningState,
        dispatch,
        now: () => `2026-07-19T03:${String(timestampSequence++).padStart(2, '0')}:00.000Z`,
        execute: async ({ snapshot, pending, userText: currentUserText }) =>
          executeLegacyWeeklyPlanningTurnForTests({
            previousState: snapshot.intakeState,
            messages: snapshot.messages,
            userText: currentUserText,
            selectedDate: SELECTED_DATE,
            userId: USER_ID,
            plans: [],
            scheduleTemplates: [],
            conversationId: pending.conversationId,
            traceRequestId: pending.requestId,
            weekStartsOn: 'monday',
          }),
      });
      expect(result.accepted).toBe(true);
      expect(planningState.pendingTurn).toBeUndefined();
      expect(planningState.revision).toBe(revisionBefore + 2);
      return result;
    };

    await submit('今日の勉強計画を立ててください');
    await submit('院試の過去問はOSを進めたいです');

    const seenStates = new Set<string>();
    for (let step = 0; step < 20; step += 1) {
      const intake = planningState.intakeState;
      if (!intake || intake.missing.length === 0) break;
      const target = intake.lastQuestionContext?.targetSlot ?? intake.missing[0];
      const answer = ANSWERS[target] ?? ANSWERS[intake.missing[0]];
      if (!answer) {
        throw new Error(`No integration answer for ${target}; missing=${intake.missing.join(',')}`);
      }
      const signature = JSON.stringify({
        target,
        missing: intake.missing,
        status: intake.status,
        message: planningState.lastAssistantMessage,
      });
      if (seenStates.has(signature)) {
        throw new Error(`Integration dialogue made no progress for ${target}: ${answer}`);
      }
      seenStates.add(signature);
      await submit(answer);
    }

    expect(planningState.intakeState?.missing).toEqual([]);
    expect(planningState.messages.filter((message) => message.role === 'user').length)
      .toBeGreaterThan(2);
    expect(planningState.messages.filter((message) => message.role === 'assistant').length)
      .toBe(planningState.messages.filter((message) => message.role === 'user').length);

    const creation = await submit('仮で予定を組んでみよう');
    if (creation.draftCandidates.length === 0) {
      throw new Error(`Preview was not created: ${JSON.stringify({
        message: planningState.lastAssistantMessage,
        intakeState: planningState.intakeState,
      })}`);
    }
    expect(planningState.previewCandidates).toEqual(creation.draftCandidates);
    expect(planningState.intakeState?.shouldSavePlan).toBe(false);

    const candidatesBeforePromotion = [...creation.draftCandidates];
    const promotedBlocks = createWeeklyDraftBlocksFromPreviewCandidates({
      candidates: candidatesBeforePromotion,
      userId: USER_ID,
      createdAt: '2026-07-19T04:00:00.000Z',
    });
    expect(promotedBlocks).toHaveLength(candidatesBeforePromotion.length);
    promotedBlocks.forEach((block, index) => {
      const candidate = candidatesBeforePromotion[index];
      expect(block).toEqual(expect.objectContaining({
        userId: USER_ID,
        date: candidate?.date,
        startTime: candidate?.startTime,
        endTime: candidate?.endTime,
        title: candidate?.title,
        status: 'draft',
        source: 'ai',
      }));
    });

    dispatch({ type: 'add_draft_blocks', blocks: promotedBlocks });
    expect(planningState.previewCandidates).toEqual([]);
    expect(planningState.draftBlocks).toHaveLength(promotedBlocks.length);

    const savedDrafts: PlanDraft[] = [];
    const completedOperations: WeeklyDraftApprovalOperation[] = [];
    const ledgerOperations: WeeklyDraftApprovalOperation[] = [];
    await approveWeeklyPlanningDraftBlocks({
      userId: USER_ID,
      plans: [],
      approvalOperations: ledgerOperations,
      async saveWeeklyApprovedPlan(draft) {
        savedDrafts.push(draft);
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
    savedDrafts.forEach((draft, index) => {
      expect(draft).toEqual(expect.objectContaining({
        userId: USER_ID,
        sourceType: 'weekly-planning',
      }));
      expect(parseWeeklyPlanningPlanSourceId(draft.sourceId)).toEqual({
        approvalOperationId: completedOperations[0]?.approvalOperationId,
        sourceDraftBlockId: promotedBlocks[index]?.id,
      });
    });
    expect(completedOperations).toHaveLength(1);
    expect(completedOperations[0]?.status).toBe('completed');
    expect(planningState.weekStartDate).toBe(WEEK_START_DATE);
    expect(planningState.pendingApproval).toBeUndefined();
    expect(planningState.draftBlocks).toEqual([]);
    expect(planningState.mode).toBe('idle');
    expect(planningState.lastAssistantMessage).toBe(
      `${promotedBlocks.length}件の仮予定を通常予定として保存しました。`,
    );
  });
});
