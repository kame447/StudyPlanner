import type {
  ProductActivityAction,
} from '../../../shared/productObservabilityContract';
import {
  aiCacheWriteUsage,
  type ObservabilityAiAggregate,
  type ObservabilityDailyRollup,
  type ObservabilityPeriodAggregate,
  type ObservabilityPlanningAggregate,
} from '../../../shared/productObservabilityReadModel';
import {
  createEmptyLatencyHistogram,
  mergeLatencyHistograms,
} from './productObservabilityReadModelProjection';

function addCountRecord<T extends string>(
  target: Partial<Record<T, number>>,
  source: Partial<Record<T, number>>,
): Partial<Record<T, number>> {
  const result = { ...target };
  for (const [key, value] of Object.entries(source) as Array<[T, number | undefined]>) {
    if (value === undefined) continue;
    result[key] = (result[key] ?? 0) + value;
  }
  return result;
}

function emptyAiAggregate(): ObservabilityAiAggregate {
  return {
    requestCount: 0,
    successCount: 0,
    failureCount: 0,
    statusCounts: {},
    promptTokens: 0,
    promptTokensUnknownCount: 0,
    completionTokens: 0,
    completionTokensUnknownCount: 0,
    totalTokens: 0,
    totalTokensUnknownCount: 0,
    cachedTokens: 0,
    cachedTokensUnknownCount: 0,
    cacheWriteTokens: 0,
    cacheWriteTokensUnknownCount: 0,
    estimatedCostMicros: 0,
    estimatedCostUnknownCount: 0,
    latency: createEmptyLatencyHistogram(),
  };
}

function mergeAiAggregates(
  values: readonly ObservabilityAiAggregate[],
): ObservabilityAiAggregate {
  return values.reduce<ObservabilityAiAggregate>((merged, value) => {
    const mergedCacheWrite = aiCacheWriteUsage(merged);
    const valueCacheWrite = aiCacheWriteUsage(value);
    return {
      requestCount: merged.requestCount + value.requestCount,
      successCount: merged.successCount + value.successCount,
      failureCount: merged.failureCount + value.failureCount,
      statusCounts: addCountRecord(merged.statusCounts, value.statusCounts),
      promptTokens: merged.promptTokens + value.promptTokens,
      promptTokensUnknownCount: merged.promptTokensUnknownCount + value.promptTokensUnknownCount,
      completionTokens: merged.completionTokens + value.completionTokens,
      completionTokensUnknownCount: merged.completionTokensUnknownCount + value.completionTokensUnknownCount,
      totalTokens: merged.totalTokens + value.totalTokens,
      totalTokensUnknownCount: merged.totalTokensUnknownCount + value.totalTokensUnknownCount,
      cachedTokens: merged.cachedTokens + value.cachedTokens,
      cachedTokensUnknownCount: merged.cachedTokensUnknownCount + value.cachedTokensUnknownCount,
      cacheWriteTokens: mergedCacheWrite.tokens + valueCacheWrite.tokens,
      cacheWriteTokensUnknownCount: mergedCacheWrite.unknownCount + valueCacheWrite.unknownCount,
      estimatedCostMicros: merged.estimatedCostMicros + value.estimatedCostMicros,
      estimatedCostUnknownCount: merged.estimatedCostUnknownCount + value.estimatedCostUnknownCount,
      latency: mergeLatencyHistograms([merged.latency, value.latency]),
    };
  }, emptyAiAggregate());
}

/** Counts by typed key; undefined when no rollup carries them (unmeasured), otherwise the sum over those that do. */
function mergeOptionalCounts<T extends string>(
  values: ReadonlyArray<Partial<Record<T, number>> | undefined>,
): Partial<Record<T, number>> | undefined {
  const present = values.filter((value): value is Partial<Record<T, number>> => value !== undefined);
  return present.length === 0 ? undefined : present.reduce<Partial<Record<T, number>>>((sum, value) => addCountRecord(sum, value), {});
}

function mergePlanningAggregates(
  values: readonly ObservabilityPlanningAggregate[],
): ObservabilityPlanningAggregate {
  const merged = values.reduce<ObservabilityPlanningAggregate>((merged, value) => ({
    outcomeCounts: addCountRecord(merged.outcomeCounts, value.outcomeCounts),
    previewCountSum: merged.previewCountSum + value.previewCountSum,
    previewCountUnknownCount: merged.previewCountUnknownCount + value.previewCountUnknownCount,
    unscheduledCountSum: merged.unscheduledCountSum + value.unscheduledCountSum,
    unscheduledCountUnknownCount:
      merged.unscheduledCountUnknownCount + value.unscheduledCountUnknownCount,
  }), {
    outcomeCounts: {},
    previewCountSum: 0,
    previewCountUnknownCount: 0,
    unscheduledCountSum: 0,
    unscheduledCountUnknownCount: 0,
  });
  const questionCodeCounts = mergeOptionalCounts(values.map(value => value.questionCodeCounts));
  const rejectionReasonCounts = mergeOptionalCounts(values.map(value => value.rejectionReasonCounts));
  return {
    ...merged,
    ...(questionCodeCounts ? { questionCodeCounts } : {}),
    ...(rejectionReasonCounts ? { rejectionReasonCounts } : {}),
    // Days that carry the counts: the period's counts cover only those; the rest are unmeasured, not zero.
    ...(questionCodeCounts ? { questionCountDays: values.filter(value => value.questionCodeCounts !== undefined).length } : {}),
  };
}

function firstTimestamp(values: readonly (string | null)[]): string | null {
  const timestamps = values.filter((value): value is string => value !== null);
  return timestamps.length > 0
    ? timestamps.reduce((earliest, value) => value < earliest ? value : earliest)
    : null;
}

function lastTimestamp(values: readonly (string | null)[]): string | null {
  const timestamps = values.filter((value): value is string => value !== null);
  return timestamps.length > 0
    ? timestamps.reduce((latest, value) => value > latest ? value : latest)
    : null;
}

export function aggregateOverviewPeriod(
  daily: readonly ObservabilityDailyRollup[],
): ObservabilityPeriodAggregate {
  return {
    processedEventCount: daily.reduce((sum, entry) => sum + entry.processedEventCount, 0),
    firstOccurredAt: firstTimestamp(daily.map((entry) => entry.firstOccurredAt)),
    lastOccurredAt: lastTimestamp(daily.map((entry) => entry.lastOccurredAt)),
    productActivity: {
      eventCount: daily.reduce((sum, entry) => sum + entry.productActivity.eventCount, 0),
      actionCounts: daily.reduce<Partial<Record<ProductActivityAction, number>>>(
        (counts, entry) => addCountRecord(counts, entry.productActivity.actionCounts),
        {},
      ),
    },
    ai: mergeAiAggregates(daily.map((entry) => entry.ai)),
    planning: mergePlanningAggregates(daily.map((entry) => entry.planning)),
  };
}
