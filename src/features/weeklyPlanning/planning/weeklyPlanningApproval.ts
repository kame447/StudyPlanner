import type { AssumptionProposalRecord } from '../intake/weeklyPlanningAssumptionProposals';
import { recordWeeklyPlanningApprovalTrace } from '../trace/weeklyPlanningTraceRuntime';
import type { WeeklyPlanDraftBlock } from '../types';
import type {
  ApprovedPlanSource,
  InvalidPreviewApprovalAttempt,
  PendingAssumptionPreviewApprovalAttempt,
  StalePreviewApprovalAttempt,
  WeeklyDraftApprovalItem,
  WeeklyDraftApprovalItemStatus,
  WeeklyDraftApprovalOperation,
  WeeklyDraftApprovalOperationStatus,
  WeeklyPreviewMetadata,
} from './weeklyPlanningApprovalTypes';
import { getWeeklyPlanningSessionRuntime } from './weeklyPlanningSessionRuntime';

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

const ITEM_STATUSES = new Set<WeeklyDraftApprovalItemStatus>([
  'pending',
  'saving',
  'saved',
  'failed',
  'skipped_duplicate',
]);
const OPERATION_STATUSES = new Set<WeeklyDraftApprovalOperationStatus>([
  'pending',
  'partially_saved',
  'completed',
  'failed',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function nonemptyBoundedString(value: unknown, maxLength = 500): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
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
      && metadata.conversationId === first.conversationId
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

function invalidAttempt(previewId: string | undefined, reason: string): WeeklyPreviewApprovalGuardResult {
  return {
    allowed: false,
    attempt: {
      kind: 'invalid_preview_approval_attempt',
      ...(previewId ? { previewId } : {}),
      reason,
    },
  };
}

export function validateWeeklyPreviewApproval(params: {
  blocks: readonly WeeklyPlanDraftBlock[];
  currentStateRevision: number;
  userId: string;
  proposalRecords: readonly AssumptionProposalRecord[];
}): WeeklyPreviewApprovalGuardResult {
  const metadata = metadataFromBlocks(params);
  if (!metadata) return invalidAttempt(undefined, 'missing-or-mixed-preview-metadata');

  if (metadata.authorizedUserId !== params.userId
    || params.blocks.some((block) => block.userId !== params.userId)
    || metadata.approvalEligibility === 'blocked_invalid'
    || metadata.approvalEligibility === 'unsupported') {
    return invalidAttempt(metadata.previewId, 'unauthorized-or-invalid-preview');
  }

  const runtime = metadata.conversationId ? getWeeklyPlanningSessionRuntime() : null;
  if (metadata.conversationId && !runtime) {
    return invalidAttempt(metadata.previewId, 'session-runtime-unavailable');
  }
  const effectiveCurrentRevision = runtime?.stateRevision ?? params.currentStateRevision;
  const effectiveProposalRecords = runtime?.proposalRecords ?? params.proposalRecords;
  const conversationMismatch = Boolean(
    metadata.conversationId
      && runtime
      && runtime.conversationId !== metadata.conversationId,
  );

  if (metadata.stale
    || metadata.approvalEligibility === 'blocked_stale'
    || conversationMismatch
    || metadata.stateRevision !== effectiveCurrentRevision) {
    return {
      allowed: false,
      attempt: {
        kind: 'stale_preview_approval_attempt',
        previewId: metadata.previewId,
        previewStateRevision: metadata.stateRevision,
        currentStateRevision: effectiveCurrentRevision,
        previewStale: true,
      },
    };
  }

  const pendingProposalIds: string[] = [];
  for (const dependency of metadata.assumptionDependencies) {
    const record = effectiveProposalRecords.find((candidate) => candidate.proposalId === dependency.proposalId);
    if (!record
      || record.targetRef !== dependency.targetRef
      || record.createdFromStateRevision !== dependency.proposalCreatedFromStateRevision
      || record.conversationId.trim().length === 0
      || (metadata.conversationId && record.conversationId !== metadata.conversationId)) {
      return invalidAttempt(metadata.previewId, 'invalid-assumption-dependency');
    }
    if (record.status === 'pending') pendingProposalIds.push(record.proposalId);
    if (record.status === 'rejected' || record.status === 'expired' || record.status === 'superseded') {
      return invalidAttempt(metadata.previewId, 'resolved-assumption-dependency-requires-recompute');
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
    return invalidAttempt(metadata.previewId, 'preview-not-eligible');
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
    ...(params.metadata.conversationId
      ? { conversationId: params.metadata.conversationId }
      : {}),
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
  recordWeeklyPlanningApprovalTrace({
    userId: operation.userId,
    phase: 'started',
    payload: {
      approvalOperationId: operation.approvalOperationId,
      previewId: operation.previewId,
      ...(operation.conversationId
        ? { conversationId: operation.conversationId }
        : {}),
      previewStateRevision: operation.previewStateRevision,
      itemCount: operation.items.length,
    },
  });
  if (operation.status === 'completed') {
    recordWeeklyPlanningApprovalTrace({
      userId: operation.userId,
      phase: 'completed',
      payload: operation,
    });
    return operation;
  }
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
  recordWeeklyPlanningApprovalTrace({
    userId: operation.userId,
    phase: 'completed',
    payload: operation,
    failed: operation.status === 'failed' || operation.status === 'partially_saved',
  });
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

function isApprovalItem(value: unknown): value is WeeklyDraftApprovalItem {
  if (!isPlainObject(value)
    || !nonemptyBoundedString(value.sourceDraftBlockId, 300)
    || !ITEM_STATUSES.has(value.status as WeeklyDraftApprovalItemStatus)
    || !Number.isInteger(value.attemptCount)
    || Number(value.attemptCount) < 0
    || !nonemptyBoundedString(value.updatedAt, 100)) {
    return false;
  }
  if (value.savedPlanId !== undefined && !nonemptyBoundedString(value.savedPlanId, 300)) return false;
  if (value.lastErrorCode !== undefined && !nonemptyBoundedString(value.lastErrorCode, 300)) return false;
  return true;
}

function isApprovalOperation(value: unknown): value is WeeklyDraftApprovalOperation {
  if (!isPlainObject(value)
    || !nonemptyBoundedString(value.approvalOperationId, 300)
    || !nonemptyBoundedString(value.userId, 300)
    || !nonemptyBoundedString(value.previewId, 300)
    || !Number.isInteger(value.previewStateRevision)
    || Number(value.previewStateRevision) < 0
    || !nonemptyBoundedString(value.startedAt, 100)
    || !OPERATION_STATUSES.has(value.status as WeeklyDraftApprovalOperationStatus)
    || !Array.isArray(value.items)
    || value.items.length === 0
    || value.items.length > WEEKLY_APPROVAL_LEDGER_MAX_ITEMS
    || !value.items.every(isApprovalItem)) {
    return false;
  }
  if (value.completedAt !== undefined && !nonemptyBoundedString(value.completedAt, 100)) return false;
  const sourceIds = value.items.map((item) => item.sourceDraftBlockId);
  return new Set(sourceIds).size === sourceIds.length;
}

export function parseWeeklyApprovalLedger(value: string): WeeklyApprovalLedgerEnvelope | null {
  if (value.length > 1_000_000) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isPlainObject(parsed)
      || parsed.version !== WEEKLY_APPROVAL_LEDGER_VERSION
      || !Array.isArray(parsed.operations)
      || parsed.operations.length > WEEKLY_APPROVAL_LEDGER_MAX_ITEMS
      || !parsed.operations.every(isApprovalOperation)) {
      return null;
    }
    return {
      version: WEEKLY_APPROVAL_LEDGER_VERSION,
      operations: parsed.operations.map(cloneOperation),
    };
  } catch {
    return null;
  }
}
