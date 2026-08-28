import { describe, expect, it } from 'vitest';
import { ProductObservabilityRetentionService } from './productObservabilityRetention';

type Row = Record<string, unknown> & {
  id: string;
  documentName: string;
};

class MemoryRetentionFirestore {
  readonly rows = new Map<string, Row[]>();
  readonly deleted: string[] = [];

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
    return (this.rows.get(params.collection) ?? [])
      .slice(0, params.limit ?? 100)
      .map((row) => ({ ...row }));
  }

  async deleteDocument(collection: string, id: string): Promise<void> {
    this.deleted.push(`${collection}/${id}`);
    this.rows.set(
      collection,
      (this.rows.get(collection) ?? []).filter((row) => row.id !== id),
    );
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

    const result = await service(firestore).runBatch(100);

    expect(result.deleted).toBe(2);
    expect(result.hasMore).toBe(false);
    expect(firestore.deleted).toEqual([
      'observability_events/expired-event',
      'observability_actor_day/expired-actor',
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
});
