import { describe, expect, it } from 'vitest';
import { ProductObservabilityRetentionService } from './productObservabilityRetention';

type Row = Record<string, unknown> & {
  id: string;
  documentName: string;
};

class MemoryRetentionFirestore {
  readonly rows = new Map<string, Row[]>();
  readonly deleted: string[] = [];
  commitFails = false;
  readonly queries: Array<{ collection: string; limit: number }> = [];
  afterQuery: ((collection: string, limit: number) => void) | null = null;

  add(collection: string, id: string, expireAt: string): void {
    const current = this.rows.get(collection) ?? [];
    current.push({
      id,
      expireAt,
      documentName: `projects/test/databases/(default)/documents/${collection}/${id}`,
    });
    current.sort((left, right) =>
      String(left.expireAt).localeCompare(String(right.expireAt))
      || left.documentName.localeCompare(right.documentName));
    this.rows.set(collection, current);
  }

  async queryDocumentsAfter(params: {
    collection: string;
    limit?: number;
  }): Promise<Row[]> {
    const limit = params.limit ?? 100;
    this.queries.push({ collection: params.collection, limit });
    const result = (this.rows.get(params.collection) ?? [])
      .slice(0, limit)
      .map((row) => ({ ...row }));
    this.afterQuery?.(params.collection, limit);
    return result;
  }

  async commitWrites(
    writes: readonly Array<{ collection: string; id: string; delete: true }>,
  ): Promise<void> {
    if (this.commitFails) throw new Error('injected bulk delete failure');
    for (const { collection, id } of writes) {
      this.deleted.push(`${collection}/${id}`);
      this.rows.set(
        collection,
        (this.rows.get(collection) ?? []).filter((row) => row.id !== id),
      );
    }
  }
}

function service(firestore: MemoryRetentionFirestore): ProductObservabilityRetentionService {
  return new ProductObservabilityRetentionService(
    {
      FIREBASE_PROJECT_ID: 'test',
      FIREBASE_SERVICE_ACCOUNT_EMAIL: 'service@example.com',
      FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused',
    },
    firestore as never,
    () => new Date('2026-08-28T12:00:00.000Z'),
  );
}

describe('ProductObservabilityRetentionService', () => {
  it('deletes only the expired ordered prefix from retained observability collections', async () => {
    const firestore = new MemoryRetentionFirestore();
    firestore.add('observability_events', 'expired-event', '2026-08-28T11:00:00.000Z');
    firestore.add('observability_events', 'future-event', '2026-08-29T11:00:00.000Z');
    firestore.add('observability_actor_day', 'expired-actor', '2026-08-27T11:00:00.000Z');
    firestore.add('observability_daily_rollups', 'future-rollup', '2026-08-30T11:00:00.000Z');
    firestore.add(
      'observability_active_user_windows',
      'expired-window',
      '2026-08-28T10:00:00.000Z',
    );

    const result = await service(firestore).runBatch(100);

    expect(result.deleted).toBe(3);
    expect(result.hasMore).toBe(false);
    expect(firestore.deleted).toEqual([
      'observability_events/expired-event',
      'observability_actor_day/expired-actor',
      'observability_active_user_windows/expired-window',
    ]);
  });

  it('reports more work when an entire bounded page is expired', async () => {
    const firestore = new MemoryRetentionFirestore();
    firestore.add('observability_events', 'expired-1', '2026-08-27T10:00:00.000Z');
    firestore.add('observability_events', 'expired-2', '2026-08-27T11:00:00.000Z');
    firestore.add('observability_events', 'expired-3', '2026-08-27T12:00:00.000Z');

    const result = await service(firestore).runBatch(2);

    expect(result.deleted).toBe(2);
    expect(result.hasMore).toBe(true);
  });

  it('leaves every expired document retryable when the bulk delete fails', async () => {
    const firestore = new MemoryRetentionFirestore();
    firestore.add('observability_events', 'expired-1', '2026-08-27T10:00:00.000Z');
    firestore.add('observability_actor_day', 'expired-2', '2026-08-27T11:00:00.000Z');
    firestore.commitFails = true;

    await expect(service(firestore).runBatch(100))
      .rejects.toThrow('injected bulk delete failure');

    expect(firestore.deleted).toEqual([]);
    expect(firestore.rows.get('observability_events')).toHaveLength(1);
    expect(firestore.rows.get('observability_actor_day')).toHaveLength(1);
  });

  it('reads only one retained document from each collection on every idle invocation', async () => {
    const firestore = new MemoryRetentionFirestore();
    const collections = ['observability_events', 'observability_actor_day',
      'observability_daily_rollups', 'observability_active_user_windows'];
    for (const collection of collections) {
      for (let index = 0; index < 100; index += 1) {
        firestore.add(collection, `retained-${index}`, '2026-08-30T11:00:00.000Z');
      }
    }
    const retention = service(firestore);

    expect(await retention.runBatch()).toEqual({ deleted: 0, hasMore: false });
    expect(await retention.runBatch()).toEqual({ deleted: 0, hasMore: false });

    expect(firestore.queries).toEqual([...collections, ...collections]
      .map((collection) => ({ collection, limit: 1 })));
    expect(firestore.deleted).toEqual([]);
  });

  it.each(['removed', 'retained', 'earlier-expired', 'malformed'] as const)(
    're-reads the full page when an expired gate becomes %s before deletion', async (change) => {
      const firestore = new MemoryRetentionFirestore();
      const collection = 'observability_events';
      firestore.add(collection, 'gate', '2026-08-28T11:00:00.000Z');
      firestore.afterQuery = (queriedCollection, limit) => {
        if (queriedCollection !== collection || limit !== 1) return;
        firestore.afterQuery = null;
        if (change === 'removed') firestore.rows.set(collection, []);
        if (change === 'retained') firestore.rows.get(collection)![0].expireAt = '2026-08-29T11:00:00.000Z';
        if (change === 'earlier-expired') firestore.add(collection, 'earlier', '2026-08-27T11:00:00.000Z');
        if (change === 'malformed') firestore.rows.get(collection)!.unshift({
          id: 'bad', documentName: 'projects/test/databases/(default)/documents/observability_events/bad',
          expireAt: null,
        });
      };

      const result = await service(firestore).runBatch();

      expect(firestore.queries.filter((query) => query.collection === collection)
        .map((query) => query.limit)).toEqual([1, 100]);
      expect(result).toEqual({ deleted: change === 'earlier-expired' ? 2 : 0, hasMore: false });
      expect(firestore.deleted).toEqual(change === 'earlier-expired'
        ? ['observability_events/earlier', 'observability_events/gate'] : []);
    },
  );

  it('defers an expired insertion after a negative gate to the next invocation', async () => {
    const firestore = new MemoryRetentionFirestore();
    firestore.add('observability_events', 'retained', '2026-08-29T11:00:00.000Z');
    firestore.afterQuery = (collection) => {
      if (collection !== 'observability_events') return;
      firestore.afterQuery = null;
      firestore.add(collection, 'new-expired', '2026-08-27T11:00:00.000Z');
    };
    const retention = service(firestore);

    expect(await retention.runBatch()).toEqual({ deleted: 0, hasMore: false });
    expect(firestore.deleted).toEqual([]);
    expect(await retention.runBatch()).toEqual({ deleted: 1, hasMore: false });
    expect(firestore.deleted).toEqual(['observability_events/new-expired']);
    expect(firestore.rows.get('observability_events')?.map((row) => row.id)).toEqual(['retained']);
  });

  it.each([null, 12, false, 'not-a-date'])(
    'preserves the existing stop at a nonexpired or malformed first value %s', async (expireAt) => {
      const firestore = new MemoryRetentionFirestore();
      firestore.rows.set('observability_events', [{
        id: 'first', documentName: 'projects/test/databases/(default)/documents/observability_events/first',
        expireAt,
      }, {
        id: 'later', documentName: 'projects/test/databases/(default)/documents/observability_events/later',
        expireAt: '2026-08-27T11:00:00.000Z',
      }]);

      expect(await service(firestore).runBatch()).toEqual({ deleted: 0, hasMore: false });

      expect(firestore.deleted).toEqual([]);
      expect(firestore.queries.every((query) => query.limit === 1)).toBe(true);
    },
  );

  it('keeps exact-cutoff expiry and the existing string comparison contract', async () => {
    const firestore = new MemoryRetentionFirestore();
    firestore.add('observability_events', 'cutoff', '2026-08-28T12:00:00.000Z');
    firestore.add('observability_events', 'future', '2026-08-28T12:00:00.001Z');

    expect(await service(firestore).runBatch()).toEqual({ deleted: 1, hasMore: false });
    expect(firestore.deleted).toEqual(['observability_events/cutoff']);
  });

});
