import { describe, expect, it } from 'vitest';
import type {
  ObservabilityActorDay,
  ObservabilityDailyRollup,
  ObservabilityUserSummary,
} from '../../../shared/productObservabilityReadModel';
import {
  createEmptyDailyRollup,
  recordLatency,
} from './productObservabilityReadModelProjection';
import { ProductObservabilityReadModelService } from './productObservabilityReadModelService';

type StoredDocument = Record<string, unknown>;

class MemoryReadFirestore {
  readonly documents = new Map<string, StoredDocument>();
  readonly actorDays: Array<ObservabilityActorDay & { id: string; documentName: string }> = [];
  readonly userSummaries: Array<ObservabilityUserSummary & { id: string; documentName: string }> = [];

  private key(collection: string, id: string): string {
    return `${collection}/${id}`;
  }

  setDocument(collection: string, id: string, value: StoredDocument): void {
    this.documents.set(this.key(collection, id), { ...value });
  }

  addActorDay(id: string, value: ObservabilityActorDay): void {
    this.actorDays.push({
      ...value,
      id,
      documentName: `projects/test/databases/(default)/documents/observability_actor_day/${id}`,
    });
    this.actorDays.sort((left, right) => left.documentName.localeCompare(right.documentName));
  }

  addUserSummary(id: string, value: ObservabilityUserSummary): void {
    this.userSummaries.push({
      ...value,
      id,
      documentName: `projects/test/databases/(default)/documents/observability_user_summary/${id}`,
    });
    this.userSummaries.sort((left, right) =>
      left.actorSubjectId.localeCompare(right.actorSubjectId)
      || left.documentName.localeCompare(right.documentName));
  }

  async getDocument(collection: string, id: string): Promise<StoredDocument | null> {
    const value = this.documents.get(this.key(collection, id));
    return value ? { ...value, id } : null;
  }

  async queryDocumentsAfter(params: {
    collection: string;
    orderByField: string;
    filters?: Array<{ field: string; value: string }>;
    cursor?: { orderedValue: string; documentName: string } | null;
    limit?: number;
  }): Promise<Array<StoredDocument & { id: string; documentName: string }>> {
    const source = params.collection === 'observability_actor_day'
      ? this.actorDays
      : this.userSummaries;
    const filtered = source.filter((row) => {
      if (params.filters?.some((filter) => String(row[filter.field as keyof typeof row]) !== filter.value)) {
        return false;
      }
      if (!params.cursor) return true;
      const orderedValue = String(row[params.orderByField as keyof typeof row] ?? '');
      return orderedValue > params.cursor.orderedValue
        || (orderedValue === params.cursor.orderedValue
          && row.documentName > params.cursor.documentName);
    });
    return filtered.slice(0, params.limit ?? 50).map((row) => ({ ...row }));
  }
}

function actorDay(localDate: string, actorSubjectId: string): ObservabilityActorDay {
  return {
    schemaVersion: 1,
    environment: 'production',
    localDate,
    actorSubjectId,
    firstOccurredAt: `${localDate}T00:00:00.000Z`,
    lastOccurredAt: `${localDate}T00:00:00.000Z`,
    eventCount: 1,
    productActivityObserved: true,
    aiRequestObserved: false,
    planningObserved: false,
    updatedAt: `${localDate}T00:00:01.000Z`,
    expireAt: '2027-10-02T00:00:00.000Z',
  };
}

function userSummary(actorSubjectId: string): ObservabilityUserSummary {
  return {
    schemaVersion: 1,
    actorSubjectId,
    firstActivityAt: '2026-08-28T00:00:00.000Z',
    lastActivityAt: '2026-08-28T00:00:00.000Z',
    firstActivityDate: '2026-08-28',
    lastActivityDate: '2026-08-28',
    eventCount: 1,
    productActivityCount: 1,
    aiRequestCount: 0,
    planningOutcomeCount: 0,
    lastProductAction: 'plan_created',
    lastPlanningOutcome: null,
    updatedAt: '2026-08-28T00:00:01.000Z',
  };
}

function daily(localDate: string, latencyMs: number): ObservabilityDailyRollup {
  const rollup = createEmptyDailyRollup({
    environment: 'production',
    localDate,
    nowIso: `${localDate}T00:00:01.000Z`,
  });
  return {
    ...rollup,
    activeActorCount: 2,
    ai: {
      ...rollup.ai,
      requestCount: 1,
      successCount: 1,
      latency: recordLatency(rollup.ai.latency, latencyMs),
    },
  };
}

function service(firestore: MemoryReadFirestore): ProductObservabilityReadModelService {
  return new ProductObservabilityReadModelService(
    {
      FIREBASE_PROJECT_ID: 'test',
      FIREBASE_SERVICE_ACCOUNT_EMAIL: 'service@example.com',
      FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused',
    },
    firestore as never,
  );
}

describe('ProductObservabilityReadModelService', () => {
  it('calculates rolling distinct actors by set union, not by summing daily counts', async () => {
    const firestore = new MemoryReadFirestore();
    firestore.setDocument('observability_daily_rollups', 'production:2026-08-28', daily('2026-08-28', 90) as unknown as StoredDocument);
    firestore.setDocument('observability_daily_rollups', 'production:2026-08-29', daily('2026-08-29', 8_000) as unknown as StoredDocument);
    firestore.setDocument('observability_rollup_state', 'main', {
      schemaVersion: 1,
      cursor: null,
      processedEventCount: 4,
      lastRunStartedAt: '2026-08-29T01:00:00.000Z',
      lastSuccessfulRunAt: '2026-08-29T01:00:00.000Z',
      lastFailureAt: null,
      lastFailureCategory: null,
      updatedAt: '2026-08-29T01:00:00.000Z',
    });
    firestore.addActorDay('d1-a', actorDay('2026-08-28', 'actor-aaaaaaaa'));
    firestore.addActorDay('d1-b', actorDay('2026-08-28', 'actor-bbbbbbbb'));
    firestore.addActorDay('d2-a', actorDay('2026-08-29', 'actor-aaaaaaaa'));
    firestore.addActorDay('d2-c', actorDay('2026-08-29', 'actor-cccccccc'));

    const overview = await service(firestore).getOverview({
      environment: 'production',
      fromDate: '2026-08-28',
      toDate: '2026-08-29',
    });

    expect(overview.daily.map((entry) => entry.activeActorCount)).toEqual([2, 2]);
    expect(overview.distinctActiveActors).toBe(3);
    expect(overview.aiLatencyP50Ms).toBe(100);
    expect(overview.aiLatencyP95Ms).toBe(10_000);
    expect(overview.daily[0]).not.toHaveProperty('id');
  });

  it('returns opaque user summaries with a bounded continuation cursor', async () => {
    const firestore = new MemoryReadFirestore();
    firestore.addUserSummary('actor-aaaaaaaa', userSummary('actor-aaaaaaaa'));
    firestore.addUserSummary('actor-bbbbbbbb', userSummary('actor-bbbbbbbb'));

    const first = await service(firestore).listUserSummaries({ limit: 1 });
    expect(first.users.map((user) => user.actorSubjectId)).toEqual(['actor-aaaaaaaa']);
    expect(first.nextCursor).not.toBeNull();
    expect(first.users[0]).not.toHaveProperty('id');

    const second = await service(firestore).listUserSummaries({
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(second.users.map((user) => user.actorSubjectId)).toEqual(['actor-bbbbbbbb']);
  });

  it('rejects overly broad overview ranges before storage work', async () => {
    const firestore = new MemoryReadFirestore();
    await expect(service(firestore).getOverview({
      environment: 'production',
      fromDate: '2026-01-01',
      toDate: '2026-08-29',
    })).rejects.toThrow('observability_date_range_too_large');
  });
});
