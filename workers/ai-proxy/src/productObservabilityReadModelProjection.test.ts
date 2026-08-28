import { describe, expect, it } from 'vitest';
import type {
  AiRequestMetricPayload,
  PlanningOutcomeMetricPayload,
  ProductActivityTelemetryDraft,
} from '../../../shared/productObservabilityContract';
import {
  latencyPercentileMs,
  mergeLatencyHistograms,
  observabilityReportingDate,
  projectActorDay,
  projectDailyRollup,
  projectUserSummary,
  type StoredProductObservabilityEvent,
} from './productObservabilityReadModelProjection';

function event<TPayload>(params: {
  eventType: 'product_activity' | 'ai_request_metric' | 'planning_outcome';
  payload: TPayload;
  occurredAt?: string;
  actorSubjectId?: string;
}): StoredProductObservabilityEvent {
  return {
    schemaVersion: 1,
    eventId: `event-${params.eventType}-12345678`,
    eventType: params.eventType,
    occurredAt: params.occurredAt ?? '2026-08-28T00:00:00.000Z',
    observedAt: '2026-08-28T00:00:01.000Z',
    actorSubjectId: params.actorSubjectId ?? 'actor-12345678',
    environment: 'production',
    appVersion: '1.0.0',
    source: params.eventType === 'ai_request_metric'
      ? 'ai_proxy'
      : params.eventType === 'planning_outcome'
        ? 'weekly_planning'
        : 'web_app',
    correlation: {},
    payload: params.payload,
    expireAt: '2026-11-26T00:00:01.000Z',
  } as StoredProductObservabilityEvent;
}

function aiPayload(overrides: Partial<AiRequestMetricPayload> = {}): AiRequestMetricPayload {
  return {
    operationKind: 'chat_completion',
    purpose: 'weekly_planning_semantic_normalizer',
    phase: 'initial',
    provider: 'openai',
    model: 'gpt-5.6-luna',
    status: 'success',
    errorCategory: null,
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    cachedTokens: null,
    durationMs: 420,
    requestBytes: 1000,
    responseBytes: 200,
    pricingVersion: null,
    estimatedCostMicros: null,
    ...overrides,
  };
}

function planningPayload(
  overrides: Partial<PlanningOutcomeMetricPayload> = {},
): PlanningOutcomeMetricPayload {
  return {
    outcomeType: 'preview_generated',
    turnIndex: 1,
    stateRevision: 2,
    previewCount: 4,
    unscheduledCount: 0,
    fallbackUsed: false,
    repairUsed: false,
    staleObserved: false,
    approvalFailureObserved: false,
    schedulerVersion: 'scheduler-v1',
    promptVersion: null,
    model: 'gpt-5.6-luna',
    ...overrides,
  };
}

describe('product observability read model projection', () => {
  it('uses Asia/Tokyo as the canonical reporting date', () => {
    expect(observabilityReportingDate('2026-08-27T15:30:00.000Z')).toBe('2026-08-28');
  });

  it('counts an actor once per day while preserving every event', () => {
    const activity = event<ProductActivityTelemetryDraft['payload']>({
      eventType: 'product_activity',
      payload: { action: 'plan_created' },
    });
    const firstActorDay = projectActorDay({ current: null, event: activity, nowIso: activity.observedAt });
    const firstDaily = projectDailyRollup({
      current: null,
      event: activity,
      actorDayWasNew: true,
      nowIso: activity.observedAt,
    });
    const secondDaily = projectDailyRollup({
      current: firstDaily,
      event: activity,
      actorDayWasNew: false,
      nowIso: activity.observedAt,
    });

    expect(firstActorDay.eventCount).toBe(1);
    expect(firstDaily.activeActorCount).toBe(1);
    expect(secondDaily.activeActorCount).toBe(1);
    expect(secondDaily.processedEventCount).toBe(2);
    expect(secondDaily.productActivity.actionCounts.plan_created).toBe(2);
  });

  it('keeps unknown AI usage and cost separate from known zero', () => {
    const unknown = event<AiRequestMetricPayload>({
      eventType: 'ai_request_metric',
      payload: aiPayload(),
    });
    const known = event<AiRequestMetricPayload>({
      eventType: 'ai_request_metric',
      payload: aiPayload({
        promptTokens: 100,
        completionTokens: 25,
        totalTokens: 125,
        cachedTokens: 40,
        estimatedCostMicros: 625,
        durationMs: 1400,
      }),
    });
    const first = projectDailyRollup({
      current: null,
      event: unknown,
      actorDayWasNew: true,
      nowIso: unknown.observedAt,
    });
    const second = projectDailyRollup({
      current: first,
      event: known,
      actorDayWasNew: false,
      nowIso: known.observedAt,
    });

    expect(second.ai.requestCount).toBe(2);
    expect(second.ai.totalTokens).toBe(125);
    expect(second.ai.totalTokensUnknownCount).toBe(1);
    expect(second.ai.estimatedCostMicros).toBe(625);
    expect(second.ai.estimatedCostUnknownCount).toBe(1);
    expect(second.aiByModel[0]?.key).toBe('gpt-5.6-luna');
    expect(second.aiByPurpose[0]?.aggregate.requestCount).toBe(2);
  });

  it('derives percentiles from mergeable latency buckets instead of averaging daily p95', () => {
    const first = projectDailyRollup({
      current: null,
      event: event({ eventType: 'ai_request_metric', payload: aiPayload({ durationMs: 90 }) }),
      actorDayWasNew: true,
      nowIso: '2026-08-28T00:00:02.000Z',
    });
    const second = projectDailyRollup({
      current: null,
      event: event({
        eventType: 'ai_request_metric',
        payload: aiPayload({ durationMs: 8_000 }),
        occurredAt: '2026-08-29T00:00:00.000Z',
      }),
      actorDayWasNew: true,
      nowIso: '2026-08-29T00:00:02.000Z',
    });
    const merged = mergeLatencyHistograms([first.ai.latency, second.ai.latency]);

    expect(merged.sampleCount).toBe(2);
    expect(latencyPercentileMs(merged, 0.5)).toBe(100);
    expect(latencyPercentileMs(merged, 0.95)).toBe(10_000);
  });

  it('aggregates planning outcomes from typed outcome payloads only', () => {
    const preview = event<PlanningOutcomeMetricPayload>({
      eventType: 'planning_outcome',
      payload: planningPayload(),
    });
    const failed = event<PlanningOutcomeMetricPayload>({
      eventType: 'planning_outcome',
      payload: planningPayload({
        outcomeType: 'failed',
        previewCount: null,
        unscheduledCount: null,
        schedulerVersion: null,
      }),
    });
    const first = projectDailyRollup({
      current: null,
      event: preview,
      actorDayWasNew: true,
      nowIso: preview.observedAt,
    });
    const second = projectDailyRollup({
      current: first,
      event: failed,
      actorDayWasNew: false,
      nowIso: failed.observedAt,
    });

    expect(second.planning.outcomeCounts.preview_generated).toBe(1);
    expect(second.planning.outcomeCounts.failed).toBe(1);
    expect(second.planning.previewCountSum).toBe(4);
    expect(second.planning.previewCountUnknownCount).toBe(0);
    expect(second.planningBySchedulerVersion[0]?.key).toBe('scheduler-v1');
  });

  it('updates user summaries without storing raw identity or content', () => {
    const activity = event<ProductActivityTelemetryDraft['payload']>({
      eventType: 'product_activity',
      payload: { action: 'actual_recorded' },
    });
    const summary = projectUserSummary({
      current: null,
      event: activity,
      nowIso: activity.observedAt,
    });

    expect(summary.actorSubjectId).toBe('actor-12345678');
    expect(summary.productActivityCount).toBe(1);
    expect(summary.lastProductAction).toBe('actual_recorded');
    expect(JSON.stringify(summary)).not.toContain('firebase');
    expect(JSON.stringify(summary)).not.toContain('userText');
  });
});
