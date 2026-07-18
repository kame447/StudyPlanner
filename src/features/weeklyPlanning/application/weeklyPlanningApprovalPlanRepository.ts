import {
  doc,
  runTransaction,
  type Firestore,
} from 'firebase/firestore';
import { createPlanFromDraft } from '../../../domain/planner';
import { getFirestoreDb } from '../../../lib/firebaseClient';
import { normalizePlanRecord } from '../../../repositories/repositoryUtils';
import type { Plan, PlanDraft } from '../../../types/domain';
import type { WeeklyDraftApprovalOperation } from '../planning/weeklyPlanningApprovalTypes';
import {
  buildWeeklyPlanningPlanSourceId,
  parseWeeklyPlanningPlanSourceId,
  WEEKLY_PLANNING_PLAN_SOURCE_TYPE,
} from '../planning/weeklyPlanningPlanProvenance';

const OPERATION_COLLECTION = 'weekly_planning_approval_operations';
const ITEM_COLLECTION = 'items';
const RECORD_SCHEMA_VERSION = 1;
const OPERATION_RETENTION_DAYS = 180;
const MAX_DOCUMENT_ID_LENGTH = 1400;

export type WeeklyPlanningApprovalPersistenceErrorCode =
  | 'invalid_request'
  | 'ownership_mismatch'
  | 'source_conflict'
  | 'saved_plan_missing'
  | 'operation_missing'
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

interface StoredApprovalOperation {
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

interface StoredApprovalItem {
  schemaVersion: typeof RECORD_SCHEMA_VERSION;
  userId: string;
  approvalOperationId: string;
  sourceDraftBlockId: string;
  status: 'saved';
  savedPlanId: string;
  updatedAt: string;
}

interface AtomicSaveSnapshot {
  operation: StoredApprovalOperation | null;
  item: StoredApprovalItem | null;
  plan: Plan | null;
}

interface AtomicSaveResolution {
  operation: StoredApprovalOperation;
  item: StoredApprovalItem;
  plan: Plan;
  writePlan: boolean;
}

export interface WeeklyPlanningApprovalPlanRepository {
  saveApprovedPlan(draft: PlanDraft): Promise<Plan>;
  completeOperation(operation: WeeklyDraftApprovalOperation): Promise<void>;
}

export interface WeeklyPlanningApprovalMemoryState {
  readonly plans: Map<string, Plan>;
  readonly operations: Map<string, StoredApprovalOperation>;
  readonly items: Map<string, StoredApprovalItem>;
  readonly metrics: {
    planWrites: number;
    itemWrites: number;
    operationWrites: number;
  };
  runExclusive<T>(task: () => Promise<T> | T): Promise<T>;
}

interface ResolvedIdentity {
  userId: string;
  approvalOperationId: string;
  sourceDraftBlockId: string;
  operationDocumentId: string;
  itemDocumentId: string;
  itemStorageKey: string;
  planId: string;
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

function resolveDraftIdentity(draft: PlanDraft): ResolvedIdentity {
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
  const approvalOperationId = requireNonempty(
    parsed.approvalOperationId,
    '承認操作',
  );
  const sourceDraftBlockId = requireNonempty(
    parsed.sourceDraftBlockId,
    '仮予定',
  );
  const operationDocumentId = safeDocumentId(
    'weekly-approval',
    `${userId}\u001f${approvalOperationId}`,
  );
  const itemDocumentId = safeDocumentId('item', sourceDraftBlockId);
  const planId = safeDocumentId(
    'weekly-plan',
    `${userId}\u001f${draft.sourceId}`,
  );
  return {
    userId,
    approvalOperationId,
    sourceDraftBlockId,
    operationDocumentId,
    itemDocumentId,
    itemStorageKey: `${operationDocumentId}/${itemDocumentId}`,
    planId,
  };
}

function resolveOperationItemIdentity(params: {
  userId: string;
  approvalOperationId: string;
  sourceDraftBlockId: string;
}): ResolvedIdentity {
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
  return {
    userId,
    approvalOperationId,
    sourceDraftBlockId,
    operationDocumentId,
    itemDocumentId,
    itemStorageKey: `${operationDocumentId}/${itemDocumentId}`,
    planId: safeDocumentId(
      'weekly-plan',
      `${userId}\u001f${sourceId}`,
    ),
  };
}

function retentionExpiry(now: Date): Date {
  return new Date(now.getTime() + OPERATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseOperation(value: unknown): StoredApprovalOperation | null {
  if (!isRecord(value)
    || value.schemaVersion !== RECORD_SCHEMA_VERSION
    || typeof value.userId !== 'string'
    || typeof value.approvalOperationId !== 'string'
    || (value.status !== 'active' && value.status !== 'completed')
    || typeof value.savedItemCount !== 'number'
    || !Number.isInteger(value.savedItemCount)
    || value.savedItemCount < 0
    || typeof value.createdAt !== 'string'
    || typeof value.updatedAt !== 'string') {
    return null;
  }
  return value as unknown as StoredApprovalOperation;
}

function parseItem(value: unknown): StoredApprovalItem | null {
  if (!isRecord(value)
    || value.schemaVersion !== RECORD_SCHEMA_VERSION
    || typeof value.userId !== 'string'
    || typeof value.approvalOperationId !== 'string'
    || typeof value.sourceDraftBlockId !== 'string'
    || value.status !== 'saved'
    || typeof value.savedPlanId !== 'string'
    || typeof value.updatedAt !== 'string') {
    return null;
  }
  return value as unknown as StoredApprovalItem;
}

function validateOperationOwnership(
  operation: StoredApprovalOperation,
  identity: ResolvedIdentity,
): void {
  if (operation.userId !== identity.userId
    || operation.approvalOperationId !== identity.approvalOperationId) {
    throw new WeeklyPlanningApprovalPersistenceError(
      'ownership_mismatch',
      '承認操作の所有者が一致しません。',
    );
  }
}

function validateItemOwnership(
  item: StoredApprovalItem,
  identity: ResolvedIdentity,
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

function validatePlanOwnership(plan: Plan, draft: PlanDraft, identity: ResolvedIdentity): void {
  if (plan.userId !== identity.userId
    || plan.sourceType !== WEEKLY_PLANNING_PLAN_SOURCE_TYPE
    || plan.sourceId !== draft.sourceId
    || plan.id !== identity.planId) {
    throw new WeeklyPlanningApprovalPersistenceError(
      'source_conflict',
      '同じ保存識別子に別の予定が存在します。',
    );
  }
}

function resolveAtomicSave(params: {
  draft: PlanDraft;
  identity: ResolvedIdentity;
  snapshot: AtomicSaveSnapshot;
  now: Date;
}): AtomicSaveResolution {
  const { draft, identity, snapshot, now } = params;
  if (snapshot.operation) validateOperationOwnership(snapshot.operation, identity);
  if (snapshot.item) validateItemOwnership(snapshot.item, identity);
  if (snapshot.plan) validatePlanOwnership(snapshot.plan, draft, identity);

  if (snapshot.item && !snapshot.plan) {
    throw new WeeklyPlanningApprovalPersistenceError(
      'saved_plan_missing',
      '保存済み承認項目に対応する予定が見つかりません。',
    );
  }

  const timestamp = now.toISOString();
  const plan = snapshot.plan ?? {
    ...createPlanFromDraft(draft),
    id: identity.planId,
    seriesId: identity.planId,
  };
  const item: StoredApprovalItem = snapshot.item ?? {
    schemaVersion: RECORD_SCHEMA_VERSION,
    userId: identity.userId,
    approvalOperationId: identity.approvalOperationId,
    sourceDraftBlockId: identity.sourceDraftBlockId,
    status: 'saved',
    savedPlanId: identity.planId,
    updatedAt: timestamp,
  };
  const operation: StoredApprovalOperation = {
    schemaVersion: RECORD_SCHEMA_VERSION,
    userId: identity.userId,
    approvalOperationId: identity.approvalOperationId,
    status: snapshot.operation?.status ?? 'active',
    savedItemCount:
      (snapshot.operation?.savedItemCount ?? 0) + (snapshot.item ? 0 : 1),
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

function resolveCompletion(params: {
  operation: StoredApprovalOperation | null;
  userId: string;
  approvalOperationId: string;
  durableItemCount: number;
  expectedItemCount: number;
  now: Date;
}): StoredApprovalOperation {
  const operation = params.operation;
  if (operation
    && (operation.userId !== params.userId
      || operation.approvalOperationId !== params.approvalOperationId)) {
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
    createdAt: operation?.createdAt ?? timestamp,
    updatedAt: timestamp,
    completedAt: operation?.completedAt ?? timestamp,
    expiresAt: retentionExpiry(params.now),
  };
}

function mapPersistenceError(error: unknown): never {
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

export function createFirestoreWeeklyPlanningApprovalPlanRepository(
  firestore: Firestore,
): WeeklyPlanningApprovalPlanRepository {
  return {
    async saveApprovedPlan(draft) {
      const identity = resolveDraftIdentity(draft);
      const operationRef = doc(
        firestore,
        OPERATION_COLLECTION,
        identity.operationDocumentId,
      );
      const itemRef = doc(operationRef, ITEM_COLLECTION, identity.itemDocumentId);
      const planRef = doc(firestore, 'plans', identity.planId);
      try {
        return await runTransaction(firestore, async (transaction) => {
          const [operationSnapshot, itemSnapshot, planSnapshot] = await Promise.all([
            transaction.get(operationRef),
            transaction.get(itemRef),
            transaction.get(planRef),
          ]);
          const resolution = resolveAtomicSave({
            draft,
            identity,
            snapshot: {
              operation: operationSnapshot.exists()
                ? parseOperation(operationSnapshot.data())
                : null,
              item: itemSnapshot.exists() ? parseItem(itemSnapshot.data()) : null,
              plan: planSnapshot.exists()
                ? normalizePlanRecord({
                    ...planSnapshot.data(),
                    id: planSnapshot.id,
                  } as Plan)
                : null,
            },
            now: new Date(),
          });
          transaction.set(operationRef, resolution.operation, { merge: false });
          transaction.set(itemRef, resolution.item, { merge: false });
          if (resolution.writePlan) {
            transaction.set(planRef, resolution.plan, { merge: false });
          }
          return resolution.plan;
        });
      } catch (error) {
        mapPersistenceError(error);
      }
    },

    async completeOperation(operation) {
      const serverItems = operation.items.filter(
        (item) => item.status === 'saved',
      );
      if (serverItems.length === 0) return;
      const userId = requireNonempty(operation.userId, '利用者');
      const approvalOperationId = requireNonempty(
        operation.approvalOperationId,
        '承認操作',
      );
      const identities = serverItems.map((item) =>
        resolveOperationItemIdentity({
          userId,
          approvalOperationId,
          sourceDraftBlockId: item.sourceDraftBlockId,
        }),
      );
      await state.runExclusive(() => {
        identities.forEach((identity) => {
          const item = state.items.get(identity.itemStorageKey);
          if (!item) {
            throw new WeeklyPlanningApprovalPersistenceError(
              'incomplete_operation',
              '未保存の承認項目が残っています。',
              true,
            );
          }
          validateItemOwnership(item, identity);
          const plan = state.plans.get(item.savedPlanId);
          if (!plan) {
            throw new WeeklyPlanningApprovalPersistenceError(
              'saved_plan_missing',
              '保存済み承認項目に対応する予定が見つかりません。',
            );
          }
          if (plan.userId !== identity.userId
            || plan.sourceType !== WEEKLY_PLANNING_PLAN_SOURCE_TYPE
            || plan.sourceId !== buildWeeklyPlanningPlanSourceId(identity)
            || plan.id !== identity.planId) {
            throw new WeeklyPlanningApprovalPersistenceError(
              'source_conflict',
              '承認項目に別の予定が関連付けられています。',
            );
          }
        });
        const operationDocumentId = identities[0].operationDocumentId;
        const completed = resolveCompletion({
          operation: state.operations.get(operationDocumentId) ?? null,
          userId,
          approvalOperationId,
          durableItemCount: identities.length,
          expectedItemCount: identities.length,
          now: new Date(),
        });
        state.operations.set(operationDocumentId, completed);
        state.metrics.operationWrites += 1;
      });
    },
  };
}

function createPlannerBackedWeeklyPlanningApprovalPlanRepository(): WeeklyPlanningApprovalPlanRepository {
  return {
    async saveApprovedPlan(draft) {
      const identity = resolveDraftIdentity(draft);
      const { plannerRepository } = await import('../../../repositories');
      const existing = (await plannerRepository.getPlans(identity.userId)).find(
        (plan) => plan.sourceType === WEEKLY_PLANNING_PLAN_SOURCE_TYPE
          && plan.sourceId === draft.sourceId,
      );
      if (existing) return existing;
      const plan = {
        ...createPlanFromDraft(draft),
        id: identity.planId,
        seriesId: identity.planId,
      };
      return plannerRepository.upsertPlan(plan);
    },
    async completeOperation() {
      // Local development storage has no distributed operation ledger.
    },
  };
}

let repository: WeeklyPlanningApprovalPlanRepository | null = null;

export function getWeeklyPlanningApprovalPlanRepository(): WeeklyPlanningApprovalPlanRepository {
  if (repository) return repository;
  const firestore = getFirestoreDb();
  repository = firestore
    ? createFirestoreWeeklyPlanningApprovalPlanRepository(firestore)
    : createPlannerBackedWeeklyPlanningApprovalPlanRepository();
  return repository;
}

export function setWeeklyPlanningApprovalPlanRepositoryForTests(
  next: WeeklyPlanningApprovalPlanRepository | null,
): void {
  repository = next;
}
