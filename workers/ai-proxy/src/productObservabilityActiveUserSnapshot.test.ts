import { describe, expect, it } from 'vitest';
import type {
  ObservabilityActiveUserDirtySource,
  ObservabilityActorDay,
} from '../../../shared/productObservabilityReadModel';
import {
  FirestoreTransactionConflictError,
  type FirestoreOrderedCursor,
  type FirestoreOrderedDocument,
} from './firestoreServiceAccountClient';
import {
  ACTIVE_USER_SNAPSHOT_ACCUMULATOR_COLLECTION,
  ACTIVE_USER_SNAPSHOT_JOB_COLLECTION,
  ACTIVE_USER_SNAPSHOT_JOB_ID,
  ACTIVE_USER_SNAPSHOT_MAX_PAGE_READS,
  ACTIVE_USER_SNAPSHOT_MAX_PUBLISH_TRANSACTION_BYTES,
  ACTIVE_USER_SNAPSHOT_MAX_SHARD_STORAGE_BYTES,
  FIRESTORE_TRANSACTION_LIMIT_BYTES,
  ProductObservabilityActiveUserSnapshotService,
  estimateActiveUserSnapshotPublishTransactionStorageBytes,
} from './productObservabilityActiveUserSnapshot';

type StoredDocument = Record<string, unknown>;
type Row = StoredDocument & { id: string; documentName: string };

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

class MemorySnapshotFirestore {
  readonly documents = new Map<string, StoredDocument>();
  readonly actorDays: Row[] = [];
  readonly queriedDates: string[] = [];
  transactionSequence = 0;
  conflictNextCommit = false;
  changeStateBeforeTransactionalRead = false;
  batchGetCallCount = 0;
  rollbackCount = 0;

  private key(collection: string, id: string): string {
    return `${collection}/${id}`;
  }

  addActorDay(id: string, value: ObservabilityActorDay): void {
    this.actorDays.push({
      ...value,
      id,
      documentName: `projects/test/databases/(default)/documents/observability_actor_day/${id}`,
    });
  }

  async beginTransaction(): Promise<string> {
    this.transactionSequence += 1;
    return `tx-${this.transactionSequence}`;
  }

  async batchGetDocumentKeys(
    keys: readonly Array<{ collection: string; id: string }>,
    transaction?: string,
  ): Promise<Array<StoredDocument | null>> {
    this.batchGetCallCount += 1;
    const values = keys.map(({ collection, id }) => {
      const value = this.documents.get(this.key(collection, id));
      return value ? { ...copy(value), id } : null;
    });
    if (this.changeStateBeforeTransactionalRead && transaction) {
      values[0] = { id: ACTIVE_USER_SNAPSHOT_JOB_ID, concurrentRevision: 1 };
    }
    return values;
  }

  async queryDocumentsAfter(params: {
    filters?: Array<{ field: string; value: string }>;
    cursor?: FirestoreOrderedCursor | null;
    limit?: number;
  }): Promise<FirestoreOrderedDocument[]> {
    const localDate = params.filters?.find((filter) => filter.field === 'localDate')?.value;
    if (localDate) this.queriedDates.push(localDate);
    const rows = this.actorDays.filter((row) => {
      if (params.filters?.some((filter) => String(row[filter.field]) !== filter.value)) return false;
      if (!params.cursor) return true;
      const rowDate = String(row.localDate);
      return rowDate > params.cursor.orderedValue
        || (rowDate === params.cursor.orderedValue
          && row.documentName > params.cursor.documentName);
    });
    return rows.slice(0, params.limit ?? 500).map(copy);
  }

  async commitTransaction(
    _transaction: string,
    writes: readonly Array<{ collection: string; id: string; value: StoredDocument }>,
    deletes: readonly Array<{ collection: string; id: string }> = [],
  ): Promise<void> {
    if (this.conflictNextCommit) {
      this.conflictNextCommit = false;
      throw new FirestoreTransactionConflictError(409);
    }
    writes.forEach(({ collection, id, value }) => {
      this.documents.set(this.key(collection, id), copy(value));
    });
    deletes.forEach(({ collection, id }) => {
      this.documents.delete(this.key(collection, id));
    });
  }

  async rollbackTransaction(_transaction: string): Promise<void> {
    this.rollbackCount += 1;
  }
}

function actorDay(params: {
  localDate: string;
  actorSubjectId: string;
  environment?: 'production' | 'preview';
}): ObservabilityActorDay {
  return {
    schemaVersion: 1,
    environment: params.environment ?? 'production',
    localDate: params.localDate,
    actorSubjectId: params.actorSubjectId,
    firstOccurredAt: `${params.localDate}T00:00:00.000Z`,
    lastOccurredAt: `${params.localDate}T00:00:00.000Z`,
    eventCount: 1,
    productActivityObserved: true,
    aiRequestObserved: false,
    planningObserved: false,
    updatedAt: `${params.localDate}T00:00:01.000Z`,
    expireAt: '2027-10-01T00:00:00.000Z',
  };
}

function service(firestore: MemorySnapshotFirestore): ProductObservabilityActiveUserSnapshotService {
  return new ProductObservabilityActiveUserSnapshotService(
    {
      FIREBASE_PROJECT_ID: 'test',
      FIREBASE_SERVICE_ACCOUNT_EMAIL: 'service@example.com',
      FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused',
      ENVIRONMENT: 'production',
    },
    firestore as never,
    () => new Date('2026-08-28T12:00:00.000Z'),
  );
}

const TODAY_SOURCE: ObservabilityActiveUserDirtySource = {
  environment: 'production',
  localDate: '2026-08-28',
  revision: 1,
};

function encodedActorFlags(actorSubjectIds: readonly string[], flags = 4): string {
  return [...actorSubjectIds]
    .sort()
    .map((actorSubjectId) => `${actorSubjectId}:${flags}`)
    .join('\n');
}

function longActorSubjectId(index: number): string {
  return `actor-${String(index).padStart(8, '0')}${'x'.repeat(152)}`;
}

function seedCompleteAccumulator(
  firestore: MemorySnapshotFirestore,
  actorCount: number,
): Record<string, unknown>[] {
  const taskKey = 'production:2026-08-28:1:2026-08-28';
  firestore.documents.set(
    `${ACTIVE_USER_SNAPSHOT_JOB_COLLECTION}/${ACTIVE_USER_SNAPSHOT_JOB_ID}`,
    {
      schemaVersion: 1,
      status: 'scanning',
      taskKey,
      source: TODAY_SOURCE,
      environment: 'production',
      targetDate: '2026-08-28',
      scanDateIndex: 30,
      cursor: null,
      updatedAt: '2026-08-28T11:00:00.000Z',
    },
  );
  const actorsByShard = Array.from({ length: 64 }, () => [] as string[]);
  for (let index = 0; index < actorCount; index += 1) {
    actorsByShard[index % actorsByShard.length].push(longActorSubjectId(index));
  }
  return actorsByShard.map((actors, shard) => {
    const value = {
      schemaVersion: 1,
      taskKey,
      shard,
      actorFlagsEncoding: 'actor-flags-lines-v1',
      actorFlags: encodedActorFlags(actors),
      updatedAt: '2026-08-28T11:00:00.000Z',
    };
    firestore.documents.set(
      `${ACTIVE_USER_SNAPSHOT_ACCUMULATOR_COLLECTION}/main:${String(shard).padStart(2, '0')}`,
      value,
    );
    return value;
  });
}

function publishEstimate(
  accumulatorDocuments: readonly Record<string, unknown>[],
): number {
  return estimateActiveUserSnapshotPublishTransactionStorageBytes({
    accumulatorDocuments,
    snapshot: {
      schemaVersion: 1,
      environment: 'production',
      asOfDate: '2026-08-28',
      reportingTimeZone: 'Asia/Tokyo',
      today: 0,
      last7Days: 0,
      last30Days: 0,
      updatedAt: '2026-08-28T12:00:00.000Z',
      expireAt: '2027-10-02T12:00:00.000Z',
    },
    nextJob: {
      schemaVersion: 1,
      status: 'idle',
      taskKey: null,
      source: null,
      environment: null,
      targetDate: null,
      scanDateIndex: 0,
      cursor: null,
      updatedAt: '2026-08-28T12:00:00.000Z',
    },
  });
}

describe('ProductObservabilityActiveUserSnapshotService', () => {
  it('publishes exact counts only after the complete 30-day scan', async () => {
    const firestore = new MemorySnapshotFirestore();
    firestore.addActorDay('today-a', actorDay({
      localDate: '2026-08-28',
      actorSubjectId: 'actor-aaaaaaaa',
    }));
    firestore.addActorDay('yesterday-a', actorDay({
      localDate: '2026-08-27',
      actorSubjectId: 'actor-aaaaaaaa',
    }));
    firestore.addActorDay('week-b', actorDay({
      localDate: '2026-08-22',
      actorSubjectId: 'actor-bbbbbbbb',
    }));
    firestore.addActorDay('month-c', actorDay({
      localDate: '2026-08-21',
      actorSubjectId: 'actor-cccccccc',
    }));
    firestore.addActorDay('preview-d', actorDay({
      localDate: '2026-08-28',
      actorSubjectId: 'actor-dddddddd',
      environment: 'preview',
    }));

    const result = await service(firestore).runBatch([TODAY_SOURCE]);

    expect(result).toMatchObject({
      pageReads: 30,
      published: true,
      completedSource: TODAY_SOURCE,
    });
    expect(firestore.documents.get(
      'observability_active_user_windows/production:2026-08-28',
    )).toMatchObject({
      today: 1,
      last7Days: 2,
      last30Days: 3,
      reportingTimeZone: 'Asia/Tokyo',
    });
    expect(firestore.documents.get(
      `${ACTIVE_USER_SNAPSHOT_JOB_COLLECTION}/${ACTIVE_USER_SNAPSHOT_JOB_ID}`,
    )).toMatchObject({ status: 'idle', source: null });
  });

  it('checkpoints a large page backlog without publishing partial counts and resumes exactly', async () => {
    const firestore = new MemorySnapshotFirestore();
    for (let index = 0; index < 18_001; index += 1) {
      firestore.addActorDay(`actor-day-${String(index).padStart(8, '0')}`, actorDay({
        localDate: '2026-07-30',
        actorSubjectId: `actor-${String(index).padStart(8, '0')}`,
      }));
    }
    const snapshots = service(firestore);

    const first = await snapshots.runBatch([TODAY_SOURCE]);

    expect(first).toMatchObject({
      pageReads: ACTIVE_USER_SNAPSHOT_MAX_PAGE_READS,
      published: false,
      hasMore: true,
      completedSource: null,
    });
    expect(firestore.documents.has(
      'observability_active_user_windows/production:2026-08-28',
    )).toBe(false);
    expect([...firestore.documents.keys()].some((key) =>
      key.startsWith(`${ACTIVE_USER_SNAPSHOT_ACCUMULATOR_COLLECTION}/`))).toBe(true);
    const accumulatorBytes = [...firestore.documents.entries()]
      .filter(([key]) => key.startsWith(`${ACTIVE_USER_SNAPSHOT_ACCUMULATOR_COLLECTION}/`))
      .map(([, value]) => new TextEncoder().encode(JSON.stringify(value)).byteLength);
    expect(Math.max(...accumulatorBytes)).toBeLessThan(
      ACTIVE_USER_SNAPSHOT_MAX_SHARD_STORAGE_BYTES,
    );
    const accumulatorDocuments = [...firestore.documents.entries()]
      .filter(([key]) => key.startsWith(`${ACTIVE_USER_SNAPSHOT_ACCUMULATOR_COLLECTION}/`))
      .map(([, value]) => value);
    expect(accumulatorDocuments.every((value) =>
      typeof value.actorFlags === 'string' && !('actors' in value))).toBe(true);

    const second = await snapshots.runBatch([TODAY_SOURCE]);

    expect(second.published).toBe(true);
    expect(firestore.documents.get(
      'observability_active_user_windows/production:2026-08-28',
    )).toMatchObject({
      today: 0,
      last7Days: 0,
      last30Days: 18_001,
    });
    expect([...firestore.documents.keys()].some((key) =>
      key.startsWith(`${ACTIVE_USER_SNAPSHOT_ACCUMULATOR_COLLECTION}/`))).toBe(false);
  });

  it('advances historical targets one at a time and exposes the source only after the last target', async () => {
    const firestore = new MemorySnapshotFirestore();
    const source: ObservabilityActiveUserDirtySource = {
      environment: 'preview',
      localDate: '2026-08-27',
      revision: 3,
    };
    const snapshots = service(firestore);

    const first = await snapshots.runBatch([source]);
    const second = await snapshots.runBatch([source]);

    expect(first).toMatchObject({ published: true, completedSource: null, hasMore: true });
    expect(second).toMatchObject({ published: true, completedSource: source, hasMore: true });
    expect(firestore.documents.has(
      'observability_active_user_windows/preview:2026-08-27',
    )).toBe(true);
    expect(firestore.documents.has(
      'observability_active_user_windows/preview:2026-08-28',
    )).toBe(true);
  });

  it('returns to idle so a later dirty source can safely reuse the same revision number', async () => {
    const firestore = new MemorySnapshotFirestore();
    const snapshots = service(firestore);
    const first = await snapshots.runBatch([TODAY_SOURCE]);
    firestore.addActorDay('after-clear', actorDay({
      localDate: '2026-08-28',
      actorSubjectId: 'actor-afterclear',
    }));

    const second = await snapshots.runBatch([TODAY_SOURCE]);

    expect(first.completedSource).toEqual(TODAY_SOURCE);
    expect(second.completedSource).toEqual(TODAY_SOURCE);
    expect(firestore.documents.get(
      'observability_active_user_windows/production:2026-08-28',
    )).toMatchObject({ today: 1, last7Days: 1, last30Days: 1 });
    expect(firestore.documents.get(
      `${ACTIVE_USER_SNAPSHOT_JOB_COLLECTION}/${ACTIVE_USER_SNAPSHOT_JOB_ID}`,
    )).toMatchObject({ source: null, status: 'idle' });
  });

  it('leaves no published or checkpoint state when the transaction conflicts', async () => {
    const firestore = new MemorySnapshotFirestore();
    firestore.conflictNextCommit = true;

    await expect(service(firestore).runBatch([TODAY_SOURCE]))
      .rejects.toBeInstanceOf(FirestoreTransactionConflictError);

    expect(firestore.documents.size).toBe(0);
    expect(firestore.rollbackCount).toBe(1);
    await expect(service(firestore).runBatch([TODAY_SOURCE])).resolves.toMatchObject({
      published: true,
    });
  });

  it('does not publish when another invocation changes job state during the scan', async () => {
    const firestore = new MemorySnapshotFirestore();
    firestore.changeStateBeforeTransactionalRead = true;

    const result = await service(firestore).runBatch([TODAY_SOURCE]);

    expect(result).toMatchObject({ published: false, hasMore: true });
    expect(firestore.documents.has(
      'observability_active_user_windows/production:2026-08-28',
    )).toBe(false);
    expect(firestore.rollbackCount).toBe(1);
    expect(firestore.batchGetCallCount).toBe(2);
  });

  it('fails before publish when one accumulator shard would exceed its document bound', async () => {
    const firestore = new MemorySnapshotFirestore();
    const taskKey = 'production:2026-08-28:1:2026-08-28';
    firestore.documents.set(
      `${ACTIVE_USER_SNAPSHOT_JOB_COLLECTION}/${ACTIVE_USER_SNAPSHOT_JOB_ID}`,
      {
        schemaVersion: 1,
        status: 'scanning',
        taskKey,
        source: TODAY_SOURCE,
        environment: 'production',
        targetDate: '2026-08-28',
        scanDateIndex: 0,
        cursor: null,
        updatedAt: '2026-08-28T11:00:00.000Z',
      },
    );
    firestore.documents.set(
      `${ACTIVE_USER_SNAPSHOT_ACCUMULATOR_COLLECTION}/main:00`,
      {
        schemaVersion: 1,
        taskKey,
        shard: 0,
        actorFlagsEncoding: 'actor-flags-lines-v1',
        actorFlags: encodedActorFlags(Array.from(
          { length: 3_000 },
          (_, index) => `actor-${String(index).padStart(8, '0')}${'x'.repeat(145)}`,
        )),
        updatedAt: '2026-08-28T11:00:00.000Z',
      },
    );

    await expect(service(firestore).runBatch([TODAY_SOURCE]))
      .rejects.toThrow('active_user_snapshot_accumulator_shard_overflow');
    expect(firestore.documents.has(
      'observability_active_user_windows/production:2026-08-28',
    )).toBe(false);
  });

  it('keeps a near-limit publish below 10 MiB and rejects an oversized publish first', async () => {
    const nearLimitFirestore = new MemorySnapshotFirestore();
    const nearLimitDocuments = seedCompleteAccumulator(nearLimitFirestore, 43_000);
    const nearLimitEstimate = publishEstimate(nearLimitDocuments);

    expect(nearLimitEstimate).toBeLessThanOrEqual(
      ACTIVE_USER_SNAPSHOT_MAX_PUBLISH_TRANSACTION_BYTES,
    );
    expect(nearLimitEstimate).toBeGreaterThan(
      ACTIVE_USER_SNAPSHOT_MAX_PUBLISH_TRANSACTION_BYTES - (2 * 1024 * 1024),
    );
    expect(nearLimitEstimate).toBeLessThan(FIRESTORE_TRANSACTION_LIMIT_BYTES);
    await expect(service(nearLimitFirestore).runBatch([TODAY_SOURCE])).resolves.toMatchObject({
      published: true,
    });

    const oversizedFirestore = new MemorySnapshotFirestore();
    const oversizedDocuments = seedCompleteAccumulator(oversizedFirestore, 50_000);
    expect(publishEstimate(oversizedDocuments)).toBeGreaterThan(
      ACTIVE_USER_SNAPSHOT_MAX_PUBLISH_TRANSACTION_BYTES,
    );
    await expect(service(oversizedFirestore).runBatch([TODAY_SOURCE]))
      .rejects.toThrow('active_user_snapshot_publish_transaction_overflow');
    expect(oversizedFirestore.documents.has(
      'observability_active_user_windows/production:2026-08-28',
    )).toBe(false);
  });

  it('counts stale persisted shards even when they do not belong to the current job', async () => {
    const firestore = new MemorySnapshotFirestore();
    const staleDocuments = seedCompleteAccumulator(firestore, 50_000);
    staleDocuments.forEach((document) => {
      document.taskKey = 'production:2026-08-27:1:2026-08-27';
    });

    expect(publishEstimate(staleDocuments)).toBeGreaterThan(
      ACTIVE_USER_SNAPSHOT_MAX_PUBLISH_TRANSACTION_BYTES,
    );
    await expect(service(firestore).runBatch([TODAY_SOURCE]))
      .rejects.toThrow('active_user_snapshot_publish_transaction_overflow');
    expect(firestore.documents.has(
      'observability_active_user_windows/production:2026-08-28',
    )).toBe(false);
  });

  it('does no actor scan when the current snapshot exists and no source is dirty', async () => {
    const firestore = new MemorySnapshotFirestore();
    firestore.documents.set('observability_active_user_windows/production:2026-08-28', {
      schemaVersion: 1,
      environment: 'production',
      asOfDate: '2026-08-28',
    });

    const result = await service(firestore).runBatch([]);

    expect(result).toEqual({
      pageReads: 0,
      published: false,
      hasMore: false,
      completedSource: null,
    });
    expect(firestore.queriedDates).toEqual([]);
    expect(firestore.rollbackCount).toBe(0);
  });
});
