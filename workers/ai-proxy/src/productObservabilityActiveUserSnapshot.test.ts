import { describe, expect, it } from 'vitest';
import type { ObservabilityActorDay } from '../../../shared/productObservabilityReadModel';
import { ProductObservabilityActiveUserSnapshotService } from './productObservabilityActiveUserSnapshot';

type StoredDocument = Record<string, unknown>;
type Row = StoredDocument & { id: string; documentName: string };

class MemorySnapshotFirestore {
  readonly documents = new Map<string, StoredDocument>();
  readonly actorDays: Row[] = [];
  readonly writes: string[] = [];
  readonly queriedDates: string[] = [];

  private key(collection: string, id: string): string {
    return `${collection}/${id}`;
  }

  addActorDay(id: string, value: ObservabilityActorDay): void {
    this.actorDays.push({
      ...value,
      id,
      documentName: `projects/test/databases/(default)/documents/observability_actor_day/${id}`,
    });
    this.actorDays.sort((left, right) =>
      String(left.localDate).localeCompare(String(right.localDate))
      || left.documentName.localeCompare(right.documentName));
  }

  async getDocument(collection: string, id: string): Promise<StoredDocument | null> {
    const value = this.documents.get(this.key(collection, id));
    return value ? { ...value, id } : null;
  }

  async setDocument(collection: string, id: string, value: StoredDocument): Promise<void> {
    this.documents.set(this.key(collection, id), { ...value });
    this.writes.push(`${collection}/${id}`);
  }

  async queryDocumentsAfter(params: {
    filters?: Array<{ field: string; value: string }>;
    cursor?: { orderedValue: string; documentName: string } | null;
    limit?: number;
  }): Promise<Row[]> {
    const localDate = params.filters?.find((filter) => filter.field === 'localDate')?.value;
    if (localDate && !params.cursor) this.queriedDates.push(localDate);
    const rows = this.actorDays.filter((row) => {
      if (params.filters?.some((filter) => String(row[filter.field]) !== filter.value)) return false;
      if (!params.cursor) return true;
      const rowDate = String(row.localDate);
      return rowDate > params.cursor.orderedValue
        || (rowDate === params.cursor.orderedValue
          && row.documentName > params.cursor.documentName);
    });
    return rows.slice(0, params.limit ?? 500).map((row) => ({ ...row }));
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

describe('ProductObservabilityActiveUserSnapshotService', () => {
  it('materializes exact today, 7-day, and 30-day distinct actor counts', async () => {
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

    const snapshot = await service(firestore).refresh('production', '2026-08-28');

    expect(snapshot.today).toBe(1);
    expect(snapshot.last7Days).toBe(2);
    expect(snapshot.last30Days).toBe(3);
    expect(snapshot.environment).toBe('production');
    expect(snapshot.reportingTimeZone).toBe('Asia/Tokyo');
    expect(new Set(firestore.queriedDates).size).toBe(30);
  });

  it('reuses each actor-day scan while repairing overlapping historical windows', async () => {
    const firestore = new MemorySnapshotFirestore();
    firestore.addActorDay('late-a', actorDay({
      localDate: '2026-08-27',
      actorSubjectId: 'actor-aaaaaaaa',
    }));

    const snapshots = await service(firestore).refreshAffected([{
      environment: 'production',
      localDate: '2026-08-27',
      revision: 1,
    }]);

    expect(snapshots.map((snapshot) => snapshot.asOfDate)).toEqual([
      '2026-08-27',
      '2026-08-28',
    ]);
    expect(firestore.writes).toEqual([
      'observability_active_user_windows/production:2026-08-27',
      'observability_active_user_windows/production:2026-08-28',
    ]);
    expect(firestore.queriedDates).toHaveLength(31);
    expect(new Set(firestore.queriedDates).size).toBe(31);
  });

  it('repairs preview windows without mixing preview actors into production', async () => {
    const firestore = new MemorySnapshotFirestore();
    firestore.documents.set('observability_active_user_windows/production:2026-08-28', {
      schemaVersion: 1,
      environment: 'production',
      asOfDate: '2026-08-28',
    });
    firestore.addActorDay('prod-a', actorDay({
      localDate: '2026-08-28',
      actorSubjectId: 'actor-aaaaaaaa',
    }));
    firestore.addActorDay('preview-b', actorDay({
      localDate: '2026-08-28',
      actorSubjectId: 'actor-bbbbbbbb',
      environment: 'preview',
    }));

    const snapshots = await service(firestore).refreshAffected([{
      environment: 'preview',
      localDate: '2026-08-28',
      revision: 1,
    }]);

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      environment: 'preview',
      asOfDate: '2026-08-28',
      today: 1,
    });
    expect(firestore.writes).toEqual([
      'observability_active_user_windows/preview:2026-08-28',
    ]);
    expect(new Set(firestore.queriedDates).size).toBe(30);
  });

  it('does no actor scan when current snapshot exists and no actor-day changed', async () => {
    const firestore = new MemorySnapshotFirestore();
    firestore.documents.set('observability_active_user_windows/production:2026-08-28', {
      schemaVersion: 1,
      environment: 'production',
      asOfDate: '2026-08-28',
    });

    const snapshots = await service(firestore).refreshAffected([]);

    expect(snapshots).toEqual([]);
    expect(firestore.writes).toEqual([]);
    expect(firestore.queriedDates).toEqual([]);
  });
});
