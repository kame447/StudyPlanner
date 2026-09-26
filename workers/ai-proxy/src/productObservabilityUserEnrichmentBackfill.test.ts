import { describe, expect, it } from 'vitest';
import type { ObservabilityEnvironment } from '../../../shared/productObservabilityContract';
import {
  FirestoreWriteConflictError,
  type FirestoreBulkDocumentWrite,
  type FirestoreDocumentSnapshot,
  type FirestoreOrderedCursor,
  type FirestoreOrderedDocument,
} from './firestoreServiceAccountClient';
import {
  ProductObservabilityUserEnrichmentBackfillService,
  USER_ENRICHMENT_BACKFILL_BATCH_SIZE,
  USER_ENRICHMENT_BACKFILL_STATE_COLLECTION,
  USER_ENRICHMENT_BACKFILL_STATE_ID,
  userEnrichmentBackfillReady,
} from './productObservabilityUserEnrichmentBackfill';

type Stored = { value: Record<string, unknown>; updateTime: string };

class MemoryFirestore {
  readonly documents = new Map<string, Stored>();
  readonly events = new Map<string, FirestoreOrderedDocument[]>();
  calls = { get: 0, page: 0, count: 0, events: 0, commit: 0 };
  conflictNextCommit = false;
  version = 1;

  private key(collection: string, id: string): string {
    return `${collection}/${id}`;
  }

  addSummary(environment: ObservabilityEnvironment, index: number): void {
    const actorSubjectId = `actor-${String(index).padStart(8, '0')}`;
    this.documents.set(`observability_user_summary_${environment}/${actorSubjectId}`, {
      updateTime: `2026-09-25T00:00:${String(index).padStart(2, '0')}.000000Z`,
      value: {
        schemaVersion: 1,
        actorSubjectId,
        firstActivityAt: '2026-09-01T00:00:00.000Z',
        lastActivityAt: '2026-09-25T00:00:00.000Z',
        firstActivityDate: '2026-09-01',
        lastActivityDate: '2026-09-25',
        eventCount: 1,
        productActivityCount: 1,
        aiRequestCount: 0,
        planningOutcomeCount: 0,
        lastProductAction: 'plan_created',
        lastPlanningOutcome: null,
        updatedAt: '2026-09-25T00:00:00.000Z',
      },
    });
  }

  async getDocumentSnapshot(collection: string, id: string) {
    this.calls.get += 1;
    const stored = this.documents.get(this.key(collection, id));
    if (!stored) return null;
    return {
      id,
      documentName: `projects/test/databases/(default)/documents/${collection}/${id}`,
      updateTime: stored.updateTime,
      value: { ...stored.value },
    } satisfies FirestoreDocumentSnapshot;
  }

  async queryDocumentSnapshotsByNameAfter(params: {
    collection: string;
    cursorDocumentName?: string | null;
    limit?: number;
  }) {
    this.calls.page += 1;
    return [...this.documents.entries()]
      .filter(([key]) => key.startsWith(`${params.collection}/`))
      .map(([key, stored]) => {
        const id = key.slice(params.collection.length + 1);
        return {
          id,
          documentName: `projects/test/databases/(default)/documents/${params.collection}/${id}`,
          updateTime: stored.updateTime,
          value: { ...stored.value },
        };
      })
      .filter((snapshot) => !params.cursorDocumentName
        || snapshot.documentName > params.cursorDocumentName)
      .sort((left, right) => left.documentName.localeCompare(right.documentName))
      .slice(0, params.limit ?? 100);
  }

  async countDocuments() {
    this.calls.count += 1;
    return 2;
  }

  async queryDocumentsAfter(params: {
    filters?: Array<{ field: string; value: string }>;
    cursor?: FirestoreOrderedCursor | null;
    limit?: number;
  }) {
    this.calls.events += 1;
    const actorSubjectId = params.filters?.find((filter) => filter.field === 'actorSubjectId')?.value ?? '';
    const rows = this.events.get(actorSubjectId) ?? [];
    const afterCursor = rows.filter((row) => !params.cursor
      || String(row.occurredAt) < params.cursor.orderedValue
      || (row.occurredAt === params.cursor.orderedValue
        && row.documentName < params.cursor.documentName));
    return afterCursor.slice(0, params.limit ?? 100).map((row) => ({ ...row }));
  }

  async commitWrites(writes: readonly FirestoreBulkDocumentWrite[]) {
    this.calls.commit += 1;
    if (this.conflictNextCommit) {
      this.conflictNextCommit = false;
      throw new FirestoreWriteConflictError(412);
    }
    for (const write of writes) {
      if ('delete' in write) continue;
      const key = this.key(write.collection, write.id);
      const existing = this.documents.get(key);
      if ('updateTime' in (write.currentDocument ?? {})
        && existing?.updateTime !== (write.currentDocument as { updateTime: string }).updateTime) {
        throw new FirestoreWriteConflictError(412);
      }
      if ('exists' in (write.currentDocument ?? {})
        && (write.currentDocument as { exists: boolean }).exists === false
        && existing) {
        throw new FirestoreWriteConflictError(412);
      }
      const value = write.updateMask
        ? { ...(existing?.value ?? {}), ...write.value }
        : { ...write.value };
      this.version += 1;
      this.documents.set(key, {
        value,
        updateTime: `2026-09-25T01:00:${String(this.version).padStart(2, '0')}.000000Z`,
      });
    }
  }
}

function service(firestore: MemoryFirestore) {
  return new ProductObservabilityUserEnrichmentBackfillService(
    {
      FIREBASE_PROJECT_ID: 'test',
      FIREBASE_SERVICE_ACCOUNT_EMAIL: 'service@example.com',
      FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused',
    },
    firestore as never,
    () => new Date('2026-09-25T12:00:00.000Z'),
  );
}

describe('ProductObservabilityUserEnrichmentBackfillService', () => {
  it('processes 17 users in exactly 37 Firestore operations and advances atomically', async () => {
    const firestore = new MemoryFirestore();
    Array.from({ length: USER_ENRICHMENT_BACKFILL_BATCH_SIZE }, (_, index) =>
      firestore.addSummary('production', index));

    const result = await service(firestore).runBatch();

    expect(result).toMatchObject({ processed: 17, conflicted: false });
    expect(firestore.calls).toEqual({ get: 1, page: 1, count: 17, events: 17, commit: 1 });
    expect(Object.values(firestore.calls).reduce((sum, count) => sum + count, 0)).toBe(37);
    expect(firestore.documents.get(
      'observability_user_summary_production/actor-00000000',
    )?.value).toMatchObject({
      userEnrichmentVersion: 1,
      activeDayCount: 2,
      latestErrorAt: null,
      latestErrorCategory: null,
    });
  });

  it('persists and resumes a saturated recent-error cursor without declaring readiness', async () => {
    const firestore = new MemoryFirestore();
    firestore.addSummary('production', 0);
    const actorSubjectId = 'actor-00000000';
    firestore.events.set(actorSubjectId, Array.from({ length: 101 }, (_, index) => ({
      id: `event-${index}`,
      documentName: `projects/test/databases/(default)/documents/observability_events/event-${String(index).padStart(3, '0')}`,
      eventType: 'product_activity',
      occurredAt: index < 100
        ? new Date(Date.UTC(2026, 8, 25, 11, 59, 59) - (index * 1_000)).toISOString()
        : '2026-08-01T00:00:00.000Z',
      payload: { action: 'plan_created' },
    })).sort((left, right) => String(right.occurredAt).localeCompare(String(left.occurredAt))));

    const backfill = service(firestore);
    const first = await backfill.runBatch();
    expect(first.processed).toBe(0);
    expect(first.checkpoint.pendingRecentErrorScan?.actorSubjectId).toBe(actorSubjectId);
    expect(userEnrichmentBackfillReady(first.checkpoint, 'production')).toBe(false);

    const second = await backfill.runBatch();
    expect(second.processed).toBe(1);
    expect(second.checkpoint.pendingRecentErrorScan).toBeNull();
    expect(firestore.documents.get(
      'observability_user_summary_production/actor-00000000',
    )?.value).toMatchObject({ latestErrorAt: null, latestErrorCategory: null });
  });

  it('persists the latest allowlisted typed error without copying its raw payload', async () => {
    const firestore = new MemoryFirestore();
    firestore.addSummary('production', 0);
    firestore.events.set('actor-00000000', [{
      id: 'event-error',
      documentName: 'projects/test/databases/(default)/documents/observability_events/event-error',
      eventType: 'ai_request_metric',
      occurredAt: '2026-09-25T10:00:00.000Z',
      payload: {
        status: 'provider_error',
        errorCategory: 'provider_error',
        rawProviderBody: 'must not be copied',
      },
    }]);

    await service(firestore).runBatch();

    const summary = firestore.documents.get(
      'observability_user_summary_production/actor-00000000',
    )?.value;
    expect(summary).toMatchObject({
      latestErrorAt: '2026-09-25T10:00:00.000Z',
      latestErrorCategory: 'provider_error',
    });
    expect(JSON.stringify(summary)).not.toContain('rawProviderBody');
    expect(JSON.stringify(summary)).not.toContain('must not be copied');
  });

  it('does not advance the checkpoint when a rollup changes a summary watermark', async () => {
    const firestore = new MemoryFirestore();
    firestore.addSummary('production', 0);
    firestore.conflictNextCommit = true;

    const result = await service(firestore).runBatch();

    expect(result.conflicted).toBe(true);
    expect(result.processed).toBe(0);
    expect(firestore.documents.has(
      `${USER_ENRICHMENT_BACKFILL_STATE_COLLECTION}/${USER_ENRICHMENT_BACKFILL_STATE_ID}`,
    )).toBe(false);
    expect(firestore.documents.get(
      'observability_user_summary_production/actor-00000000',
    )?.value).not.toHaveProperty('userEnrichmentVersion');

    const retried = await service(firestore).runBatch();
    expect(retried).toMatchObject({ processed: 1, conflicted: false });
    expect(firestore.documents.get(
      'observability_user_summary_production/actor-00000000',
    )?.value).toMatchObject({ userEnrichmentVersion: 1, activeDayCount: 2 });
  });
});
