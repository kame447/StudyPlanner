import { describe, expect, it } from 'vitest';
import type { ObservabilityOverviewReadModel } from '../../../shared/productObservabilityReadModel';
import {
  createEmptyDailyRollup,
  recordLatency,
} from './productObservabilityReadModelProjection';
import { ProductObservabilityAdminAnalysisService } from './productObservabilityAdminAnalysisService';

const env = {
  FIREBASE_PROJECT_ID: 'test',
  FIREBASE_SERVICE_ACCOUNT_EMAIL: 'service@example.com',
  FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused',
  OBSERVABILITY_IDENTITY_SECRET: '0123456789abcdef0123456789abcdef',
};

function overview(): ObservabilityOverviewReadModel {
  const day1 = createEmptyDailyRollup({
    environment: 'production',
    localDate: '2026-08-28',
    nowIso: '2026-08-28T01:00:00.000Z',
  });
  const day2 = createEmptyDailyRollup({
    environment: 'production',
    localDate: '2026-08-29',
    nowIso: '2026-08-29T01:00:00.000Z',
  });
  const modelAggregate = {
    ...day1.ai,
    requestCount: 2,
    successCount: 1,
    failureCount: 1,
    statusCounts: { success: 1, provider_error: 1 },
    promptTokens: 80,
    completionTokens: 20,
    totalTokens: 100,
    cachedTokens: 40,
    estimatedCostMicros: 2_000,
    latency: recordLatency(recordLatency(day1.ai.latency, 100), 2_000),
  };
  day1.ai = modelAggregate;
  day1.aiByModel = [{ key: 'gpt-test', aggregate: modelAggregate }];
  day1.aiByPurpose = [{ key: 'weekly_planning_semantic_normalizer', aggregate: modelAggregate }];
  day1.aiByPhase = [{ key: 'initial', aggregate: modelAggregate }];
  day1.aiByOperationKind = [{ key: 'chat_completion', aggregate: modelAggregate }];

  const secondAggregate = {
    ...day2.ai,
    requestCount: 1,
    successCount: 1,
    statusCounts: { success: 1 },
    promptTokens: 20,
    completionTokens: 30,
    totalTokens: 50,
    cachedTokens: 0,
    estimatedCostMicros: 1_000,
    latency: recordLatency(day2.ai.latency, 500),
  };
  day2.ai = secondAggregate;
  day2.aiByModel = [{ key: 'gpt-test', aggregate: secondAggregate }];
  day2.aiByPurpose = [{ key: 'weekly_planning_semantic_normalizer', aggregate: secondAggregate }];
  day2.aiByPhase = [{ key: 'repair', aggregate: secondAggregate }];
  day2.aiByOperationKind = [{ key: 'chat_completion', aggregate: secondAggregate }];

  return {
    schemaVersion: 1,
    fromDate: '2026-08-28',
    toDate: '2026-08-29',
    reportingTimeZone: 'Asia/Tokyo',
    registeredUsers: {
      total: 0,
      newInPeriod: 0,
      registrationIndexReady: true,
      scope: 'firebase_project',
    },
    period: {
      processedEventCount: 3,
      firstOccurredAt: null,
      lastOccurredAt: null,
      productActivity: { eventCount: 0, actionCounts: {} },
      ai: {
        ...modelAggregate,
        requestCount: 3,
        successCount: 2,
        failureCount: 1,
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cachedTokens: 40,
        estimatedCostMicros: 3_000,
        latency: recordLatency(secondAggregate.latency, 2_000),
      },
      planning: {
        outcomeCounts: { session_started: 1, turn_started: 2 },
        previewCountSum: 0,
        previewCountUnknownCount: 0,
        unscheduledCountSum: 0,
        unscheduledCountUnknownCount: 0,
      },
    },
    daily: [day1, day2],
    activeUsers: null,
    aiLatencyP50Ms: 500,
    aiLatencyP95Ms: 2_000,
    rollupCheckpoint: {
      schemaVersion: 1,
      cursor: null,
      processedEventCount: 3,
      activeUserDirtySources: [],
      lastRunStartedAt: null,
      lastSuccessfulRunAt: '2026-08-29T01:00:00.000Z',
      lastFailureAt: null,
      lastFailureCategory: null,
      updatedAt: '2026-08-29T01:00:00.000Z',
    },
  };
}

class FakeReadModel {
  async getOverview() {
    return overview();
  }

  async getUserSummary(actorSubjectId: string) {
    return {
      schemaVersion: 1 as const,
      actorSubjectId,
      firstActivityAt: '2026-08-28T00:00:00.000Z',
      lastActivityAt: '2026-08-29T00:00:00.000Z',
      firstActivityDate: '2026-08-28',
      lastActivityDate: '2026-08-29',
      eventCount: 2,
      productActivityCount: 1,
      aiRequestCount: 1,
      planningOutcomeCount: 0,
      lastProductAction: 'plan_created' as const,
      lastPlanningOutcome: null,
      updatedAt: '2026-08-29T00:00:01.000Z',
    };
  }
}

const profile = {
  id: 'firebase-user-1',
  documentName: 'projects/test/databases/(default)/documents/profiles/firebase-user-1',
  email: 'user@example.com',
  username: 'Kame User',
  registeredAt: '2026-08-20T00:00:00.000Z',
};

class FakeFirestore {
  queryCallCount = 0;
  getCallCount = 0;
  countCollections: string[] = [];

  async getDocument(collection: string, id: string) {
    this.getCallCount += 1;
    return collection === 'profiles' && id === profile.id ? { ...profile } : null;
  }

  async countDocuments(collection: string) {
    this.countCollections.push(collection);
    return 2;
  }

  async queryDocumentsAfter(params: {
    collection: string;
    filters?: Array<{ field: string; value: string }>;
  }) {
    this.queryCallCount += 1;
    if (params.collection === 'profiles') {
      const matches = params.filters?.every((filter) => String(profile[filter.field as keyof typeof profile]) === filter.value) ?? true;
      return matches ? [{ ...profile }] : [];
    }
    return [
      {
        id: 'event-1',
        documentName: 'projects/test/databases/(default)/documents/observability_events/event-1',
        eventId: 'product-activity-1',
        eventType: 'product_activity',
        occurredAt: '2026-08-28T00:00:00.000Z',
        appVersion: '1.0.0',
        payload: { action: 'plan_created' },
        correlation: { featureSessionId: 'feature-1' },
      },
      {
        id: 'event-2',
        documentName: 'projects/test/databases/(default)/documents/observability_events/event-2',
        eventId: 'ai-request-1',
        eventType: 'ai_request_metric',
        occurredAt: '2026-08-29T00:00:00.000Z',
        appVersion: '1.0.0',
        payload: {
          purpose: 'weekly_planning_semantic_normalizer',
          phase: 'initial',
          provider: 'openai',
          model: 'gpt-test',
          status: 'success',
          totalTokens: 50,
          cachedTokens: 20,
          cacheWriteTokens: 5,
          reasoningTokens: 12,
          estimatedCostMicros: null,
          durationMs: 800,
        },
        correlation: { requestId: 'ai-request-1', traceSessionId: 'trace-1' },
      },
    ];
  }
}

class FakeIdentityStore {
  lookupCount = 0;

  async lookupActorSubjectId(firebaseUid: string) {
    this.lookupCount += 1;
    return firebaseUid === profile.id ? 'actor-aaaaaaaa' : null;
  }
}

describe('ProductObservabilityAdminAnalysisService', () => {
  it('merges daily AI dimensions and derives planning efficiency per turn server-side', async () => {
    const service = new ProductObservabilityAdminAnalysisService(
      env,
      new FakeFirestore() as never,
      new FakeReadModel() as never,
    );
    const analysis = await service.getAiAnalysis({
      environment: 'production',
      fromDate: '2026-08-28',
      toDate: '2026-08-29',
    });

    expect(analysis.byModel).toHaveLength(1);
    expect(analysis.byModel[0]).toMatchObject({
      key: 'gpt-test',
      aggregate: {
        requestCount: 3,
        successCount: 2,
        failureCount: 1,
        promptTokens: 100,
        totalTokens: 150,
        cachedTokens: 40,
        estimatedCostMicros: 3_000,
      },
    });
    expect(analysis.byPhase.map((entry) => entry.key)).toEqual(['initial', 'repair']);
    expect(analysis.byOperationKind).toEqual([
      expect.objectContaining({
        key: 'chat_completion',
        aggregate: expect.objectContaining({ requestCount: 3 }),
      }),
    ]);
    expect(analysis.latencyP50Ms).toBe(500);
    expect(analysis.latencyP95Ms).toBe(2_000);
    expect(analysis.planningEfficiency).toMatchObject({
      turnCount: 2,
      requestCount: 3,
      repairRequestCount: 1,
      requestsPerTurn: 1.5,
      estimatedCostMicros: 3_000,
      estimatedCostUnknownCount: 0,
      estimatedCostPerTurnMicros: 1_500,
      cachedTokens: 40,
      promptTokens: 100,
    });
    expect(analysis.planningEfficiency.repairRate).toBeCloseTo(1 / 3);
    expect(analysis.planningEfficiency.cacheHitTokenRatio).toBeCloseTo(0.4);
  });

  it('returns only allowlisted timeline fields and exact actor-day count', async () => {
    const firestore = new FakeFirestore();
    const service = new ProductObservabilityAdminAnalysisService(
      env,
      firestore as never,
      new FakeReadModel() as never,
    );
    const result = await service.getUserInvestigation({
      actorSubjectId: 'actor-aaaaaaaa',
      environment: 'production',
      limit: 50,
    });

    expect(result.activeDayCount).toBe(2);
    expect(firestore.countCollections).toEqual(['observability_actor_day']);
    expect(result.summary?.actorSubjectId).toBe('actor-aaaaaaaa');
    expect(result.timeline).toEqual([
      expect.objectContaining({
        eventType: 'product_activity',
        productAction: 'plan_created',
        featureSessionId: 'feature-1',
      }),
      expect.objectContaining({
        eventType: 'ai_request_metric',
        ai: expect.objectContaining({
          model: 'gpt-test',
          status: 'success',
          cachedTokens: 20,
          cacheWriteTokens: 5,
          reasoningTokens: 12,
        }),
        requestId: 'ai-request-1',
        traceSessionId: 'trace-1',
      }),
    ]);
    expect(result.timeline[1]).not.toHaveProperty('payload');
  });

  it('resolves profile identity only on an explicit bounded exact lookup', async () => {
    const firestore = new FakeFirestore();
    const identityStore = new FakeIdentityStore();
    const service = new ProductObservabilityAdminAnalysisService(
      env,
      firestore as never,
      new FakeReadModel() as never,
      identityStore,
    );

    await expect(service.resolveUserIdentity('us')).rejects.toThrow(
      'observability_identity_search_invalid',
    );
    expect(firestore.queryCallCount).toBe(0);
    expect(firestore.getCallCount).toBe(0);

    const byEmail = await service.resolveUserIdentity('user@example.com');
    expect(byEmail).toEqual([{
      firebaseUid: 'firebase-user-1',
      email: 'user@example.com',
      username: 'Kame User',
      registeredAt: '2026-08-20T00:00:00.000Z',
      actorSubjectId: 'actor-aaaaaaaa',
    }]);
    expect(identityStore.lookupCount).toBe(1);

    const byUid = await service.resolveUserIdentity('firebase-user-1');
    expect(byUid[0]?.actorSubjectId).toBe('actor-aaaaaaaa');
    expect(firestore.getCallCount).toBe(1);
  });

  it('rejects forged event cursors before storage work', async () => {
    const service = new ProductObservabilityAdminAnalysisService(
      env,
      new FakeFirestore() as never,
      new FakeReadModel() as never,
    );
    await expect(service.getUserInvestigation({
      actorSubjectId: 'actor-aaaaaaaa',
      environment: 'production',
      cursor: {
        orderedValue: 'not-a-time',
        documentName: 'projects/test/databases/(default)/documents/other/event-1',
      },
    })).rejects.toThrow('observability_cursor_invalid');
  });
});
