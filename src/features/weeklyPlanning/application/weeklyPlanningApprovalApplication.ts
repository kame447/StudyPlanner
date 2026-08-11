import type { Plan, PlanDraft } from '../../../types/domain';
import {
  createWeeklyDraftApprovalOperation,
  validateWeeklyPreviewApproval,
} from '../planning/weeklyPlanningApproval';
import { executeInterruptibleWeeklyDraftApproval } from '../planning/weeklyPlanningInterruptibleApproval';
import {
  buildWeeklyPlanningPlanSourceId,
  WEEKLY_PLANNING_PLAN_SOURCE_TYPE,
} from '../planning/weeklyPlanningPlanProvenance';
import type { WeeklyDraftApprovalOperation } from '../planning/weeklyPlanningApprovalTypes';
import type {
  PlanningState,
  WeeklyPlanningAction,
  WeeklyPlanningPendingApproval,
} from '../types';
import { createPlanDraftFromWeeklyDraftBlock } from '../weeklyPlanningTransforms';
import type { WeeklyPlanningEstimateMetadataV1 } from '../personalization/weeklyPlanningEstimateCalibration';
import {
  createWeeklyPlanningApplicationMessage,
  createWeeklyPlanningApplicationRequestId,
} from './weeklyPlanningApplicationIdentity';

interface WeeklyPlanningApprovalApplicationInput {
  userId: string | null | undefined;
  plans: Plan[];
  approvalOperations: readonly WeeklyDraftApprovalOperation[];
  saveWeeklyApprovedPlan: (draft: PlanDraft) => Promise<Plan>;
  completeWeeklyApprovalOperation?: (operation: WeeklyDraftApprovalOperation) => Promise<void>;
  getState: () => PlanningState;
  dispatch: (action: WeeklyPlanningAction) => PlanningState;
  onOperationCompleted: (operation: WeeklyDraftApprovalOperation) => void;
}

type PlanDraftWithEstimateMetadata = PlanDraft & {
  weeklyPlanningEstimate?: WeeklyPlanningEstimateMetadataV1;
};

function approvalErrorMessage(kind: string, reason?: string): string {
  if (reason === 'session-runtime-unavailable') {
    return '現在の条件と一致しない仮予定です。最新条件で再計算してください。';
  }
  switch (kind) {
    case 'stale_preview_approval_attempt':
      return '現在の条件と一致しない仮予定です。最新条件で再計算してください。';
    case 'pending_assumption_preview_approval_attempt':
      return '未確認の仮定があります。仮定を確認してから最新案を再計算してください。';
    default:
      return 'この仮予定は保存できません。最新案を作り直してください。';
  }
}

function ownsPendingApproval(
  state: PlanningState,
  pending: WeeklyPlanningPendingApproval,
): boolean {
  const current = state.pendingApproval;
  return Boolean(
    current
      && current.requestId === pending.requestId
      && current.weekStartDate === pending.weekStartDate
      && current.baseRevision === pending.baseRevision
      && current.blockIds.length === pending.blockIds.length
      && current.blockIds.every((blockId, index) => blockId === pending.blockIds[index]),
  );
}

function cloneEstimateMetadata(
  metadata: WeeklyPlanningEstimateMetadataV1 | undefined,
): WeeklyPlanningEstimateMetadataV1 | undefined {
  if (!metadata) return undefined;
  return {
    ...metadata,
    sourceFactRefs: [...metadata.sourceFactRefs],
  };
}

export async function approveWeeklyPlanningDraftBlocks({
  userId,
  plans,
  approvalOperations,
  saveWeeklyApprovedPlan,
  completeWeeklyApprovalOperation,
  getState,
  dispatch,
  onOperationCompleted,
}: WeeklyPlanningApprovalApplicationInput): Promise<void> {
  const authenticatedUserId = userId?.trim();
  if (!authenticatedUserId) return;

  const snapshot = getState();
  const blocks = snapshot.draftBlocks.filter((block) => block.status === 'draft');
  if (blocks.length === 0 || snapshot.pendingTurn || snapshot.pendingApproval) return;

  const pending: WeeklyPlanningPendingApproval = {
    requestId: createWeeklyPlanningApplicationRequestId('weekly-approval'),
    weekStartDate: snapshot.weekStartDate,
    baseRevision: snapshot.revision,
    blockIds: blocks.map((block) => block.id),
    startedAt: new Date().toISOString(),
  };
  const begun = dispatch({ type: 'begin_approval', pending });
  if (!ownsPendingApproval(begun, pending)) return;

  try {
    const guard = validateWeeklyPreviewApproval({
      blocks,
      currentStateRevision: snapshot.intakeState?.sourceTurns.length ?? 0,
      userId: authenticatedUserId,
      proposalRecords: snapshot.intakeState?.assumptionProposalRecords ?? [],
    });
    if (!guard.allowed) {
      const reason = 'reason' in guard.attempt ? guard.attempt.reason : undefined;
      throw new Error(approvalErrorMessage(guard.attempt.kind, reason));
    }

    const existingOperation = approvalOperations.find((operation) =>
      operation.userId === authenticatedUserId
      && operation.previewId === guard.metadata.previewId
      && operation.previewStateRevision === guard.metadata.stateRevision,
    );
    const operation = existingOperation ?? createWeeklyDraftApprovalOperation({
      userId: authenticatedUserId,
      metadata: guard.metadata,
      blocks,
      now: new Date().toISOString(),
    });
    const result = await executeInterruptibleWeeklyDraftApproval({
      operation,
      blocks,
      shouldContinue: () => ownsPendingApproval(getState(), pending),
      dependencies: {
        async findExistingPlanId({ sourceDraftBlockId }) {
          const legacyMarker = `[weekly-source:${sourceDraftBlockId}]`;
          return plans.find((plan) =>
            plan.userId === authenticatedUserId
            && plan.sourceType !== WEEKLY_PLANNING_PLAN_SOURCE_TYPE
            && plan.memo.includes(legacyMarker),
          )?.id;
        },
        async saveBlock({ block, source }) {
          const draft = createPlanDraftFromWeeklyDraftBlock(
            block,
            authenticatedUserId,
          ) as PlanDraftWithEstimateMetadata;
          const estimateMetadata = cloneEstimateMetadata(
            block.behaviorMetadata?.estimateMetadata,
          );
          if (estimateMetadata) {
            draft.weeklyPlanningEstimate = estimateMetadata;
          }
          const sourceId = buildWeeklyPlanningPlanSourceId({
            approvalOperationId: source.approvalOperationId,
            sourceDraftBlockId: source.sourceDraftBlockId,
          });
          const sourceMarker = `[weekly-source:${source.sourceDraftBlockId}]`;
          const operationMarker = `[weekly-approval:${source.approvalOperationId}]`;
          const savedPlan = await saveWeeklyApprovedPlan({
            ...draft,
            sourceType: WEEKLY_PLANNING_PLAN_SOURCE_TYPE,
            sourceId,
            memo: [draft.memo, sourceMarker, operationMarker].filter(Boolean).join(' / '),
          });
          return { planId: savedPlan.id };
        },
        now: () => new Date().toISOString(),
      },
    });
    onOperationCompleted(result);
    if (result.status === 'completed' && completeWeeklyApprovalOperation) {
      await completeWeeklyApprovalOperation(result);
    }

    if (!ownsPendingApproval(getState(), pending)) return;

    const completedBlockIds = result.items
      .filter((item) => item.status === 'saved' || item.status === 'skipped_duplicate')
      .map((item) => item.sourceDraftBlockId);
    const failed = result.status === 'failed' || result.status === 'partially_saved';
    const message = failed
      ? '一部の仮予定を保存できませんでした。未保存分だけ再試行できます。'
      : `${completedBlockIds.length}件の仮予定を通常予定として保存しました。`;
    dispatch({
      type: 'complete_approval',
      pending,
      completedBlockIds,
      assistantMessage: createWeeklyPlanningApplicationMessage('assistant', message),
    });
    if (failed) throw new Error(message);
  } catch (error) {
    const current = getState();
    if (ownsPendingApproval(current, pending)) {
      dispatch({ type: 'fail_approval', pending });
    }
    throw error;
  }
}
