import type { WeeklyPlanDraftBlock } from '../types';
import {
  resolveWeeklyPlanningApprovalRuntime,
} from './weeklyPlanningApprovalRuntimeResolver';

export type WeeklyPlanningApprovalAvailability =
  | {
      kind: 'eligible';
      reason: 'current_session' | 'legacy_compatible';
      message?: undefined;
    }
  | {
      kind: 'recompute_required';
      reason:
        | 'session_runtime_unavailable'
        | 'conversation_mismatch'
        | 'state_revision_mismatch';
      message: string;
    }
  | {
      kind: 'blocked';
      reason:
        | 'no_draft_blocks'
        | 'user_mismatch'
        | 'mixed_metadata'
        | 'metadata_mismatch'
        | 'metadata_ineligible';
      message: string;
    };

const RECOMPUTE_MESSAGE =
  '再読み込み前の仮予定です。最新条件で作り直してください。';
const BLOCKED_MESSAGE =
  'この仮予定は現在承認できません。最新条件で作り直してください。';

export function classifyWeeklyPlanningApprovalAvailability(params: {
  blocks: readonly WeeklyPlanDraftBlock[];
  userId: string;
}): WeeklyPlanningApprovalAvailability {
  const blocks = params.blocks.filter((block) => block.status === 'draft');
  if (blocks.length === 0) {
    return {
      kind: 'blocked',
      reason: 'no_draft_blocks',
      message: '承認できる仮予定がありません。',
    };
  }

  if (blocks.some((block) => block.userId !== params.userId)) {
    return { kind: 'blocked', reason: 'user_mismatch', message: BLOCKED_MESSAGE };
  }

  const metadata = blocks.map((block) => block.behaviorMetadata?.previewMetadata);
  const metadataCount = metadata.filter(Boolean).length;
  if (metadataCount === 0) {
    return { kind: 'eligible', reason: 'legacy_compatible' };
  }
  if (metadataCount !== blocks.length) {
    return { kind: 'blocked', reason: 'mixed_metadata', message: BLOCKED_MESSAGE };
  }

  const first = metadata[0]!;
  if (
    metadata.some((item) =>
      !item
      || item.previewId !== first.previewId
      || item.stateRevision !== first.stateRevision
      || item.conversationId !== first.conversationId
      || item.authorizedUserId !== first.authorizedUserId,
    )
  ) {
    return { kind: 'blocked', reason: 'metadata_mismatch', message: BLOCKED_MESSAGE };
  }

  if (
    first.authorizedUserId !== params.userId
    || first.stale
    || first.approvalEligibility !== 'eligible'
  ) {
    return { kind: 'blocked', reason: 'metadata_ineligible', message: BLOCKED_MESSAGE };
  }

  const runtimeResolution = resolveWeeklyPlanningApprovalRuntime({
    blocks,
    userId: params.userId,
  });
  if (runtimeResolution.kind === 'mixed_runtime_sources') {
    return { kind: 'blocked', reason: 'metadata_mismatch', message: BLOCKED_MESSAGE };
  }
  if (runtimeResolution.kind === 'owner_mismatch') {
    return { kind: 'blocked', reason: 'user_mismatch', message: BLOCKED_MESSAGE };
  }
  if (runtimeResolution.stableV5 && runtimeResolution.kind === 'unbound') {
    return {
      kind: 'recompute_required',
      reason: 'session_runtime_unavailable',
      message: RECOMPUTE_MESSAGE,
    };
  }

  if (!first.conversationId) {
    return { kind: 'eligible', reason: 'legacy_compatible' };
  }

  const runtime = runtimeResolution.runtimeSnapshot;
  if (!runtime) {
    return {
      kind: 'recompute_required',
      reason: 'session_runtime_unavailable',
      message: RECOMPUTE_MESSAGE,
    };
  }
  if (runtime.conversationId !== first.conversationId) {
    return {
      kind: 'recompute_required',
      reason: 'conversation_mismatch',
      message: RECOMPUTE_MESSAGE,
    };
  }
  if (runtime.stateRevision !== first.stateRevision) {
    return {
      kind: 'recompute_required',
      reason: 'state_revision_mismatch',
      message: RECOMPUTE_MESSAGE,
    };
  }

  return { kind: 'eligible', reason: 'current_session' };
}
