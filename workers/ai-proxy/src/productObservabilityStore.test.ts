import { describe, expect, it } from 'vitest';
import { ProductObservabilityStore } from './productObservabilityStore';

class MemoryFirestore {
  readonly documents = new Map<string, Record<string, unknown>>();

  private key(collection: string, id: string): string {
    return `${collection}/${id}`;
  }

  async getDocument(collection: string, id: string): Promise<Record<string, unknown> | null> {
    const value = this.documents.get(this.key(collection, id));
    return value ? { ...value, id } : null;
  }

  async setImmutableDocument(
    collection: string,
    id: string,
    value: Record<string, unknown>,
  ): Promise<void> {
    const key = this.key(collection, id);
    const existing = this.documents.get(key);
    if (existing && JSON.stringify(existing) !== JSON.stringify(value)) {
      throw new Error(`immutable conflict: ${key}`);
    }
    this.documents.set(key, { ...value });
  }
}

function validActivityDraft() {
  return {
    schemaVersion: 1,
    eventId: 'activity-12345678',
    eventType: 'product_activity',
    occurredAt: '2026-08-28T00:00:00.000Z',
    appVersion: '1.2.3',
    source: 'web_app',
    correlation: {
      featureSessionId: 'weekly-session-1',
    },
    payload: {
      action: 'weekly_planning_opened',
    },
  };
}

function createStore(firestore: MemoryFirestore) {
  return new ProductObservabilityStore(
    {
      FIREBASE_PROJECT_ID: 'test-project',
      FIREBASE_SERVICE_ACCOUNT_EMAIL: 'service@example.com',
      FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused-in-memory',
      OBSERVABILITY_IDENTITY_SECRET: '0123456789abcdef0123456789abcdef',
      ENVIRONMENT: 'test',
    },
    firestore,
    crypto,
    () => new Date('2026-08-28T00:01:00.000Z'),
  );
}

describe('ProductObservabilityStore', () => {
  it('stores a pseudonymous activity event without persisting the raw Firebase UID', async () => {
    const firestore = new MemoryFirestore();
    const store = createStore(firestore);

    await store.storeProductActivity('raw-firebase-uid-123', validActivityDraft());

    expect(firestore.documents.size).toBe(2);
    const serialized = JSON.stringify([...firestore.documents.entries()]);
    expect(serialized).not.toContain('raw-firebase-uid-123');
    expect(serialized).not.toContain('email');
    expect(serialized).not.toContain('metadata');
    expect(serialized).toContain('actor-');
    expect(serialized).toContain('weekly_planning_opened');
  });

  it('deduplicates retry delivery by authenticated actor and client event id', async () => {
    const firestore = new MemoryFirestore();
    const store = createStore(firestore);
    const draft = validActivityDraft();

    await store.storeProductActivity('raw-firebase-uid-123', draft);
    const firstSize = firestore.documents.size;
    await store.storeProductActivity('raw-firebase-uid-123', draft);

    expect(firstSize).toBe(2);
    expect(firestore.documents.size).toBe(2);
  });

  it('rejects unknown fields before writing actor or event data', async () => {
    const firestore = new MemoryFirestore();
    const store = createStore(firestore);

    await expect(store.storeProductActivity('raw-firebase-uid-123', {
      ...validActivityDraft(),
      userId: 'should-not-be-accepted',
    })).rejects.toThrow('Telemetry payload contains unknown fields.');
    expect(firestore.documents.size).toBe(0);
  });

  it('rejects an event timestamp far outside the bounded client window', async () => {
    const firestore = new MemoryFirestore();
    const store = createStore(firestore);

    await expect(store.storeProductActivity('raw-firebase-uid-123', {
      ...validActivityDraft(),
      occurredAt: '2026-08-01T00:00:00.000Z',
    })).rejects.toThrow('Telemetry occurredAt is too old');
    expect(firestore.documents.size).toBe(0);
  });
});
