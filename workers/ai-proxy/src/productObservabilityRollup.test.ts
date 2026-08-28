import { describe, expect, it } from 'vitest';
import type { ProductActivityTelemetryDraft } from '../../../shared/productObservabilityContract';
import { FirestoreTransactionConflictError } from './firestoreServiceAccountClient';
import { ProductObservabilityRollupEngine } from './productObservabilityRollup';

type StoredDocument = Record<string, unknown>;

class MemoryRollupFirestore {
  readonly documents = new Map<string, StoredDocument>();
  readonly events: Array<StoredDocument & { id: string; documentName: string }> = [];
  conflictNextCommit = false;
  transactionSequence = 0;

  private key(collection: string, id: string): string {
    return `${collection}/${id}`;
  }

  addEvent(id: string, event: StoredDocument): void {
    this.events.push({
      ...event,
      id,
      documentName: `projects/test/databases/(default)/documents/observability_events/${id}`,
    });
    this.events.sort((left, right) =>
      String(left.observedAt).localeCompare(String(right.observedAt))
      || left.documentName.localeCompare(right.documentName));
  }

  async getDocument(collection: string, id: string): Promise<StoredDocument | null> {
    const value = this.documents.get(this.key(collection, id));
    return value ? { ...value, id } : null;
  }

  async queryDocumentsAfter(params: {
    cursor?: { orderedValue: string; documentName: string } | null;
    limit?: number;
  }): Promise<Array<StoredDocument & { id: string; documentName: string }>> {
    const rows = this.events.filter((event) => {
      if (!params.cursor) return true;
      const observedAt = String(event.observedAt);
      return observedAt > params.cursor.orderedValue
        || (observedAt === params.cursor.orderedValue
          && event.documentName > params.cursor.documentName);
    });
    return rows.slice(0, params.limit ?? 50).map((row) => ({ ...row }));
  }

  async beginTransaction(): Promise<string> {
    this.transactionSequence += 1;
    return `tx-${this.transactionSequence}`;
  }

  async getDocumentInTransaction(
    collection: string,
    id: string,
    _transaction: string,
  ): Promise<StoredDocument | null> {
    return await this.getDocument(collection, id);
  }

  async commitTransaction(
    _transaction: string,
    writes: readonly Array<{ collection: string; id: string; value: StoredDocument }>,
  ): Promise<void> {
    if (this.conflictNextCommit) {
      this.conflictNextCommit = false;
      throw new FirestoreTransactionConflictError(409);
    }
    for (const write of writes) {
      this.documents.set(this.key(write.collection, write.id), { ...write.value });
    }
  }

  async rollbackTransaction(_transaction: string): Promise<void> {}
}

function activityEvent(params: {
  eventId: string;
  actorSubjectId?: string;
  action?: ProductActivityTelemetryDraft['payload']['action'];
  occurredAt: string;
  observedAt: string;
}): StoredDocument {
  return {
    schemaVersion: 1,
    eventId: params.eventId,
    eventType: 'product_activity',
    occurredAt: params.occurredAt,
    observedAt: params.observedAt,
    actorSubjectId: params.actorSubjectId ?? 'actor-12345678',
    environment: 'production',
    appVersion: '1.0.0',
    source: 'web_app',
    correlation: {},
    payload: { action: params.action ?? 'plan_created' },
    expireAt: '2026-11-30T00:00:00.000Z',
  };
}

function engine(firestore: MemoryRollupFirestore): ProductObservabilityRollupEngine {
  return new ProductObservabilityRollupEngine(
    {
      FIREBASE_PROJECT_ID: 'test',
      FIREBASE_SERVICE_ACCOUNT_EMAIL: 'service@example.com',
      FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused',
    },
    firestore as never,
    () => new Date('2026-08-28T12:00:00.000Z'),
  );
}

describe('ProductObservabilityRollupEngine', () => {
  it('projects multiple events exactly once and counts one active actor per day', async () => {
    const firestore = new MemoryRollupFirestore();
    firestore.addEvent('event-1', activityEvent({
      eventId: 'activity-11111111',
      occurredAt: '2026-08-28T00:00:00.000Z',
      observedAt: '2026-08-28T00:00:01.000Z',
    }));
    firestore.addEvent('event-2', activityEvent({
      eventId: 'activity-22222222',
      action: 'actual_recorded',
      occurredAt: '2026-08-28T01:00:00.000Z',
      observedAt: '2026-08-28T01:00:01.000Z',
    }));

    const rollup = engine(firestore);
    const first = await rollup.runBatch(50);
    const dailyKey = 'observability_daily_rollups/production:2026-08-28';
    const dailyAfterFirst = firestore.documents.get(dailyKey);

    expect(first.processed).toBe(2);
    expect(first.checkpoint.processedEventCount).toBe(2);
    expect(dailyAfterFirst?.activeActorCount).toBe(1);
    expect(dailyAfterFirst?.processedEventCount).toBe(2);
    expect(dailyAfterFirst).not.toHaveProperty('id');

    const second = await rollup.runBatch(50);
    const dailyAfterSecond = firestore.documents.get(dailyKey);
    expect(second.processed).toBe(0);
    expect(dailyAfterSecond?.processedEventCount).toBe(2);
    expect(second.checkpoint.processedEventCount).toBe(2);
  });

  it('retries a transaction conflict without double-counting the event', async () => {
    const firestore = new MemoryRollupFirestore();
    firestore.addEvent('event-1', activityEvent({
      eventId: 'activity-11111111',
      occurredAt: '2026-08-28T00:00:00.000Z',
      observedAt: '2026-08-28T00:00:01.000Z',
    }));
    firestore.conflictNextCommit = true;

    const result = await engine(firestore).runBatch(50);
    const daily = firestore.documents.get(
      'observability_daily_rollups/production:2026-08-28',
    );

    expect(result.processed).toBe(1);
    expect(result.checkpoint.processedEventCount).toBe(1);
    expect(daily?.processedEventCount).toBe(1);
    expect(firestore.transactionSequence).toBeGreaterThanOrEqual(2);
  });

  it('uses occurrence time for the daily bucket even when an event arrives later', async () => {
    const firestore = new MemoryRollupFirestore();
    firestore.addEvent('event-1', activityEvent({
      eventId: 'activity-11111111',
      occurredAt: '2026-08-28T00:00:00.000Z',
      observedAt: '2026-08-28T00:00:01.000Z',
    }));
    const rollup = engine(firestore);
    await rollup.runBatch(50);

    firestore.addEvent('event-late', activityEvent({
      eventId: 'activity-33333333',
      actorSubjectId: 'actor-87654321',
      occurredAt: '2026-08-27T14:00:00.000Z',
      observedAt: '2026-08-28T02:00:01.000Z',
    }));
    const result = await rollup.runBatch(50);

    expect(result.processed).toBe(1);
    expect(
      firestore.documents.get('observability_daily_rollups/production:2026-08-27')
        ?.processedEventCount,
    ).toBe(1);
  });

  it('does not advance the cursor when a malformed event cannot be projected', async () => {
    const firestore = new MemoryRollupFirestore();
    firestore.addEvent('invalid-event', {
      eventId: 'invalid-event',
      eventType: 'product_activity',
      observedAt: '2026-08-28T00:00:01.000Z',
    });

    await expect(engine(firestore).runBatch(50)).rejects.toThrow('invalid_observability_event');
    const checkpoint = firestore.documents.get('observability_rollup_state/main');
    expect(checkpoint?.cursor ?? null).toBeNull();
    expect(checkpoint?.processedEventCount).toBe(0);
    expect(checkpoint?.lastFailureCategory).toBe('invalid_event');
  });
});
