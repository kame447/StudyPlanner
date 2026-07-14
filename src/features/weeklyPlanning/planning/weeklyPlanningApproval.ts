import type { AssumptionProposalRecord } from '../intake/weeklyPlanningAssumptionProposals';
import type { WeeklyPlanDraftBlock } from '../types';
import type {
  ApprovedPlanSource,
  InvalidPreviewApprovalAttempt,
  PendingAssumptionPreviewApprovalAttempt,
  StalePreviewApprovalAttempt,
  WeeklyDraftApprovalItem,
  WeeklyDraftApprovalOperation,
  WeeklyDraftApprovalOperationStatus,
  WeeklyPreviewMetadata,
} from './weeklyPlanningApprovalTypes';

export const WEEKLY_APPROVAL_LEDGER_VERSION = 1;
export const WEEKLY_APPROVAL_LEDGER_MAX_ITEMS = 200;

export type WeeklyPreviewApprovalGuardResult =
  | { allowed: true; metadata: WeeklyPreviewMetadata }
  | { allowed: false; attempt: StalePreviewApprovalAttempt }
  | { allowed: false; attempt: PendingAssumptionPreviewApprovalAttempt }
  | { allowed: false; attempt: InvalidPreviewApprovalAttempt };

export interface WeeklyApprovalLedgerEnvelope {
  version: typeof WEEKLY_APPROVAL_LEDGER_VERSION;
  operations: WeeklyDraftApprovalOperation[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function errorCode(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim().slice(0, 200);
  return 'save-failed';
}

function cloneItem(item: WeeklyDraftApprovalItem): WeeklyDraftApprovalItem {
  return { ...item };
}

function cloneOperation(operation: WeeklyDraftApprovalOperation): WeeklyDraftApprovalOperation {
  return { ...operation, items: operation.items.map(cloneItem) };
}

function legacyPreviewId(blocks: readonly WeeklyPlanDraftBlock[]): string {
  let hash = 2166136261;
  const source = blocks.map((block) => block.id).sort().join('\u001f');
  for (const character of source) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `legacy-weekly-preview:${(hash >>> 0).toString(16)}`;
}

function metadataFromBlocks(params: {
  blocks: readonly WeeklyPlanDraftBlock[];
  currentStateRevision: number;
  userId: string;
}): WeeklyPreviewMetadata | null {
  if (params.blocks.length === 0) return null;
  const first = params.blocks[0].behaviorMetadata?.previewMetadata;
  const metadataCount = params.blocks.filter((block) => Boolean(block.behaviorMetadata?.previewMetadata)).length;
  if (!first) {
    if (metadataCount > 0 || params.blocks.some((block) => block.status !== 'draft')) return null;
    return {
      previewId: legacyPreviewId(params.blocks),
      stateRevision: params.currentStateRevision,
      assumptionDependencies: [],
      approvalEligibility: 'eligible',
      stale: false,
      authorizedUserId: params.userId,
    };
  }
  const samePreview = params.blocks.every((block) => {
    const metadata = block.behaviorMetadata?.previewMetadata;
    return metadata?.previewId === first.previewId
      && metadata.stateRevision === first.stateRevision
      && metadata.authorizedUserId === first.authorizedUserId;
  });
  return samePreview
    ? {
        ...first,
        assumptionDependencies: first.assumptionDependencies.map((dependency) => ({ ...dependency })),
      }
    : null;
}

function isAcceptedPreviewCompatibilityRecord(
  record: AssumptionProposalRecord,
  metadata: WeeklyPreviewMetadata,
): boolean {
  return metadata.approvalEligibility === 'eligible'
    && record.status === 'pending'
    && record.createdAtTurnId === 'preview-dependency';
}

export function validateWeeklyPreviewApproval(params: {
  blocks: readonly WeeklyPlanDraftBlock[];
  currentStateRevision: number;
  userId: string;
  proposalRecords: readonly AssumptionProposalRecord[];
}): WeeklyPreviewApprovalGuardResult {
  const metadata = metadataFromBlocks(params);
  if (!metadata) {
    return { allowed: false, attempt: { kind: 'invalid_preview_approval_attempt', reason: 'missing-or-mixed-preview-metadata' } };
  }
  if (metadata.authorizedUserId !== params.userId
    || params.blocks.some((block) => block.userId !== params.userId)
    || metadata.approvalEligibility === 'blocked_invalid'
    || metadata.approvalEligibility === 'unsupported') {
    return {
      allowed: false,
      attempt: { kind: 'invalid_preview_approval_attempt', previewId: metadata.previewId, reason: 'unauthorized-or-invalid-preview' },
    };
  }
  if (metadata.stale
    || metadata.approvalEligibility === 'blocked_stale'
    || metadata.stateRevision !== params.currentStateRevision) {
    return {
      allowed: false,
      attempt: {
        kind: 'stale_preview_approval_attempt',
        previewId: metadata.previewId,
        previewStateRevision: metadata.stateRevision,
        currentStateRevision: params.currentStateRevision,
        previewStale: true,
      },
    };
  }

  const pendingProposalIds: string[] = [];
  for (const dependency of metadata.assumptionDependencies) {
    const record = params.proposalRecords.find((candidate) => candidate.proposalId === dependency.proposalId);
    if (!record
      || record.targetRef !== dependency.targetRef
      || record.createdFromStateRevision !== dependency.proposalCreatedFromStateRevision
      || record.conversationId.trim().length === 0) {
      return {
        allowed: false,
        attempt: { kind: 'invalid_preview_approval_attempt', previewId: metadata.previewId, reason: 'invalid-assumption-dependency' },
      };
    }
    if (record.status === 'pending' && !isAcceptedPreviewCompatibilityRecord(record, metadata)) {
      pendingProposalIds.push(record.proposalId);
    }
    if (record.status === 'rejected' || record.status === 'expired' || record.status === 'superseded') {
      return {
        allowed: false,
        attempt: { kind: 'invalid_preview_approval_attempt', previewId: metadata.previewId, reason: 'resolved-assumption-dependency-requires-recompute' },
      };
    }
  }

  if (pendingProposalIds.length > 0 || metadata.approvalEligibility === 'blocked_pending_assumption') {
    return {
      allowed: false,
      attempt: {
        kind: 'pending_assumption_preview_approval_attempt',
        previewId: metadata.previewId,
        previewStateRevision: metadata.stateRevision,
        pendingProposalIds: Array.from(new Set(pendingProposalIds)).sort(),
      },
    };
  }
  if (metadata.approvalEligibility !== 'eligible') {
    return {
      allowed: false,
      attempt: { kind: 'invalid_preview_approval_attempt', previewId: metadata.previewId, reason: 'preview-not-eligible' },
    };
  }
  return { allowed: true, metadata };
}

function deterministicOperationId(params: {
  userId: string;
  previewId: string;
  stateRevision: number;
  sourceBlockIds: readonly string[];
}): string {
  let hash = 2166136261;
  const source = [params.userId, params.previewId, params.stateRevision, ...[...params.sourceBlockIds].sort()].join('\u001f');
  for (const character of source) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `weekly-approval:${(hash >>> 0).toString(16)}`;
}

export function createWeeklyDraftApprovalOperation(params: {
  userId: string;
  metadata: WeeklyPreviewMetadata;
  blocks: readonly WeeklyPlanDraftBlock[];
  now: string;
}): WeeklyDraftApprovalOperation {
  const sourceBlockIds = Array.from(new Set(params.blocks.map((block) => block.id)));
  return {
    approvalOperationId: deterministicOperationId({
      userId: params.userId,
      previewId: params.metadata.previewId,
      stateRevision: params.metadata.stateRevision,
      sourceBlockIds,
    }),
    userId: params.userId,
    previewId: params.metadata.previewId,
    previewStateRevision: params.metadata.stateRevision,
    startedAt: params.now,
    status: 'pending',
    items: sourceBlockIds.map((sourceDraftBlockId) => ({
      sourceDraftBlockId,
      status: 'pending',
      attemptCount: 0,
      updatedAt: params.now,
    })),
  };
}

export function deriveApprovalOperationStatus(
  items: readonly WeeklyDraftApprovalItem[],
): WeeklyDraftApprovalOperationStatus {
  if (items.length === 0) return 'failed';
  if (items.every((item) => item.status === 'saved' || item.status === 'skipped_duplicate')) return 'completed';
  if (items.some((item) => item.status === 'saved' || item.status === 'skipped_duplicate')) return 'partially_saved';
  if (items.every((item) => item.status === 'failed')) return 'failed';
  return 'pending';
}

export interface ExecuteWeeklyDraftApprovalDependencies {
  findExistingPlanId(params: { userId: string; sourceDraftBlockId: string }): Promise<string | undefined>;
  saveBlock(params: {
    block: WeeklyPlanDraftBlock;
    source: ApprovedPlanSource;
  }): Promise<{ planId: string }>;
  now(): string;
}

export async function executeWeeklyDraftApproval(params: {
  operation: WeeklyDraftApprovalOperation;
  blocks: readonly WeeklyPlanDraftBlock[];
  dependencies: ExecuteWeeklyDraftApprovalDependencies;
}): Promise<WeeklyDraftApprovalOperation> {
  let operation = cloneOperation(params.operation);
  if (operation.status === 'completed') return operation;
  const blockById = new Map(params.blocks.map((block) => [block.id, block]));

  for (const currentItem of operation.items) {
    if (currentItem.status === 'saved' || currentItem.status === 'skipped_duplicate') continue;
    const block = blockById.get(currentItem.sourceDraftBlockId);
    const itemIndex = operation.items.findIndex((item) => item.sourceDraftBlockId === currentItem.sourceDraftBlockId);
    if (!block || block.userId !== operation.userId) {
      operation.items[itemIndex] = {
        ...currentItem,
        status: 'failed',
        attemptCount: currentItem.attemptCount + 1,
        lastErrorCode: 'missing-or-unauthorized-block',
        updatedAt: params.dependencies.now(),
      };
      continue;
    }

    const existingPlanId = await params.dependencies.findExistingPlanId({
      userId: operation.userId,
      sourceDraftBlockId: block.id,
    });
    if (existingPlanId) {
      operation.items[itemIndex] = {
        ...currentItem,
        status: 'skipped_duplicate',
        savedPlanId: existingPlanId,
        attemptCount: currentItem.attemptCount + 1,
        updatedAt: params.dependencies.now(),
      };
      continue;
    }

    const savingItem: WeeklyDraftApprovalItem = {
      sourceDraftBlockId: currentItem.sourceDraftBlockId,
      status: 'saving',
      attemptCount: currentItem.attemptCount + 1,
      updatedAt: params.dependencies.now(),
    };
    operation.items[itemIndex] = savingItem;
    try {
      const saved = await params.dependencies.saveBlock({
        block,
        source: {
          sourceType: 'weekly_draft',
          sourceDraftBlockId: block.id,
          approvalOperationId: operation.approvalOperationId,
        },
      });
      operation.items[itemIndex] = {
        ...savingItem,
        status: 'saved',
        savedPlanId: saved.planId,
        updatedAt: params.dependencies.now(),
      };
    } catch (error) {
      operation.items[itemIndex] = {
        ...savingItem,
        status: 'failed',
        lastErrorCode: errorCode(error),
        updatedAt: params.dependencies.now(),
      };
    }
  }

  operation = { ...operation, status: deriveApprovalOperationStatus(operation.items) };
  if (operation.status === 'completed') operation.completedAt = params.dependencies.now();
  return operation;
}

export function serializeWeeklyApprovalLedger(
  operations: readonly WeeklyDraftApprovalOperation[],
): string {
  const envelope: WeeklyApprovalLedgerEnvelope = {
    version: WEEKLY_APPROVAL_LEDGER_VERSION,
    operations: operations.slice(-WEEKLY_APPROVAL_LEDGER_MAX_ITEMS).map(cloneOperation),
  };
  return JSON.stringify(envelope);
}

export function parseWeeklyApprovalLedger(value: string): WeeklyApprovalLedgerEnvelope | null {
  if (value.length > 1_000_000) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isPlainObject(parsed)
      || parsed.version !== WEEKLY_APPROVAL_LEDGER_VERSION
      || !Array.isArray(parsed.operations)
      || parsed.operations.length > WEEKLY_APPROVAL_LEDGER_MAX_ITEMS) {
      return null;
    }
    const operations = parsed.operations.filter((item): item is WeeklyDraftApprovalOperation =>
      isPlainObject(item)
      && typeof item.approvalOperationId === 'string'
      && typeof item.userId === 'string'
      && typeof item.previewId === 'string'
      && Number.isInteger(item.previewStateRevision)
      && Array.isArray(item.items),
    ).map(cloneOperation);
    if (operations.length !== parsed.operations.length) return null;
    return { version: WEEKLY_APPROVAL_LEDGER_VERSION, operations };
  } catch {
    return null;
  }
}
