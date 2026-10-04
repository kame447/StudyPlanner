import type { WeeklyPlanDraftBlock, WeeklyPlanningApprovalRecovery } from '../types';
import { createWeeklyDraftApprovalOperation, deriveApprovalOperationStatus, isWeeklyDraftApprovalOperation } from './weeklyPlanningApproval';

/** A local recovery receipt is evidence of the original batch, never permission to save. */
export function isWeeklyPlanningApprovalRecovery(
  value: unknown,
  remaining: readonly WeeklyPlanDraftBlock[],
  weekStartDate: string,
  isBlock: (value: unknown) => boolean,
): value is WeeklyPlanningApprovalRecovery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const receipt = value as WeeklyPlanningApprovalRecovery;
  if (receipt.version !== 1 || receipt.weekStartDate !== weekStartDate
    || !Array.isArray(receipt.blocks) || receipt.blocks.length === 0
    || !receipt.blocks.every(isBlock)) return false;
  const operation = receipt.operation;
  // Ledger convenience limits must not narrow already accepted draft/Plan identities.
  // Session byte/count budgets and the atomic repository retain their own bounds.
  if (!isWeeklyDraftApprovalOperation(operation, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER) || (operation.conversationId !== undefined
    && (typeof operation.conversationId !== 'string' || !operation.conversationId.trim()))) return false;
  if (operation.status !== deriveApprovalOperationStatus(operation.items)) return false;
  const ids = receipt.blocks.map((block) => block.id);
  if (new Set(ids).size !== ids.length || ids.length > operation.items.length
    || receipt.blocks.some((block) => block.status !== 'draft' || block.userId !== operation.userId)
    || operation.items.some((item) => !ids.includes(item.sourceDraftBlockId)
      && item.status !== 'saved' && item.status !== 'skipped_duplicate')
    || ids.some((id) => !operation.items.some((item) => item.sourceDraftBlockId === id))) return false;
  const identity = createWeeklyDraftApprovalOperation({ userId: operation.userId,
    metadata: { previewId: operation.previewId, stateRevision: operation.previewStateRevision,
      authorizedUserId: operation.userId, assumptionDependencies: [], approvalEligibility: 'eligible', stale: false },
    blocks: operation.items.map((item) => ({ id: item.sourceDraftBlockId })), now: operation.startedAt });
  if (identity.approvalOperationId !== operation.approvalOperationId) return false;
  const unresolved = operation.items.filter((item) => item.status !== 'saved' && item.status !== 'skipped_duplicate');
  if (remaining.length === 0 || new Set(remaining.map((block) => block.id)).size !== remaining.length) return false;
  if (operation.status !== 'completed' && unresolved.length !== remaining.length) return false;
  if (unresolved.some((item) => !remaining.some((block) => block.id === item.sourceDraftBlockId))) return false;
  if (operation.items.some((item) => (item.status === 'saved' || item.status === 'skipped_duplicate') && !item.savedPlanId)) return false;
  return remaining.every((current) => {
    const original = receipt.blocks.find((block) => block.id === current.id);
    return current && JSON.stringify(current) === JSON.stringify(original);
  });
}

/** Store each frozen block once; runtime callers continue to receive ordinary draft blocks. */
export function compactWeeklyPlanningApprovalRecovery(state: import('../types').PlanningState): unknown {
  if (!state.approvalRecovery) return state;
  if (!isWeeklyPlanningApprovalRecovery(state.approvalRecovery, state.draftBlocks, state.weekStartDate,
    (block) => Boolean(block && typeof block === 'object' && 'id' in block))) {
    throw new Error('invalid-approval-recovery');
  }
  return {
    ...state,
    draftBlocks: state.draftBlocks.map((block) => ({ recoveryBlockId: block.id })),
    approvalRecovery: { ...state.approvalRecovery, blockEncoding: 'references-v1' },
  };
}

export function expandWeeklyPlanningApprovalRecovery(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const state = value as Record<string, unknown>;
  const recovery = state.approvalRecovery;
  if (!recovery || typeof recovery !== 'object' || Array.isArray(recovery)) return value;
  const { blockEncoding, ...receipt } = recovery as Record<string, unknown>;
  if (blockEncoding === undefined) return value;
  if (blockEncoding !== 'references-v1' || !Array.isArray(receipt.blocks) || !Array.isArray(state.draftBlocks)) return null;
  const originals = new Map<string, unknown>();
  for (const block of receipt.blocks) {
    if (!block || typeof block !== 'object' || typeof block.id !== 'string' || originals.has(block.id)) return null;
    originals.set(block.id, block);
  }
  const referenceIds = new Set<string>();
  for (const reference of state.draftBlocks) {
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)
      || Object.keys(reference).length !== 1 || typeof reference.recoveryBlockId !== 'string'
      || !originals.has(reference.recoveryBlockId) || referenceIds.has(reference.recoveryBlockId)) return null;
    referenceIds.add(reference.recoveryBlockId);
  }
  const blocks = [...referenceIds].map((id) => structuredClone(originals.get(id)));
  return { ...state, draftBlocks: blocks, approvalRecovery: receipt };
}
