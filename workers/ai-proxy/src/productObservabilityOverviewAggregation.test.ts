import { describe, expect, it } from 'vitest';
import type { ObservabilityDailyRollup } from '../../../shared/productObservabilityReadModel';
import {
  createEmptyDailyRollup,
  recordLatency,
} from './productObservabilityReadModelProjection';
import { aggregateOverviewPeriod } from './productObservabilityOverviewAggregation';

function daily(localDate: string, latencyMs: number): ObservabilityDailyRollup {
  const base = createEmptyDailyRollup({
    environment: 'production',
    localDate,
    nowIso: `${localDate}T00:00:10.000Z`,
  });
  return {
    ...base,
    processedEventCount: 7,
    activeActorCount: 4,
    firstOccurredAt: `${localDate}T00:00:01.000Z`,
    lastOccurredAt: `${localDate}T00:00:09.000Z`,
    productActivity: {
      eventCount: 2,
      actionCounts: {
        plan_created: 1,
        actual_recorded: 1,
      },
    },
    ai: {
      ...base.ai,
      requestCount: 2,
      successCount: 1,
      failureCount: 1,
      statusCounts: {
        success: 1,
        timeout: 1,
      },
      promptTokens: 100,
      promptTokensUnknownCount: 1,
      completionTokens: 40,
      totalTokens: 140,
      cachedTokens: 20,
      estimatedCostMicros: 1_500,
      latency: recordLatency(base.ai.latency, latencyMs),
    },
    planning: {
      outcomeCounts: {
        session_started: 1,
        preview_generated: 1,
      },
      previewCountSum: 3,
      previewCountUnknownCount: 0,
      unscheduledCountSum: 1,
      unscheduledCountUnknownCount: 0,
    },
  };
}

describe('aggregateOverviewPeriod', () => {
  it('merges only additive period metrics and preserves unknown counters', () => {
    const first = daily('2026-08-28', 90);
    const second = {
      ...daily('2026-08-29', 8_000),
      productActivity: {
        eventCount: 3,
        actionCounts: {
          plan_created: 2,
          todo_completed: 1,
        },
      },
      ai: {
        ...daily('2026-08-29', 8_000).ai,
        promptTokensUnknownCount: 2,
        estimatedCostUnknownCount: 1,
      },
      planning: {
        outcomeCounts: {
          session_started: 1,
          save_completed: 1,
        },
        previewCountSum: 0,
        previewCountUnknownCount: 1,
        unscheduledCountSum: 0,
        unscheduledCountUnknownCount: 1,
      },
    } satisfies ObservabilityDailyRollup;

    const aggregate = aggregateOverviewPeriod([first, second]);

    expect(aggregate.processedEventCount).toBe(14);
    expect(aggregate.firstOccurredAt).toBe('2026-08-28T00:00:01.000Z');
    expect(aggregate.lastOccurredAt).toBe('2026-08-29T00:00:09.000Z');
    expect(aggregate.productActivity).toEqual({
      eventCount: 5,
      actionCounts: {
        plan_created: 3,
        actual_recorded: 1,
        todo_completed: 1,
      },
    });
    expect(aggregate.ai).toMatchObject({
      requestCount: 4,
      successCount: 2,
      failureCount: 2,
      statusCounts: {
        success: 2,
        timeout: 2,
      },
      promptTokens: 200,
      promptTokensUnknownCount: 3,
      estimatedCostMicros: 3_000,
      estimatedCostUnknownCount: 1,
    });
    expect(aggregate.ai.latency.sampleCount).toBe(2);
    expect(aggregate.planning).toEqual({
      outcomeCounts: {
        session_started: 2,
        preview_generated: 1,
        save_completed: 1,
      },
      previewCountSum: 3,
      previewCountUnknownCount: 1,
      unscheduledCountSum: 1,
      unscheduledCountUnknownCount: 1,
    });
    expect(aggregate).not.toHaveProperty('activeActorCount');
  });

  it('returns explicit zero aggregates for an empty period', () => {
    const aggregate = aggregateOverviewPeriod([]);

    expect(aggregate.processedEventCount).toBe(0);
    expect(aggregate.firstOccurredAt).toBeNull();
    expect(aggregate.lastOccurredAt).toBeNull();
    expect(aggregate.productActivity.eventCount).toBe(0);
    expect(aggregate.ai.requestCount).toBe(0);
    expect(aggregate.ai.latency.sampleCount).toBe(0);
    expect(aggregate.planning.outcomeCounts).toEqual({});
  });
});
