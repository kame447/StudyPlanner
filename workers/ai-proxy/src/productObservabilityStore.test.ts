import { describe, expect, it } from 'vitest';
import { ProductObservabilityStore } from './productObservabilityStore';
import { JEV_MODEL } from './decision/decisionPolicy';

class MemoryFirestore {
  readonly documents = new Map<string, Record<string, unknown>>();
  batchGetCallCount = 0;

  private key(collection: string, id: string): string {
    return `${collection}/${id}`;
  }

  async getDocument(collection: string, id: string): Promise<Record<string, unknown> | null> {
    const value = this.documents.get(this.key(collection, id));
    return value ? { ...value, id } : null;
  }

  async batchGetDocuments(
    collection: string,
    ids: readonly string[],
  ): Promise<Array<Record<string, unknown> | null>> {
    this.batchGetCallCount += 1;
    return await Promise.all(ids.map((id) => this.getDocument(collection, id)));
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

function validPlanningOutcomeDraft() {
  return {
    schemaVersion: 1,
    eventId: 'planning-preview_generated-request-12345678',
    eventType: 'planning_outcome',
    occurredAt: '2026-08-28T00:00:00.000Z',
    appVersion: '1.2.3',
    source: 'weekly_planning',
    correlation: {
      featureSessionId: 'weekly-conversation-1',
      requestId: 'weekly-request-12345678',
      stateRevision: 4,
    },
    payload: {
      outcomeType: 'preview_generated',
      turnIndex: 2,
      stateRevision: 4,
      previewCount: 5,
      unscheduledCount: 0,
      fallbackUsed: null,
      repairUsed: false,
      staleObserved: null,
      approvalFailureObserved: null,
      schedulerVersion: 'weekly-planning-stable-v5-preview-scheduler-v1',
      promptVersion: null,
      model: null,
    },
  };
}

function validAiMetricPayload() {
  return {
    operationKind: 'chat_completion' as const,
    purpose: 'weekly_planning_semantic_normalizer',
    phase: 'initial' as const,
    provider: 'openai' as const,
    model: 'gpt-5.6-luna',
    status: 'success' as const,
    errorCategory: null,
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    cachedTokens: null,
    durationMs: 420,
    requestBytes: 1200,
    responseBytes: 300,
    pricingVersion: null,
    estimatedCostMicros: null,
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
  it('persists Jev outcome and provider cost without converting missing usage to zero', async () => {
    const firestore = new MemoryFirestore();
    const store = createStore(firestore);
    const decision = {
      mode: 'shadow' as const, outcome: 'shadow' as const, gate: 'abstained' as const,
      reason: 'uncertain', requestedModel: JEV_MODEL.request, catalogVersion: 'fixture', gateVersion: 'fixture',
      inputRevision: 4, comparisonMatches: false, reportedCostUsd: 0.00001344,
      choice: 'create_plan' as const, confidence: 0.8, createPlanProbability: 0.9, fallbackProbability: 0.1,
      conditionChangeProbability: 0.1, independentMeaningProbability: 0.2,
    };
    await store.storeAiRequestMetric({
      firebaseUid: 'private-firebase-uid', requestId: 'jev-metric-fixture',
      occurredAt: '2026-08-28T00:00:00.000Z', appVersion: 'test',
      payload: { ...validAiMetricPayload(), provider: 'openrouter', operationKind: 'decision', model: JEV_MODEL.request, decision },
    });
    const saved = [...firestore.documents.values()].find((value) => value.eventType === 'ai_request_metric');
    expect(saved?.payload).toMatchObject({ provider: 'openrouter', promptTokens: null, decision });
    expect(JSON.stringify([...firestore.documents.values()])).not.toContain('private-firebase-uid');
  });
  it('keeps unknown decision probabilities null and rejects incomplete or invalid distributions', async () => {
    const firestore = new MemoryFirestore();
    const store = createStore(firestore);
    const baseDecision = {
      mode: 'shadow' as const, outcome: 'shadow' as const, gate: 'unavailable' as const,
      reason: 'configuration', requestedModel: JEV_MODEL.request, catalogVersion: 'fixture', gateVersion: 'fixture',
      inputRevision: 4, comparisonMatches: null, reportedCostUsd: null,
      choice: null, confidence: null, createPlanProbability: null, fallbackProbability: null,
      conditionChangeProbability: null, independentMeaningProbability: null,
    };
    await store.storeAiRequestMetric({
      firebaseUid: 'private-firebase-uid', requestId: 'jev-unknown-probability',
      occurredAt: '2026-08-28T00:00:00.000Z', appVersion: 'test',
      payload: { ...validAiMetricPayload(), provider: 'openrouter', operationKind: 'decision', model: JEV_MODEL.request, decision: baseDecision },
    });
    const saved = [...firestore.documents.values()].find((value) => value.eventId === 'jev-unknown-probability');
    expect(saved?.payload).toMatchObject({
      decision: { createPlanProbability: null, fallbackProbability: null },
    });

    await expect(store.storeAiRequestMetric({
      firebaseUid: 'private-firebase-uid', requestId: 'jev-invalid-probability',
      occurredAt: '2026-08-28T00:00:00.000Z', appVersion: 'test',
      payload: {
        ...validAiMetricPayload(), provider: 'openrouter', operationKind: 'decision', model: JEV_MODEL.request,
        decision: { ...baseDecision, createPlanProbability: 0.9, fallbackProbability: null },
      },
    })).rejects.toThrow('Decision telemetry probabilities are invalid');
  });
  it('looks up an actor without creating directory state on a read-only miss', async () => {
    const firestore = new MemoryFirestore();
    const store = createStore(firestore);

    expect(await store.lookupActorSubjectId('raw-firebase-uid-123')).toBeNull();
    expect(firestore.documents.size).toBe(0);

    const created = await store.resolveActorSubjectId('raw-firebase-uid-123');
    expect(created).toMatch(/^actor-/);
    expect(await store.lookupActorSubjectId('raw-firebase-uid-123')).toBe(created);
    expect(firestore.documents.size).toBe(1);
  });

  it('looks up a bounded identity set with one exact-ID batch read and preserves misses', async () => {
    const firestore = new MemoryFirestore();
    const store = createStore(firestore);
    const first = await store.resolveActorSubjectId('firebase-uid-1');
    const third = await store.resolveActorSubjectId('firebase-uid-3');

    await expect(store.lookupActorSubjectIds([
      'firebase-uid-1',
      'firebase-uid-2',
      'firebase-uid-3',
    ])).resolves.toEqual([first, null, third]);
    expect(firestore.batchGetCallCount).toBe(1);
  });

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

  it('stores planning outcomes pseudonymously and deduplicates retry delivery', async () => {
    const firestore = new MemoryFirestore();
    const store = createStore(firestore);
    const draft = validPlanningOutcomeDraft();

    await store.storePlanningOutcome('raw-firebase-uid-123', draft);
    const firstSize = firestore.documents.size;
    await store.storePlanningOutcome('raw-firebase-uid-123', draft);

    expect(firstSize).toBe(2);
    expect(firestore.documents.size).toBe(2);
    const serialized = JSON.stringify([...firestore.documents.entries()]);
    expect(serialized).not.toContain('raw-firebase-uid-123');
    expect(serialized).not.toContain('userText');
    expect(serialized).toContain('planning_outcome');
    expect(serialized).toContain('preview_generated');
    expect(serialized).toContain('weekly-conversation-1');
  });

  it('stores AI request metrics pseudonymously and preserves unknown usage as null', async () => {
    const firestore = new MemoryFirestore();
    const store = createStore(firestore);
    const params = {
      firebaseUid: 'raw-firebase-uid-123',
      requestId: 'ai-request-12345678',
      occurredAt: '2026-08-28T00:00:00.000Z',
      appVersion: '1.2.3',
      payload: validAiMetricPayload(),
    };

    await store.storeAiRequestMetric(params);
    const firstSize = firestore.documents.size;
    await store.storeAiRequestMetric(params);

    expect(firstSize).toBe(2);
    expect(firestore.documents.size).toBe(2);
    const serialized = JSON.stringify([...firestore.documents.entries()]);
    expect(serialized).not.toContain('raw-firebase-uid-123');
    expect(serialized).not.toContain('prompt text');
    expect(serialized).toContain('ai_request_metric');
    expect(serialized).toContain('"promptTokens":null');
    expect(serialized).toContain('"estimatedCostMicros":null');
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
