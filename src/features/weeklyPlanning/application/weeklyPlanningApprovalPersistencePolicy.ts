import { createPlanFromDraft } from '../../../domain/planner';
import type { Plan, PlanDraft } from '../../../types/domain';
import type { WeeklyDraftApprovalOperation } from '../planning/weeklyPlanningApprovalTypes';
import {
  buildWeeklyPlanningPlanSourceId,
  parseWeeklyPlanningPlanSourceId,
  WEEKLY_PLANNING_PLAN_SOURCE_TYPE,
} from '../planning/weeklyPlanningPlanProvenance';

const RECORD_SCHEMA_VERSION = 1;
const OPERATION_RETENTION_DAYS = 180;
const MAX_DOCUMENT_ID_LENGTH = 1400;

export type WeeklyPlanningApprovalPersistenceErrorCode =
  | 'invalid_request'
  | 'ownership_mismatch'
  | 'source_conflict'
  | 'saved_plan_missing'
  | 'incomplete_operation'
  | 'transaction_failed';

export class WeeklyPlanningApprovalPersistenceError extends Error {
  readonly code: WeeklyPlanningApprovalPersistenceErrorCode;
  readonly retryable: boolean;

  constructor(
    code: WeeklyPlanningApprovalPersistenceErrorCode,
    message: string,
    retryable = false,
  ) {
    super(message);
    this.name = 'WeeklyPlanningApprovalPersistenceError';
    this.code = code;
    this.retryable = retryable;
  }
}

export interface StoredApprovalOperation {
  schemaVersion: typeof RECORD_SCHEMA_VERSION;
  userId: string;
  approvalOperationId: string;
  status: 'active' | 'completed';
  savedItemCount: number;
  expectedItemCount?: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  expiresAt: Date;
}

export interface StoredApprovalItem {
  schemaVersion: typeof RECORD_SCHEMA_VERSION;
  userId: string;
  approvalOperationId: string;
  sourceDraftBlockId: string;
  status: 'saved';
  savedPlanId: string;
  updatedAt: string;
  expiresAt: Date;
}

export interface ResolvedApprovalIdentity {
  userId: string;
  approvalOperationId: string;
  sourceDraftBlockId: string;
  sourceId: string;
  operationDocumentId: string;
  itemDocumentId: string;
  itemStorageKey: string;
  planId: string;
}

export interface AtomicApprovalSaveSnapshot {
  operation: StoredApprovalOperation | null;
  item: StoredApprovalItem | null;
  plan: Plan | null;
}

export interface AtomicApprovalSaveResolution {
  operation: StoredApprovalOperation;
  item: StoredApprovalItem;
  plan: Plan;
  writePlan: boolean;
}

function requireNonempty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new WeeklyPlanningApprovalPersistenceError(
      'invalid_request',
      `${field}を確認できませんでした。`,
    );
  }
  return normalized;
}

function safeDocumentId(prefix: string, value: string): string {
  const documentId = `${prefix}-${encodeURIComponent(value)}`;
  if (documentId.length > MAX_DOCUMENT_ID_LENGTH) {
    throw new WeeklyPlanningApprovalPersistenceError(
      'invalid_request',
      '承認識別子が長すぎます。',
    );
  }
  return documentId;
}

export function resolveApprovalOperationItemIdentity(params: {
  userId: string;
  approvalOperationId: string;
  sourceDraftBlockId: string;
}): ResolvedApprovalIdentity {
  const userId = requireNonempty(params.userId, '利用者');
  const approvalOperationId = requireNonempty(
    params.approvalOperationId,
    '承認操作',
  );
  const sourceDraftBlockId = requireNonempty(
    params.sourceDraftBlockId,
    '仮予定',
  );
  const sourceId = buildWeeklyPlanningPlanSourceId({
    approvalOperationId,
    sourceDraftBlockId,
  });
  const operationDocumentId = safeDocumentId(
    'weekly-approval',
    `${userId}\u001f${approvalOperationId}`,
  );
  const itemDocumentId = safeDocumentId('item', sourceDraftBlockId);
  const planId = safeDocumentId(
    'weekly-plan',
    `${userId}\u001f${sourceId}`,
  );
  return {
    userId,
    approvalOperationId,
    sourceDraftBlockId,
    sourceId,
    operationDocumentId,
    itemDocumentId,
    itemStorageKey: `${operationDocumentId}/${itemDocumentId}`,
    planId,
  };
}

export function resolveApprovalDraftIdentity(draft: PlanDraft): ResolvedApprovalIdentity {
  const userId = requireNonempty(draft.userId, '利用者');
  if (draft.sourceType !== WEEKLY_PLANNING_PLAN_SOURCE_TYPE) {
    throw new WeeklyPlanningApprovalPersistenceError(
      'invalid_request',
      '週間計画由来ではない予定を承認保存できません。',
    );
  }
  const parsed = parseWeeklyPlanningPlanSourceId(draft.sourceId);
  if (!parsed) {
    throw new WeeklyPlanningApprovalPersistenceError(
      'invalid_request',
      '週間計画の保存元を確認できませんでした。',
    );
  }
  const identity = resolveApprovalOperationItemIdentity({
    userId,
    approvalOperationId: parsed.approvalOperationId,
    sourceDraftBlockId: parsed.sourceDraftBlockId,
  });
  if (identity.sourceId !== draft.sourceId) {
    throw new WeeklyPlanningApprovalPersistenceError(
      'invalid_request',
      '週間計画の保存元形式が一致しません。',
    );
  }
  return identity;
}

function retentionExpiry(now: Date): Date {
  return new Date(
    now.getTime() + OPERATION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseStoredApprovalOperation(value: unknown): StoredApprovalOperation | null {
  if (!isRecord(value)
    || value.schemaVersion !== RECORD_SCHEMA_VERSION
    || typeof value.userId !== 'string'
    || typeof value.approvalOperationId !== 'string'
    || (value.status !== 'active' && value.status !== 'completed')
    || typeof value.savedItemCount !== 'number'
    || !Number.isInteger(value.savedItemCount)
    || value.savedItemCount < 0
    || typeof value.createdAt !== 'string'
    || typeof value.updatedAt !== 'string'
    || value.expiresAt === undefined) {
    return null;
  }
  return value as unknown as StoredApprovalOperation;
}

export function parseStoredApprovalItem(value: unknown): StoredApprovalItem | null {
  if (!isRecord(value)
    || value.schemaVersion !== RECORD_SCHEMA_VERSION
    || typeof value.userId !== 'string'
    || typeof value.approvalOperationId !== 'string'
    || typeof value.sourceDraftBlockId !== 'string'
    || value.status !== 'saved'
    || typeof value.savedPlanId !== 'string'
    || typeof value.updatedAt !== 'string'
    || value.expiresAt === undefined) {
    return null;
  }
  return value as unknown as StoredApprovalItem;
}

export function malformedApprovalRecord(message: string): WeeklyPlanningApprovalPersistenceError {
  return new WeeklyPlanningApprovalPersistenceError('source_conflict', message);
}

export function validateApprovalItemOwnership(
  item: StoredApprovalItem,
  identity: ResolvedApprovalIdentity,
): void {
  if (item.userId !== identity.userId
    || item.approvalOperationId !== identity.approvalOperationId
    || item.sourceDraftBlockId !== identity.sourceDraftBlockId) {
    throw new WeeklyPlanningApprovalPersistenceError(
      'ownership_mismatch',
      '承認項目の所有者が一致しません。',
    );
  }
  if (item.savedPlanId !== identity.planId) {
    throw new WeeklyPlanningApprovalPersistenceError(
      'source_conflict',
      '承認項目に別の予定が関連付けられています。',
    );
  }
}

function validateApprovalOperationOwnership(
  operation: StoredApprovalOperation,
  identity: ResolvedApprovalIdentity,
): void {
  if (operation.userId !== identity.userId
    || operation.approvalOperationId !== identity.approvalOperationId) {
    throw new WeeklyPlanningApprovalPersistenceError(
      'ownership_mismatch',
      '承認操作の所有者が一致しません。',
    );
  }
}

export function validateApprovalPlanIdentity(
  plan: Plan,
  identity: ResolvedApprovalIdentity,
): void {
  if (plan.userId !== identity.userId
    || plan.sourceType !== WEEKLY_PLANNING_PLAN_SOURCE_TYPE
    || plan.sourceId !== identity.sourceId
    || plan.id !== identity.planId) {
    throw new WeeklyPlanningApprovalPersistenceError(
      'source_conflict',
      '同じ保存識別子に別の予定が存在します。',
    );
  }
}

export function refreshApprovalItemRetention(
  item: StoredApprovalItem,
  now: Date,
): StoredApprovalItem {
  return {
    ...item,
    updatedAt: now.toISOString(),
    expiresAt: retentionExpiry(now),
  };
}

export function resolveAtomicApprovalSave(params: {
  draft: PlanDraft;
  identity: ResolvedApprovalIdentity;
  snapshot: AtomicApprovalSaveSnapshot;
  now: Date;
}): AtomicApprovalSaveResolution {
  const { draft, identity, snapshot, now } = params;
  if (snapshot.operation) validateApprovalOperationOwnership(snapshot.operation, identity);
  if (snapshot.item) validateApprovalItemOwnership(snapshot.item, identity);
  if (snapshot.plan) validateApprovalPlanIdentity(snapshot.plan, identity);

  if (snapshot.item && !snapshot.plan) {
    throw new WeeklyPlanningApprovalPersistenceError(
      'saved_plan_missing',
      '保存済み承認項目に対応する予定が見つかりません。',
    );
  }
  if (snapshot.operation?.status === 'completed' && !snapshot.item) {
    throw new WeeklyPlanningApprovalPersistenceError(
      'source_conflict',
      '完了済み承認操作へ新しい項目を追加できません。',
    );
  }

  const timestamp = now.toISOString();
  const plan = snapshot.plan ?? {
    ...createPlanFromDraft(draft),
    id: identity.planId,
    seriesId: identity.planId,
  };
  const item = refreshApprovalItemRetention(snapshot.item ?? {
    schemaVersion: RECORD_SCHEMA_VERSION,
    userId: identity.userId,
    approvalOperationId: identity.approvalOperationId,
    sourceDraftBlockId: identity.sourceDraftBlockId,
    status: 'saved',
    savedPlanId: identity.planId,
    updatedAt: timestamp,
    expiresAt: retentionExpiry(now),
  }, now);
  const previousCount = snapshot.operation?.savedItemCount ?? 0;
  const operation: StoredApprovalOperation = {
    schemaVersion: RECORD_SCHEMA_VERSION,
    userId: identity.userId,
    approvalOperationId: identity.approvalOperationId,
    status: snapshot.operation?.status ?? 'active',
    savedItemCount: snapshot.operation
      ? previousCount + (snapshot.item ? 0 : 1)
      : 1,
    ...(snapshot.operation?.expectedItemCount !== undefined
      ? { expectedItemCount: snapshot.operation.expectedItemCount }
      : {}),
    createdAt: snapshot.operation?.createdAt ?? timestamp,
    updatedAt: timestamp,
    ...(snapshot.operation?.completedAt
      ? { completedAt: snapshot.operation.completedAt }
      : {}),
    expiresAt: retentionExpiry(now),
  };
  return {
    operation,
    item,
    plan,
    writePlan: !snapshot.plan,
  };
}

export function resolveApprovalCompletion(params: {
  operation: StoredApprovalOperation | null;
  userId: string;
  approvalOperationId: string;
  durableItemCount: number;
  expectedItemCount: number;
  now: Date;
}): StoredApprovalOperation {
  if (params.operation
    && (params.operation.userId !== params.userId
      || params.operation.approvalOperationId !== params.approvalOperationId)) {
    throw new WeeklyPlanningApprovalPersistenceError(
      'ownership_mismatch',
      '承認操作の所有者が一致しません。',
    );
  }
  if (params.durableItemCount < params.expectedItemCount) {
    throw new WeeklyPlanningApprovalPersistenceError(
      'incomplete_operation',
      '未保存の承認項目が残っています。',
      true,
    );
  }

  const timestamp = params.now.toISOString();
  return {
    schemaVersion: RECORD_SCHEMA_VERSION,
    userId: params.userId,
    approvalOperationId: params.approvalOperationId,
    status: 'completed',
    savedItemCount: params.durableItemCount,
    expectedItemCount: params.expectedItemCount,
    createdAt: params.operation?.createdAt ?? timestamp,
    updatedAt: timestamp,
    completedAt: params.operation?.completedAt ?? timestamp,
    expiresAt: retentionExpiry(params.now),
  };
}

export function mapWeeklyPlanningApprovalPersistenceError(error: unknown): never {
  if (error instanceof WeeklyPlanningApprovalPersistenceError) throw error;
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
  const retryable = [
    'aborted',
    'unavailable',
    'deadline-exceeded',
    'resource-exhausted',
    'firestore/aborted',
    'firestore/unavailable',
    'firestore/deadline-exceeded',
  ].includes(code);
  throw new WeeklyPlanningApprovalPersistenceError(
    'transaction_failed',
    '週間計画の保存処理を完了できませんでした。',
    retryable,
  );
}

export function identitiesForCompletedApprovalItems(
  operation: WeeklyDraftApprovalOperation,
): ResolvedApprovalIdentity[] {
  const userId = requireNonempty(operation.userId, '利用者');
  const approvalOperationId = requireNonempty(
    operation.approvalOperationId,
    '承認操作',
  );
  return operation.items
    .filter((item) => item.status === 'saved')
    .map((item) => resolveApprovalOperationItemIdentity({
      userId,
      approvalOperationId,
      sourceDraftBlockId: item.sourceDraftBlockId,
    }));
}
