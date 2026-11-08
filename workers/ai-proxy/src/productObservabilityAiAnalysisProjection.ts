import type { ObservabilityEnvironment } from '../../../shared/productObservabilityContract';
import {
  aiCacheWriteUsage,
  PRODUCT_OBSERVABILITY_REPORTING_TIME_ZONE,
  type ObservabilityAiAggregate,
  type ObservabilityDailyRollup,
  type ObservabilityDimensionAggregate,
  type ObservabilityRollupCheckpoint,
} from '../../../shared/productObservabilityReadModel';
import type {
  ObservabilityAiAnalysisReadModel,
  ObservabilityAiDimensionSummary,
} from '../../../shared/productObservabilityAdminReadModel';
import {
  createEmptyLatencyHistogram,
  latencyPercentileMs,
  mergeLatencyHistograms,
} from './productObservabilityReadModelProjection';
import { aggregateOverviewPeriod } from './productObservabilityOverviewAggregation';

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

function mergeCountRecord<T extends string>(
  left: Partial<Record<T, number>>,
  right: Partial<Record<T, number>>,
): Partial<Record<T, number>> {
  const merged = { ...left };
  for (const [key, value] of Object.entries(right) as Array<[T, number | undefined]>) {
    if (value === undefined) continue;
    merged[key] = (merged[key] ?? 0) + value;
  }
  return merged;
}

function mergeAiAggregate(
  left: ObservabilityAiAggregate,
  right: ObservabilityAiAggregate,
): ObservabilityAiAggregate {
  const leftCacheWrite = aiCacheWriteUsage(left);
  const rightCacheWrite = aiCacheWriteUsage(right);
  return {
    requestCount: left.requestCount + right.requestCount,
    successCount: left.successCount + right.successCount,
    failureCount: left.failureCount + right.failureCount,
    statusCounts: mergeCountRecord(left.statusCounts, right.statusCounts),
    promptTokens: left.promptTokens + right.promptTokens,
    promptTokensUnknownCount: left.promptTokensUnknownCount + right.promptTokensUnknownCount,
    completionTokens: left.completionTokens + right.completionTokens,
    completionTokensUnknownCount:
      left.completionTokensUnknownCount + right.completionTokensUnknownCount,
    totalTokens: left.totalTokens + right.totalTokens,
    totalTokensUnknownCount: left.totalTokensUnknownCount + right.totalTokensUnknownCount,
    cachedTokens: left.cachedTokens + right.cachedTokens,
    cachedTokensUnknownCount: left.cachedTokensUnknownCount + right.cachedTokensUnknownCount,
    cacheWriteTokens: leftCacheWrite.tokens + rightCacheWrite.tokens,
    cacheWriteTokensUnknownCount: leftCacheWrite.unknownCount + rightCacheWrite.unknownCount,
    estimatedCostMicros: left.estimatedCostMicros + right.estimatedCostMicros,
    estimatedCostUnknownCount:
      left.estimatedCostUnknownCount + right.estimatedCostUnknownCount,
    latency: mergeLatencyHistograms([left.latency, right.latency]),
  };
}

function mergeDimensions(
  daily: readonly ObservabilityDailyRollup[],
  select: (rollup: ObservabilityDailyRollup) =>
    Array<ObservabilityDimensionAggregate<ObservabilityAiAggregate>>,
): ObservabilityAiDimensionSummary[] {
  const byKey = new Map<string, ObservabilityAiAggregate>();
  for (const rollup of daily) {
    for (const entry of select(rollup)) {
      byKey.set(
        entry.key,
        mergeAiAggregate(byKey.get(entry.key) ?? emptyAiAggregate(), entry.aggregate),
      );
    }
  }
  return [...byKey.entries()]
    .map(([key, aggregate]) => ({
      key,
      aggregate,
      latencyP50Ms: latencyPercentileMs(aggregate.latency, 0.5),
      latencyP95Ms: latencyPercentileMs(aggregate.latency, 0.95),
    }))
    .sort((left, right) =>
      right.aggregate.requestCount - left.aggregate.requestCount || left.key.localeCompare(right.key),
    );
}

export function projectObservabilityAiAnalysis(
  params: {
    environment: ObservabilityEnvironment;
    fromDate: string;
    toDate: string;
  },
  daily: readonly ObservabilityDailyRollup[],
  rollupCheckpoint: ObservabilityRollupCheckpoint,
): ObservabilityAiAnalysisReadModel {
  const period = aggregateOverviewPeriod(daily);
  const byModel = mergeDimensions(daily, (entry) => entry.aiByModel);
  const byPurpose = mergeDimensions(daily, (entry) => entry.aiByPurpose);
  const byPhase = mergeDimensions(daily, (entry) => entry.aiByPhase);
  const byOperationKind = mergeDimensions(
    daily,
    (entry) => entry.aiByOperationKind ?? [],
  );
  const planningAggregate = byPurpose
    .filter((entry) => entry.key.startsWith('weekly_planning') || entry.key.startsWith('planning_'))
    .reduce(
      (aggregate, entry) => mergeAiAggregate(aggregate, entry.aggregate),
      emptyAiAggregate(),
    );
  const initialRequestCount = byPhase.find((entry) => entry.key === 'initial')?.aggregate.requestCount ?? 0;
  const repairRequestCount = byPhase.find((entry) => entry.key === 'repair')?.aggregate.requestCount ?? 0;
  const repairEligibleCount = initialRequestCount + repairRequestCount;
  const turnCount = period.planning.outcomeCounts.turn_started ?? 0;
  const cacheKnown = planningAggregate.promptTokensUnknownCount === 0
    && planningAggregate.cachedTokensUnknownCount === 0;

  return {
    fromDate: params.fromDate,
    toDate: params.toDate,
    environment: params.environment,
    reportingTimeZone: PRODUCT_OBSERVABILITY_REPORTING_TIME_ZONE,
    total: period.ai,
    latencyP50Ms: latencyPercentileMs(period.ai.latency, 0.5),
    latencyP95Ms: latencyPercentileMs(period.ai.latency, 0.95),
    byModel,
    byPurpose,
    byPhase,
    byOperationKind,
    planningEfficiency: {
      turnCount,
      requestCount: planningAggregate.requestCount,
      repairRequestCount,
      repairRate: repairEligibleCount > 0 ? repairRequestCount / repairEligibleCount : null,
      requestsPerTurn: turnCount > 0 ? planningAggregate.requestCount / turnCount : null,
      estimatedCostMicros: planningAggregate.estimatedCostMicros,
      estimatedCostUnknownCount: planningAggregate.estimatedCostUnknownCount,
      estimatedCostPerTurnMicros:
        turnCount > 0 && planningAggregate.estimatedCostUnknownCount === 0
          ? planningAggregate.estimatedCostMicros / turnCount
          : null,
      cachedTokens: planningAggregate.cachedTokens,
      promptTokens: planningAggregate.promptTokens,
      cacheHitTokenRatio:
        cacheKnown && planningAggregate.promptTokens > 0
          ? planningAggregate.cachedTokens / planningAggregate.promptTokens
          : null,
    },
    rollupCheckpoint,
  };
}
