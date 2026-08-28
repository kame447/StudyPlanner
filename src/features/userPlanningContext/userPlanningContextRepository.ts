import {
  doc,
  onSnapshot,
  runTransaction,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import { getFirestoreDb } from '../../lib/firebaseClient';
import {
  normalizeUserPlanningContextSnapshotV1,
  userPlanningContextDurableKeyV1,
  userPlanningContextRecordIdentityV1,
} from './userPlanningContextSpace';
import {
  USER_PLANNING_CONTEXT_CLOUD_SCHEMA_VERSION,
  USER_PLANNING_CONTEXT_STORAGE_VERSION,
  type UserPlanningContextCloudDocumentV1,
  type UserPlanningContextRecordV1,
  type UserPlanningContextSnapshotV1,
} from './userPlanningContextTypes';

const COLLECTION_NAME = 'user_planning_contexts';
const MAX_RECORDS = 200;

export interface UserPlanningContextRepositoryStateV1 {
  snapshot: UserPlanningContextSnapshotV1;
  revision: number;
  shared: boolean;
}

export interface UserPlanningContextRepositoryV1 {
  initialize(
    ownerId: string,
    localSnapshot: UserPlanningContextSnapshotV1,
  ): Promise<UserPlanningContextRepositoryStateV1>;
  upsertInferredRecords(
    ownerId: string,
    records: readonly UserPlanningContextRecordV1[],
  ): Promise<UserPlanningContextRepositoryStateV1>;
  saveUserConfirmedRecord(
    ownerId: string,
    record: UserPlanningContextRecordV1,
    previousRecordId?: string | null,
  ): Promise<UserPlanningContextRepositoryStateV1>;
  removeRecord(
    ownerId: string,
    recordId: string,
  ): Promise<UserPlanningContextRepositoryStateV1>;
  subscribe(
    ownerId: string,
    onChange: (state: UserPlanningContextRepositoryStateV1) => void,
    onError: (error: Error) => void,
  ): Unsubscribe;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCloudDocument(
  value: unknown,
  ownerId: string,
): UserPlanningContextCloudDocumentV1 | null {
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== USER_PLANNING_CONTEXT_CLOUD_SCHEMA_VERSION
    || value.ownerId !== ownerId
    || typeof value.revision !== 'number'
    || !Number.isSafeInteger(value.revision)
    || value.revision < 0
    || typeof value.updatedAt !== 'string'
    || !Number.isFinite(Date.parse(value.updatedAt))) {
    return null;
  }
  const snapshot = normalizeUserPlanningContextSnapshotV1(value.snapshot, ownerId);
  if (!snapshot) return null;
  return {
    schemaVersion: USER_PLANNING_CONTEXT_CLOUD_SCHEMA_VERSION,
    ownerId,
    revision: value.revision,
    snapshot,
    updatedAt: value.updatedAt,
  };
}

function canonicalRecords(
  records: Iterable<UserPlanningContextRecordV1>,
): UserPlanningContextRecordV1[] {
  return [...records]
    .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))
    .slice(0, MAX_RECORDS)
    .map((record) => ({ ...record }));
}

function snapshotFromRecords(params: {
  ownerId: string;
  records: Iterable<UserPlanningContextRecordV1>;
  updatedAt: string;
}): UserPlanningContextSnapshotV1 {
  return {
    version: USER_PLANNING_CONTEXT_STORAGE_VERSION,
    ownerId: params.ownerId,
    records: canonicalRecords(params.records),
    updatedAt: params.updatedAt,
  };
}

export function migrateLocalUserPlanningContextSnapshotV1(
  snapshot: UserPlanningContextSnapshotV1,
): UserPlanningContextSnapshotV1 {
  return {
    ...snapshot,
    records: snapshot.records.map((record) => ({
      ...record,
      origin: record.origin === 'user_confirmed' ? 'user_confirmed' : 'migration',
    })),
  };
}

function isPersistableSemanticOrigin(record: UserPlanningContextRecordV1): boolean {
  return record.origin === 'ai_inferred'
    || record.origin === 'user_stated'
    || record.origin === 'system_inferred';
}

export function mergeInferredUserPlanningContextRecordsV1(params: {
  snapshot: UserPlanningContextSnapshotV1;
  records: readonly UserPlanningContextRecordV1[];
  now: string;
}): UserPlanningContextSnapshotV1 {
  const byIdentity = new Map<string, UserPlanningContextRecordV1>();
  const protectedDurableKeys = new Set<string>();
  for (const record of params.snapshot.records) {
    byIdentity.set(userPlanningContextRecordIdentityV1(record), record);
    if (record.origin === 'user_confirmed') {
      protectedDurableKeys.add(userPlanningContextDurableKeyV1(record));
    }
  }
  for (const record of params.records) {
    if (record.ownerId !== params.snapshot.ownerId || !isPersistableSemanticOrigin(record)) continue;
    if (protectedDurableKeys.has(userPlanningContextDurableKeyV1(record))) continue;
    byIdentity.set(userPlanningContextRecordIdentityV1(record), { ...record });
  }
  return snapshotFromRecords({
    ownerId: params.snapshot.ownerId,
    records: byIdentity.values(),
    updatedAt: params.now,
  });
}

export function replaceWithUserConfirmedContextRecordV1(params: {
  snapshot: UserPlanningContextSnapshotV1;
  record: UserPlanningContextRecordV1;
  previousRecordId?: string | null;
  now: string;
}): UserPlanningContextSnapshotV1 {
  if (params.record.ownerId !== params.snapshot.ownerId || params.record.origin !== 'user_confirmed') {
    throw new Error('Confirmed long-term memory owner or origin is invalid.');
  }
  const nextKey = userPlanningContextDurableKeyV1(params.record);
  const records = params.snapshot.records.filter((candidate) => {
    if (params.previousRecordId && candidate.id === params.previousRecordId) return false;
    return userPlanningContextDurableKeyV1(candidate) !== nextKey;
  });
  records.push({ ...params.record });
  return snapshotFromRecords({
    ownerId: params.snapshot.ownerId,
    records,
    updatedAt: params.now,
  });
}

/**
 * A forget action is a tombstone, not a physical delete. Keeping the stable
 * record id and durable key prevents a later semantic extraction or an older
 * client snapshot from silently reviving the same fact. Revoked records are
 * excluded from UI and AI context by the application layer.
 */
export function removeUserPlanningContextRecordFromSnapshotV1(params: {
  snapshot: UserPlanningContextSnapshotV1;
  recordId: string;
  now: string;
}): UserPlanningContextSnapshotV1 {
  const records = params.snapshot.records.map((record) => {
    if (record.id !== params.recordId) return record;
    return {
      ...record,
      status: 'revoked' as const,
      origin: 'user_confirmed' as const,
      recordedAt: params.now,
      sourceConversationId: 'user-settings',
      sourceTurnId: `user-settings:forget:${params.now}`,
    };
  });
  return snapshotFromRecords({
    ownerId: params.snapshot.ownerId,
    records,
    updatedAt: params.now,
  });
}

function cloudDocument(params: {
  ownerId: string;
  revision: number;
  snapshot: UserPlanningContextSnapshotV1;
  now: string;
}): UserPlanningContextCloudDocumentV1 {
  return {
    schemaVersion: USER_PLANNING_CONTEXT_CLOUD_SCHEMA_VERSION,
    ownerId: params.ownerId,
    revision: params.revision,
    snapshot: params.snapshot,
    updatedAt: params.now,
  };
}

function stateFromDocument(document: UserPlanningContextCloudDocumentV1): UserPlanningContextRepositoryStateV1 {
  return {
    snapshot: document.snapshot,
    revision: document.revision,
    shared: true,
  };
}

class FirestoreUserPlanningContextRepositoryV1 implements UserPlanningContextRepositoryV1 {
  constructor(private readonly db: Firestore) {}

  private ref(ownerId: string) {
    return doc(this.db, COLLECTION_NAME, ownerId);
  }

  async initialize(
    ownerId: string,
    localSnapshot: UserPlanningContextSnapshotV1,
  ): Promise<UserPlanningContextRepositoryStateV1> {
    return runTransaction(this.db, async (transaction) => {
      const ref = this.ref(ownerId);
      const remote = await transaction.get(ref);
      if (remote.exists()) {
        const parsed = parseCloudDocument(remote.data(), ownerId);
        if (!parsed) throw new Error('共有されている長期記憶の形式が不正です。');
        return stateFromDocument(parsed);
      }

      const now = new Date().toISOString();
      const migrated = migrateLocalUserPlanningContextSnapshotV1(localSnapshot);
      const snapshot = { ...migrated, updatedAt: now };
      const created = cloudDocument({ ownerId, revision: 1, snapshot, now });
      transaction.set(ref, created);
      return stateFromDocument(created);
    });
  }

  async upsertInferredRecords(
    ownerId: string,
    records: readonly UserPlanningContextRecordV1[],
  ): Promise<UserPlanningContextRepositoryStateV1> {
    if (records.length === 0) {
      throw new Error('同期する長期記憶がありません。');
    }
    return runTransaction(this.db, async (transaction) => {
      const ref = this.ref(ownerId);
      const remote = await transaction.get(ref);
      const parsed = remote.exists() ? parseCloudDocument(remote.data(), ownerId) : null;
      if (remote.exists() && !parsed) throw new Error('共有されている長期記憶の形式が不正です。');
      const current = parsed?.snapshot ?? {
        version: USER_PLANNING_CONTEXT_STORAGE_VERSION,
        ownerId,
        records: [],
        updatedAt: new Date(0).toISOString(),
      };
      const now = new Date().toISOString();
      const snapshot = mergeInferredUserPlanningContextRecordsV1({ snapshot: current, records, now });
      const next = cloudDocument({
        ownerId,
        revision: (parsed?.revision ?? 0) + 1,
        snapshot,
        now,
      });
      transaction.set(ref, next);
      return stateFromDocument(next);
    });
  }

  async saveUserConfirmedRecord(
    ownerId: string,
    record: UserPlanningContextRecordV1,
    previousRecordId?: string | null,
  ): Promise<UserPlanningContextRepositoryStateV1> {
    return runTransaction(this.db, async (transaction) => {
      const ref = this.ref(ownerId);
      const remote = await transaction.get(ref);
      const parsed = remote.exists() ? parseCloudDocument(remote.data(), ownerId) : null;
      if (remote.exists() && !parsed) throw new Error('共有されている長期記憶の形式が不正です。');
      const current = parsed?.snapshot ?? {
        version: USER_PLANNING_CONTEXT_STORAGE_VERSION,
        ownerId,
        records: [],
        updatedAt: new Date(0).toISOString(),
      };
      const now = new Date().toISOString();
      const snapshot = replaceWithUserConfirmedContextRecordV1({
        snapshot: current,
        record,
        previousRecordId,
        now,
      });
      const next = cloudDocument({
        ownerId,
        revision: (parsed?.revision ?? 0) + 1,
        snapshot,
        now,
      });
      transaction.set(ref, next);
      return stateFromDocument(next);
    });
  }

  async removeRecord(
    ownerId: string,
    recordId: string,
  ): Promise<UserPlanningContextRepositoryStateV1> {
    return runTransaction(this.db, async (transaction) => {
      const ref = this.ref(ownerId);
      const remote = await transaction.get(ref);
      if (!remote.exists()) throw new Error('共有されている長期記憶が見つかりません。');
      const parsed = parseCloudDocument(remote.data(), ownerId);
      if (!parsed) throw new Error('共有されている長期記憶の形式が不正です。');
      const now = new Date().toISOString();
      const snapshot = removeUserPlanningContextRecordFromSnapshotV1({
        snapshot: parsed.snapshot,
        recordId,
        now,
      });
      const next = cloudDocument({ ownerId, revision: parsed.revision + 1, snapshot, now });
      transaction.set(ref, next);
      return stateFromDocument(next);
    });
  }

  subscribe(
    ownerId: string,
    onChange: (state: UserPlanningContextRepositoryStateV1) => void,
    onError: (error: Error) => void,
  ): Unsubscribe {
    return onSnapshot(
      this.ref(ownerId),
      (snapshot) => {
        if (!snapshot.exists()) return;
        const parsed = parseCloudDocument(snapshot.data(), ownerId);
        if (!parsed) {
          onError(new Error('共有されている長期記憶の形式が不正です。'));
          return;
        }
        onChange(stateFromDocument(parsed));
      },
      (error) => onError(error instanceof Error ? error : new Error('長期記憶の同期に失敗しました。')),
    );
  }
}

class LocalOnlyUserPlanningContextRepositoryV1 implements UserPlanningContextRepositoryV1 {
  async initialize(
    _ownerId: string,
    localSnapshot: UserPlanningContextSnapshotV1,
  ): Promise<UserPlanningContextRepositoryStateV1> {
    return { snapshot: localSnapshot, revision: 0, shared: false };
  }

  async upsertInferredRecords(): Promise<UserPlanningContextRepositoryStateV1> {
    throw new Error('長期記憶のクラウド同期を利用できません。');
  }

  async saveUserConfirmedRecord(): Promise<UserPlanningContextRepositoryStateV1> {
    throw new Error('長期記憶のクラウド同期を利用できません。');
  }

  async removeRecord(): Promise<UserPlanningContextRepositoryStateV1> {
    throw new Error('長期記憶のクラウド同期を利用できません。');
  }

  subscribe(): Unsubscribe {
    return () => undefined;
  }
}

let repository: UserPlanningContextRepositoryV1 | null = null;

export function getUserPlanningContextRepositoryV1(): UserPlanningContextRepositoryV1 {
  if (repository) return repository;
  const db = getFirestoreDb();
  repository = db
    ? new FirestoreUserPlanningContextRepositoryV1(db)
    : new LocalOnlyUserPlanningContextRepositoryV1();
  return repository;
}

export function resetUserPlanningContextRepositoryForTestV1(): void {
  repository = null;
}
