import type {
  ProductActivityAction,
} from '../../../shared/productObservabilityContract';
import type {
  ObservabilityAiAggregate,
  ObservabilityDailyRollup,
  ObservabilityPeriodAggregate,
  ObservabilityPlanningAggregate,
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
    estimatedCostMicros: 0,
    estimatedCostUnknownCount: 0,
    latency: createEmptyLatencyHistogram(),
  };
}

function emptyPlanningAggregate(): ObservabilityPlanningAggregate {
  return {
    outcomeCounts: {},
    previewCountSum: 0,
    previewCountUnknownCount: 0,
    unscheduledCountSum: 0,
    unscheduledCountUnknownCount: 0,
  };
}

function mergeAiAggregates(
  values: readonly ObservabilityAiAggregate[],
): ObservabilityAiAggregate {
  return values.reduce<ObservabilityAiAggregate>((merged, value) => ({
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
    estimatedCostMicros: merged.estimatedCostMicros + value.estimatedCostMicros,
    estimatedCostUnknownCount: merged.estimatedCostUnknownCount + value.estimatedCostUnknownCount,
    latency: mergeLatencyHistograms([merged.latency, value.latency]),
  }), emptyAiAggregate());
}

function mergePlanningAggregates(
  values: readonly ObservabilityPlanningAggregate[],
): ObservabilityPlanningAggregate {
  return values.reduce<ObservabilityPlanningAggregate>((merged, value) => ({
    outcomeCounts: addCountRecord(merged.outcomeCounts, value.outcomeCounts),
    previewCountSum: merged.previewCountSum + value.previewCountSum,
    previewCountUnknownCount: merged.previewCountUnknownCount + value.previewCountUnknownCount,
    unscheduledCountSum: merged.unscheduledCountSum + value.unscheduledCountSum,
    unscheduledCountUnknownCount:
      merged.unscheduledCountUnknownCount + value.unscheduledCountUnknownCount,
  }), emptyPlanningAggregate());
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
