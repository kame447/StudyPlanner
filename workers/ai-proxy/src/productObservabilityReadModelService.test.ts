import { describe, expect, it } from 'vitest';
import type { ObservabilityEnvironment } from '../../../shared/productObservabilityContract';
import type {
  ObservabilityActiveUserDirtySource,
  ObservabilityActiveUserWindows,
  ObservabilityDailyRollup,
  ObservabilityUserSummary,
} from '../../../shared/productObservabilityReadModel';
import type { FirestoreAggregationFilter } from './firestoreServiceAccountClient';
import {
  createEmptyDailyRollup,
  recordLatency,
} from './productObservabilityReadModelProjection';
import { ProductObservabilityReadModelService } from './productObservabilityReadModelService';

type StoredDocument = Record<string, unknown>;

class MemoryReadFirestore {
  readonly documents = new Map<string, StoredDocument>();
  readonly userSummaries = new Map<
    string,
    Array<ObservabilityUserSummary & { id: string; documentName: string }>
  >();
  readonly profiles: StoredDocument[] = [];
  queryCallCount = 0;
  countCallCount = 0;

  private key(collection: string, id: string): string {
    return `${collection}/${id}`;
  }

  setDocument(collection: string, id: string, value: StoredDocument): void {
    this.documents.set(this.key(collection, id), { ...value });
  }

  addProfile(value: StoredDocument): void {
    this.profiles.push({ ...value });
  }

  addUserSummary(
    environment: ObservabilityEnvironment,
    id: string,
    value: ObservabilityUserSummary,
  ): void {
    const collection = `observability_user_summary_${environment}`;
    const current = this.userSummaries.get(collection) ?? [];
    current.push({
      ...value,
      id,
      documentName: `projects/test/databases/(default)/documents/${collection}/${id}`,
    });
    current.sort((left, right) =>
      left.actorSubjectId.localeCompare(right.actorSubjectId)
      || left.documentName.localeCompare(right.documentName));
    this.userSummaries.set(collection, current);
    this.setDocument(collection, id, value as unknown as StoredDocument);
  }

  async getDocument(collection: string, id: string): Promise<StoredDocument | null> {
    const value = this.documents.get(this.key(collection, id));
    return value ? { ...value, id } : null;
  }

  async countDocuments(
    collection: string,
    filters: readonly FirestoreAggregationFilter[] = [],
  ): Promise<number> {
    this.countCallCount += 1;
    if (collection !== 'profiles') return 0;
    return this.profiles.filter((profile) => filters.every((filter) => {
      const value = profile[filter.field];
      if (typeof value !== 'string') return false;
      if (filter.operator === 'EQUAL') return value === filter.value;
      if (filter.operator === 'GREATER_THAN') return value > filter.value;
      if (filter.operator === 'GREATER_THAN_OR_EQUAL') return value >= filter.value;
      if (filter.operator === 'LESS_THAN') return value < filter.value;
      return value <= filter.value;
    })).length;
  }

  async queryDocumentsAfter(params: {
    collection: string;
    orderByField: string;
    filters?: Array<{ field: string; value: string }>;
    cursor?: { orderedValue: string; documentName: string } | null;
    limit?: number;
  }): Promise<Array<StoredDocument & { id: string; documentName: string }>> {
    this.queryCallCount += 1;
    const source = this.userSummaries.get(params.collection) ?? [];
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
    processedEventCount: 3,
    activeActorCount: 2,
    firstOccurredAt: `${localDate}T00:00:00.000Z`,
    lastOccurredAt: `${localDate}T00:00:02.000Z`,
    ai: {
      ...rollup.ai,
      requestCount: 1,
      successCount: 1,
      latency: recordLatency(rollup.ai.latency, latencyMs),
    },
  };
}

function activeUsers(asOfDate: string): ObservabilityActiveUserWindows {
  return {
    schemaVersion: 1,
    environment: 'production',
    asOfDate,
    reportingTimeZone: 'Asia/Tokyo',
    today: 2,
    last7Days: 3,
    last30Days: 4,
    updatedAt: `${asOfDate}T01:00:00.000Z`,
    expireAt: '2027-10-02T00:00:00.000Z',
  };
}

function checkpoint(
  activeUserDirtySources: ObservabilityActiveUserDirtySource[] = [],
): StoredDocument {
  return {
    schemaVersion: 1,
    cursor: null,
    processedEventCount: 4,
    activeUserDirtySources,
    lastRunStartedAt: '2026-08-29T01:00:00.000Z',
    lastSuccessfulRunAt: '2026-08-29T01:00:00.000Z',
    lastFailureAt: null,
    lastFailureCategory: null,
    updatedAt: '2026-08-29T01:00:00.000Z',
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
  it('reads precomputed active-user windows without scanning actor-day rows', async () => {
    const firestore = new MemoryReadFirestore();
    firestore.setDocument('observability_daily_rollups', 'production:2026-08-28', daily('2026-08-28', 90) as unknown as StoredDocument);
    firestore.setDocument('observability_daily_rollups', 'production:2026-08-29', daily('2026-08-29', 8_000) as unknown as StoredDocument);
    firestore.setDocument(
      'observability_active_user_windows',
      'production:2026-08-29',
      activeUsers('2026-08-29') as unknown as StoredDocument,
    );
    firestore.setDocument('observability_rollup_state', 'main', checkpoint());

    const overview = await service(firestore).getOverview({
      environment: 'production',
      fromDate: '2026-08-28',
      toDate: '2026-08-29',
    });

    expect(overview.daily.map((entry) => entry.activeActorCount)).toEqual([2, 2]);
    expect(overview.activeUsers).toMatchObject({ today: 2, last7Days: 3, last30Days: 4 });
    expect(overview.registeredUsers).toEqual({
      total: 0,
      newInPeriod: 0,
      registrationIndexReady: true,
      scope: 'firebase_project',
    });
    expect(overview.aiLatencyP50Ms).toBe(100);
    expect(overview.aiLatencyP95Ms).toBe(10_000);
    expect(overview.daily[0]).not.toHaveProperty('id');
    expect(firestore.queryCallCount).toBe(0);
  });

  it('counts total and new registered users with Asia/Tokyo date boundaries', async () => {
    const firestore = new MemoryReadFirestore();
    firestore.addProfile({ registeredAt: '2026-08-27T14:59:59.999Z' });
    firestore.addProfile({ registeredAt: '2026-08-27T15:00:00.000Z' });
    firestore.addProfile({ registeredAt: '2026-08-29T14:59:59.999Z' });
    firestore.addProfile({ registeredAt: '2026-08-29T15:00:00.000Z' });

    const overview = await service(firestore).getOverview({
      environment: 'production',
      fromDate: '2026-08-28',
      toDate: '2026-08-29',
    });

    expect(overview.registeredUsers).toEqual({
      total: 4,
      newInPeriod: 2,
      registrationIndexReady: true,
      scope: 'firebase_project',
    });
    expect(firestore.countCallCount).toBe(3);
  });

  it('returns unknown new-registration count while any profile lacks canonical registration time', async () => {
    const firestore = new MemoryReadFirestore();
    firestore.addProfile({ registeredAt: '2026-08-28T00:00:00.000Z' });
    firestore.addProfile({ createdAt: 'Fri, 28 Aug 2026 01:00:00 GMT' });

    const overview = await service(firestore).getOverview({
      environment: 'production',
      fromDate: '2026-08-28',
      toDate: '2026-08-28',
    });

    expect(overview.registeredUsers).toEqual({
      total: 2,
      newInPeriod: null,
      registrationIndexReady: false,
      scope: 'firebase_project',
    });
    expect(firestore.countCallCount).toBe(2);
  });

  it('returns null instead of scanning raw membership when a window snapshot is unavailable', async () => {
    const firestore = new MemoryReadFirestore();
    firestore.setDocument('observability_rollup_state', 'main', checkpoint());

    const overview = await service(firestore).getOverview({
      environment: 'production',
      fromDate: '2026-08-29',
      toDate: '2026-08-29',
    });

    expect(overview.activeUsers).toBeNull();
    expect(firestore.queryCallCount).toBe(0);
  });

  it('does not expose a snapshot whose 30-day window has pending actor-day repairs', async () => {
    const firestore = new MemoryReadFirestore();
    firestore.setDocument(
      'observability_active_user_windows',
      'production:2026-08-29',
      activeUsers('2026-08-29') as unknown as StoredDocument,
    );
    const dirty = [{ environment: 'production', localDate: '2026-08-27', revision: 2 }] as const;
    firestore.setDocument('observability_rollup_state', 'main', checkpoint([...dirty]));

    const overview = await service(firestore).getOverview({
      environment: 'production',
      fromDate: '2026-08-29',
      toDate: '2026-08-29',
    });

    expect(overview.activeUsers).toBeNull();
    expect(overview.rollupCheckpoint.activeUserDirtySources).toEqual(dirty);
    expect(firestore.queryCallCount).toBe(0);
  });

  it('does not invalidate production snapshot for a preview-only pending repair', async () => {
    const firestore = new MemoryReadFirestore();
    firestore.setDocument(
      'observability_active_user_windows',
      'production:2026-08-29',
      activeUsers('2026-08-29') as unknown as StoredDocument,
    );
    firestore.setDocument(
      'observability_rollup_state',
      'main',
      checkpoint([{ environment: 'preview', localDate: '2026-08-27', revision: 1 }]),
    );

    const overview = await service(firestore).getOverview({
      environment: 'production',
      fromDate: '2026-08-29',
      toDate: '2026-08-29',
    });

    expect(overview.activeUsers?.last30Days).toBe(4);
  });

  it('keeps a historical snapshot visible when pending repairs cannot affect its window', async () => {
    const firestore = new MemoryReadFirestore();
    firestore.setDocument(
      'observability_active_user_windows',
      'production:2026-07-01',
      activeUsers('2026-07-01') as unknown as StoredDocument,
    );
    firestore.setDocument(
      'observability_rollup_state',
      'main',
      checkpoint([{ environment: 'production', localDate: '2026-08-27', revision: 1 }]),
    );

    const overview = await service(firestore).getOverview({
      environment: 'production',
      fromDate: '2026-07-01',
      toDate: '2026-07-01',
    });

    expect(overview.activeUsers?.asOfDate).toBe('2026-07-01');
  });

  it('fails closed when dirty checkpoint state is malformed', async () => {
    const firestore = new MemoryReadFirestore();
    firestore.setDocument(
      'observability_active_user_windows',
      'production:2026-08-29',
      activeUsers('2026-08-29') as unknown as StoredDocument,
    );
    firestore.setDocument('observability_rollup_state', 'main', {
      ...checkpoint(),
      activeUserDirtySources: [{
        environment: 'production',
        localDate: '2026-08-27',
        revision: 0,
      }],
    });

    await expect(service(firestore).getOverview({
      environment: 'production',
      fromDate: '2026-08-29',
      toDate: '2026-08-29',
    })).rejects.toThrow('observability_checkpoint_invalid');
  });

  it('rejects incompatible checkpoint read-model versions', async () => {
    const firestore = new MemoryReadFirestore();
    firestore.setDocument('observability_rollup_state', 'main', {
      ...checkpoint(),
      schemaVersion: 999,
    });

    await expect(service(firestore).getOverview({
      environment: 'production',
      fromDate: '2026-08-29',
      toDate: '2026-08-29',
    })).rejects.toThrow('observability_read_model_version_mismatch');
  });

  it('rejects a daily rollup stored under the wrong environment or date', async () => {
    const firestore = new MemoryReadFirestore();
    firestore.setDocument('observability_daily_rollups', 'production:2026-08-28', {
      ...daily('2026-08-28', 100),
      environment: 'preview',
    } as unknown as StoredDocument);

    await expect(service(firestore).getOverview({
      environment: 'production',
      fromDate: '2026-08-28',
      toDate: '2026-08-28',
    })).rejects.toThrow('observability_daily_rollup_invalid');
  });

  it('rejects a user summary whose event-family counts do not match its total', async () => {
    const firestore = new MemoryReadFirestore();
    firestore.addUserSummary('production', 'actor-aaaaaaaa', {
      ...userSummary('actor-aaaaaaaa'),
      eventCount: 2,
    });

    await expect(service(firestore).listUserSummaries({
      environment: 'production',
    })).rejects.toThrow('observability_user_summary_invalid');
  });

  it('rejects a forged user-summary cursor before querying storage', async () => {
    const firestore = new MemoryReadFirestore();

    await expect(service(firestore).listUserSummaries({
      environment: 'production',
      cursor: {
        orderedValue: 'actor-aaaaaaaa',
        documentName: 'projects/test/databases/(default)/documents/other/actor-aaaaaaaa',
      },
    })).rejects.toThrow('observability_cursor_invalid');
    expect(firestore.queryCallCount).toBe(0);
  });

  it('returns environment-isolated opaque user summaries with a bounded cursor', async () => {
    const firestore = new MemoryReadFirestore();
    firestore.addUserSummary('production', 'actor-aaaaaaaa', userSummary('actor-aaaaaaaa'));
    firestore.addUserSummary('production', 'actor-bbbbbbbb', userSummary('actor-bbbbbbbb'));
    firestore.addUserSummary('preview', 'actor-preview1', userSummary('actor-preview1'));

    const first = await service(firestore).listUserSummaries({ environment: 'production', limit: 1 });
    expect(first.users.map((user) => user.actorSubjectId)).toEqual(['actor-aaaaaaaa']);
    expect(first.nextCursor).not.toBeNull();
    expect(first.users[0]).not.toHaveProperty('id');

    const second = await service(firestore).listUserSummaries({
      environment: 'production',
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(second.users.map((user) => user.actorSubjectId)).toEqual(['actor-bbbbbbbb']);
    expect(await service(firestore).getUserSummary('actor-preview1', 'production')).toBeNull();
    expect((await service(firestore).getUserSummary('actor-preview1', 'preview'))?.actorSubjectId)
      .toBe('actor-preview1');
  });

  it('rejects incompatible latency histogram versions instead of silently merging them', async () => {
    const firestore = new MemoryReadFirestore();
    const incompatible = daily('2026-08-28', 100) as unknown as {
      ai: { latency: { version: string } };
    } & ObservabilityDailyRollup;
    incompatible.ai.latency.version = 'latency-ms-v0';
    firestore.setDocument(
      'observability_daily_rollups',
      'production:2026-08-28',
      incompatible as unknown as StoredDocument,
    );

    await expect(service(firestore).getOverview({
      environment: 'production',
      fromDate: '2026-08-28',
      toDate: '2026-08-28',
    })).rejects.toThrow('observability_daily_rollup_invalid');
  });

  it('rejects overly broad overview ranges before storage work', async () => {
    const firestore = new MemoryReadFirestore();
    await expect(service(firestore).getOverview({
      environment: 'production',
      fromDate: '2026-01-01',
      toDate: '2026-08-29',
    })).rejects.toThrow('observability_date_range_too_large');
    expect(firestore.countCallCount).toBe(0);
  });
});
