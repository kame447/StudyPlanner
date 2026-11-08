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

  it('merges cache-write tokens and reads a day without the field as unknown for all its requests', () => {
    const current = daily('2026-11-08', 90);
    const legacy = daily('2026-11-07', 90);
    delete (legacy.ai as { cacheWriteTokens?: number }).cacheWriteTokens;
    delete (legacy.ai as { cacheWriteTokensUnknownCount?: number }).cacheWriteTokensUnknownCount;
    const withWrite = { ...current, ai: { ...current.ai, cacheWriteTokens: 300, cacheWriteTokensUnknownCount: 1 } };

    expect(aggregateOverviewPeriod([legacy, withWrite]).ai).toMatchObject({ cacheWriteTokens: 300, cacheWriteTokensUnknownCount: 3 });
  });

  it('merges typed question and rejection counts over the days that carry them, and reports the rest as unmeasured', () => {
    const withCounts = (date: string, questions: Record<string, number>, rejections: Record<string, number>) => {
      const entry = daily(date, 90);
      return { ...entry, planning: { ...entry.planning, questionCodeCounts: questions, rejectionReasonCounts: rejections } } as ObservabilityDailyRollup;
    };
    const legacy = daily('2026-11-07', 90);
    const merged = aggregateOverviewPeriod([legacy, withCounts('2026-11-08', { duplicate_quantity: 2, missing_effort_estimate: 1 }, { rejected_after_repair: 1 }),
      withCounts('2026-11-09', { duplicate_quantity: 1 }, {})]).planning;
    expect(merged.questionCodeCounts).toEqual({ duplicate_quantity: 3, missing_effort_estimate: 1 });
    expect(merged.rejectionReasonCounts).toEqual({ rejected_after_repair: 1 });
    expect(merged.questionCountDays).toBe(2);
    // Only legacy days: unmeasured, not an empty map.
    const unmeasured = aggregateOverviewPeriod([legacy]).planning;
    expect(unmeasured).not.toHaveProperty('questionCodeCounts');
    expect(unmeasured).not.toHaveProperty('rejectionReasonCounts');
    expect(unmeasured).not.toHaveProperty('questionCountDays');
  });

  it('returns explicit zero aggregates for an empty period', () => {
    const aggregate = aggregateOverviewPeriod([]);

    expect(aggregate.processedEventCount).toBe(0);
    expect(aggregate.firstOccurredAt).toBeNull();
    expect(aggregate.lastOccurredAt).toBeNull();
    expect(aggregate.productActivity.eventCount).toBe(0);
    expect(aggregate.ai.requestCount).toBe(0);
    expect(aggregate.ai.latency.sampleCount).toBe(0);
    expect(aggregate.planning).toEqual({
      outcomeCounts: {},
      previewCountSum: 0,
      previewCountUnknownCount: 0,
      unscheduledCountSum: 0,
      unscheduledCountUnknownCount: 0,
    });

    aggregate.planning.outcomeCounts.session_started = 1;
    const next = aggregateOverviewPeriod([]);
    expect(next.planning).not.toBe(aggregate.planning);
    expect(next.planning.outcomeCounts).not.toBe(aggregate.planning.outcomeCounts);
    expect(next.planning.outcomeCounts).toEqual({});
  });
});
