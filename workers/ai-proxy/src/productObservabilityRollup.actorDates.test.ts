import { describe, expect, it } from 'vitest';
import { ProductObservabilityRollupEngine } from './productObservabilityRollup';

type StoredDocument = Record<string, unknown>;

class MemoryRollupFirestore {
  readonly documents = new Map<string, StoredDocument>();
  readonly events: Array<StoredDocument & { id: string; documentName: string }> = [];
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
    return this.events
      .filter((event) => {
        if (!params.cursor) return true;
        const observedAt = String(event.observedAt);
        return observedAt > params.cursor.orderedValue
          || (observedAt === params.cursor.orderedValue
            && event.documentName > params.cursor.documentName);
      })
      .slice(0, params.limit ?? 50)
      .map((event) => ({ ...event }));
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
    for (const write of writes) {
      this.documents.set(this.key(write.collection, write.id), { ...write.value });
    }
  }

  async rollbackTransaction(_transaction: string): Promise<void> {}
}

function event(overrides: Partial<StoredDocument> = {}): StoredDocument {
  return {
    schemaVersion: 1,
    eventId: 'activity-11111111',
    eventType: 'product_activity',
    occurredAt: '2026-08-27T14:00:00.000Z',
    observedAt: '2026-08-28T11:00:00.000Z',
    actorSubjectId: 'actor-12345678',
    environment: 'production',
    appVersion: '1.0.0',
    source: 'web_app',
    correlation: {},
    payload: { action: 'app_active' },
    expireAt: '2026-11-30T00:00:00.000Z',
    ...overrides,
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

describe('ProductObservabilityRollupEngine actor-day change projection', () => {
  it('persists one dirty source per new actor-day and environment', async () => {
    const firestore = new MemoryRollupFirestore();
    firestore.addEvent('event-1', event());
    firestore.addEvent('event-2', event({
      eventId: 'activity-22222222',
      observedAt: '2026-08-28T11:01:00.000Z',
    }));
    firestore.addEvent('event-preview', event({
      eventId: 'activity-preview-1',
      observedAt: '2026-08-28T11:02:00.000Z',
      environment: 'preview',
    }));

    const result = await engine(firestore).runBatch(50);

    expect(result.processed).toBe(3);
    expect(result.changedActorSources).toEqual([
      { environment: 'preview', localDate: '2026-08-27' },
      { environment: 'production', localDate: '2026-08-27' },
    ]);
    expect(result.checkpoint.activeUserDirtySources).toEqual(result.changedActorSources);
  });

  it('keeps dirty sources across an empty rollup until snapshot maintenance clears them', async () => {
    const firestore = new MemoryRollupFirestore();
    firestore.addEvent('event-1', event());
    const rollup = engine(firestore);

    const first = await rollup.runBatch(50);
    const second = await rollup.runBatch(50);

    expect(first.checkpoint.activeUserDirtySources).toEqual([
      { environment: 'production', localDate: '2026-08-27' },
    ]);
    expect(second.processed).toBe(0);
    expect(second.checkpoint.activeUserDirtySources).toEqual(
      first.checkpoint.activeUserDirtySources,
    );

    await rollup.clearActiveUserDirtySources([
      { environment: 'production', localDate: '2026-08-27' },
    ]);
    const third = await rollup.runBatch(50);
    expect(third.checkpoint.activeUserDirtySources).toEqual([]);
  });

  it('rejects an unrecognized environment before creating arbitrary read-model collections', async () => {
    const firestore = new MemoryRollupFirestore();
    firestore.addEvent('poison', event({ environment: 'prod-typo' }));

    await expect(engine(firestore).runBatch(50)).rejects.toThrow(
      'invalid_observability_event',
    );
    expect(firestore.documents.has('observability_user_summary_prod-typo/actor-12345678'))
      .toBe(false);
  });
});
