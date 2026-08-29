import type {
  AiRequestMetricPayload,
  PlanningOutcomeMetricPayload,
  ProductActivityTelemetryDraft,
  StoredObservabilityEvent,
} from '../../../shared/productObservabilityContract';
import {
  OBSERVABILITY_LATENCY_BUCKET_UPPER_BOUNDS_MS,
  OBSERVABILITY_LATENCY_HISTOGRAM_VERSION,
  PRODUCT_OBSERVABILITY_READ_MODEL_VERSION,
  PRODUCT_OBSERVABILITY_REPORTING_TIME_ZONE,
  type ObservabilityActorDay,
  type ObservabilityAiAggregate,
  type ObservabilityDailyRollup,
  type ObservabilityDimensionAggregate,
  type ObservabilityLatencyHistogram,
  type ObservabilityPlanningAggregate,
  type ObservabilityUserSummary,
} from '../../../shared/productObservabilityReadModel';

export type StoredProductObservabilityEvent =
  | StoredObservabilityEvent<ProductActivityTelemetryDraft['payload']>
  | StoredObservabilityEvent<AiRequestMetricPayload>
  | StoredObservabilityEvent<PlanningOutcomeMetricPayload>;

const READ_MODEL_RETENTION_DAYS = 400;
const MAX_DAILY_DIMENSION_VALUES = 32;
const OTHER_DIMENSION_KEY = '__other__';

function expiryFrom(nowIso: string): string {
  return new Date(
    new Date(nowIso).getTime() + READ_MODEL_RETENTION_DAYS * 86_400_000,
  ).toISOString();
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

export function observabilityReportingDate(occurredAt: string): string {
  const date = new Date(occurredAt);
  if (!Number.isFinite(date.getTime())) throw new Error('Observability occurredAt is invalid.');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PRODUCT_OBSERVABILITY_REPORTING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function createEmptyLatencyHistogram(): ObservabilityLatencyHistogram {
  return {
    version: OBSERVABILITY_LATENCY_HISTOGRAM_VERSION,
    bucketCounts: Array(OBSERVABILITY_LATENCY_BUCKET_UPPER_BOUNDS_MS.length + 1).fill(0),
    sampleCount: 0,
    sumMs: 0,
    minMs: null,
    maxMs: null,
  };
}

export function recordLatency(
  current: ObservabilityLatencyHistogram,
  durationMs: number,
): ObservabilityLatencyHistogram {
  const duration = finiteNonNegative(durationMs);
  if (duration === null) return current;
  const bucketIndex = OBSERVABILITY_LATENCY_BUCKET_UPPER_BOUNDS_MS.findIndex(
    (upper) => duration <= upper,
  );
  const index = bucketIndex >= 0
    ? bucketIndex
    : OBSERVABILITY_LATENCY_BUCKET_UPPER_BOUNDS_MS.length;
  const bucketCounts = [...current.bucketCounts];
  while (bucketCounts.length < OBSERVABILITY_LATENCY_BUCKET_UPPER_BOUNDS_MS.length + 1) {
    bucketCounts.push(0);
  }
  bucketCounts[index] = (bucketCounts[index] ?? 0) + 1;
  return {
    version: OBSERVABILITY_LATENCY_HISTOGRAM_VERSION,
    bucketCounts,
    sampleCount: current.sampleCount + 1,
    sumMs: current.sumMs + duration,
    minMs: current.minMs === null ? duration : Math.min(current.minMs, duration),
    maxMs: current.maxMs === null ? duration : Math.max(current.maxMs, duration),
  };
}

export function mergeLatencyHistograms(
  histograms: readonly ObservabilityLatencyHistogram[],
): ObservabilityLatencyHistogram {
  return histograms.reduce((merged, histogram) => {
    const bucketCounts = merged.bucketCounts.map(
      (value, index) => value + (histogram.bucketCounts[index] ?? 0),
    );
    return {
      version: OBSERVABILITY_LATENCY_HISTOGRAM_VERSION,
      bucketCounts,
      sampleCount: merged.sampleCount + histogram.sampleCount,
      sumMs: merged.sumMs + histogram.sumMs,
      minMs: histogram.minMs === null
        ? merged.minMs
        : merged.minMs === null
          ? histogram.minMs
          : Math.min(merged.minMs, histogram.minMs),
      maxMs: histogram.maxMs === null
        ? merged.maxMs
        : merged.maxMs === null
          ? histogram.maxMs
          : Math.max(merged.maxMs, histogram.maxMs),
    };
  }, createEmptyLatencyHistogram());
}

export function latencyPercentileMs(
  histogram: ObservabilityLatencyHistogram,
  percentile: number,
): number | null {
  if (histogram.sampleCount <= 0) return null;
  const target = Math.max(1, Math.ceil(histogram.sampleCount * percentile));
  let cumulative = 0;
  for (let index = 0; index < histogram.bucketCounts.length; index += 1) {
    cumulative += histogram.bucketCounts[index] ?? 0;
    if (cumulative < target) continue;
    if (index < OBSERVABILITY_LATENCY_BUCKET_UPPER_BOUNDS_MS.length) {
      return OBSERVABILITY_LATENCY_BUCKET_UPPER_BOUNDS_MS[index];
    }
    return histogram.maxMs;
  }
  return histogram.maxMs;
}

function createEmptyAiAggregate(): ObservabilityAiAggregate {
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

function createEmptyPlanningAggregate(): ObservabilityPlanningAggregate {
  return {
    outcomeCounts: {},
    previewCountSum: 0,
    previewCountUnknownCount: 0,
    unscheduledCountSum: 0,
    unscheduledCountUnknownCount: 0,
  };
}

export function createEmptyDailyRollup(params: {
  environment: StoredProductObservabilityEvent['environment'];
  localDate: string;
  nowIso: string;
}): ObservabilityDailyRollup {
  return {
    schemaVersion: PRODUCT_OBSERVABILITY_READ_MODEL_VERSION,
    environment: params.environment,
    localDate: params.localDate,
    reportingTimeZone: PRODUCT_OBSERVABILITY_REPORTING_TIME_ZONE,
    processedEventCount: 0,
    activeActorCount: 0,
    firstOccurredAt: null,
    lastOccurredAt: null,
    productActivity: {
      eventCount: 0,
      actionCounts: {},
    },
    ai: createEmptyAiAggregate(),
    aiByModel: [],
    aiByPurpose: [],
    aiByPhase: [],
    aiByOperationKind: [],
    planning: createEmptyPlanningAggregate(),
    planningBySchedulerVersion: [],
    planningByPromptVersion: [],
    planningByModel: [],
    updatedAt: params.nowIso,
    expireAt: expiryFrom(params.nowIso),
  };
}

function addNullableMetric(
  currentValue: number,
  currentUnknown: number,
  value: number | null,
): [number, number] {
  return value === null
    ? [currentValue, currentUnknown + 1]
    : [currentValue + value, currentUnknown];
}

function addAiPayload(
  current: ObservabilityAiAggregate,
  payload: AiRequestMetricPayload,
): ObservabilityAiAggregate {
  const promptTokens = finiteNonNegative(payload.promptTokens);
  const completionTokens = finiteNonNegative(payload.completionTokens);
  const totalTokens = finiteNonNegative(payload.totalTokens);
  const cachedTokens = finiteNonNegative(payload.cachedTokens);
  const estimatedCostMicros = finiteNonNegative(payload.estimatedCostMicros);
  const [nextPrompt, promptUnknown] = addNullableMetric(
    current.promptTokens,
    current.promptTokensUnknownCount,
    promptTokens,
  );
  const [nextCompletion, completionUnknown] = addNullableMetric(
    current.completionTokens,
    current.completionTokensUnknownCount,
    completionTokens,
  );
  const [nextTotal, totalUnknown] = addNullableMetric(
    current.totalTokens,
    current.totalTokensUnknownCount,
    totalTokens,
  );
  const [nextCached, cachedUnknown] = addNullableMetric(
    current.cachedTokens,
    current.cachedTokensUnknownCount,
    cachedTokens,
  );
  const [nextCost, costUnknown] = addNullableMetric(
    current.estimatedCostMicros,
    current.estimatedCostUnknownCount,
    estimatedCostMicros,
  );
  return {
    requestCount: current.requestCount + 1,
    successCount: current.successCount + (payload.status === 'success' ? 1 : 0),
    failureCount: current.failureCount + (payload.status === 'success' ? 0 : 1),
    statusCounts: {
      ...current.statusCounts,
      [payload.status]: (current.statusCounts[payload.status] ?? 0) + 1,
    },
    promptTokens: nextPrompt,
    promptTokensUnknownCount: promptUnknown,
    completionTokens: nextCompletion,
    completionTokensUnknownCount: completionUnknown,
    totalTokens: nextTotal,
    totalTokensUnknownCount: totalUnknown,
    cachedTokens: nextCached,
    cachedTokensUnknownCount: cachedUnknown,
    estimatedCostMicros: nextCost,
    estimatedCostUnknownCount: costUnknown,
    latency: recordLatency(current.latency, payload.durationMs),
  };
}

function normalizedDimensionKey(value: string | null | undefined): string {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 128) : 'unknown';
}

function updateDimension<TAggregate>(params: {
  values: Array<ObservabilityDimensionAggregate<TAggregate>>;
  key: string | null | undefined;
  create(): TAggregate;
  update(current: TAggregate): TAggregate;
}): Array<ObservabilityDimensionAggregate<TAggregate>> {
  const requestedKey = normalizedDimensionKey(params.key);
  const existing = params.values.find((entry) => entry.key === requestedKey);
  if (existing) {
    return params.values.map((entry) => entry.key === requestedKey
      ? { ...entry, aggregate: params.update(entry.aggregate) }
      : entry);
  }
  const key = params.values.length < MAX_DAILY_DIMENSION_VALUES
    ? requestedKey
    : OTHER_DIMENSION_KEY;
  const overflow = params.values.find((entry) => entry.key === key);
  if (overflow) {
    return params.values.map((entry) => entry.key === key
      ? { ...entry, aggregate: params.update(entry.aggregate) }
      : entry);
  }
  return [...params.values, { key, aggregate: params.update(params.create()) }];
}

function addPlanningPayload(
  current: ObservabilityPlanningAggregate,
  payload: PlanningOutcomeMetricPayload,
): ObservabilityPlanningAggregate {
  let previewCountSum = current.previewCountSum;
  let previewCountUnknownCount = current.previewCountUnknownCount;
  if (payload.outcomeType === 'preview_generated') {
    [previewCountSum, previewCountUnknownCount] = addNullableMetric(
      previewCountSum,
      previewCountUnknownCount,
      finiteNonNegative(payload.previewCount),
    );
  }

  let unscheduledCountSum = current.unscheduledCountSum;
  let unscheduledCountUnknownCount = current.unscheduledCountUnknownCount;
  if (payload.outcomeType === 'preview_generated' || payload.outcomeType === 'unscheduled_observed') {
    [unscheduledCountSum, unscheduledCountUnknownCount] = addNullableMetric(
      unscheduledCountSum,
      unscheduledCountUnknownCount,
      finiteNonNegative(payload.unscheduledCount),
    );
  }

  return {
    outcomeCounts: {
      ...current.outcomeCounts,
      [payload.outcomeType]: (current.outcomeCounts[payload.outcomeType] ?? 0) + 1,
    },
    previewCountSum,
    previewCountUnknownCount,
    unscheduledCountSum,
    unscheduledCountUnknownCount,
  };
}

export function projectDailyRollup(params: {
  current: ObservabilityDailyRollup | null;
  event: StoredProductObservabilityEvent;
  actorDayWasNew: boolean;
  nowIso: string;
}): ObservabilityDailyRollup {
  const localDate = observabilityReportingDate(params.event.occurredAt);
  const base = params.current ?? createEmptyDailyRollup({
    environment: params.event.environment,
    localDate,
    nowIso: params.nowIso,
  });
  const next: ObservabilityDailyRollup = {
    ...base,
    processedEventCount: base.processedEventCount + 1,
    activeActorCount: base.activeActorCount + (params.actorDayWasNew ? 1 : 0),
    firstOccurredAt: base.firstOccurredAt === null
      ? params.event.occurredAt
      : base.firstOccurredAt.localeCompare(params.event.occurredAt) <= 0
        ? base.firstOccurredAt
        : params.event.occurredAt,
    lastOccurredAt: base.lastOccurredAt === null
      ? params.event.occurredAt
      : base.lastOccurredAt.localeCompare(params.event.occurredAt) >= 0
        ? base.lastOccurredAt
        : params.event.occurredAt,
    updatedAt: params.nowIso,
    expireAt: expiryFrom(params.nowIso),
  };

  if (params.event.eventType === 'product_activity') {
    const payload = params.event.payload as ProductActivityTelemetryDraft['payload'];
    return {
      ...next,
      productActivity: {
        eventCount: base.productActivity.eventCount + 1,
        actionCounts: {
          ...base.productActivity.actionCounts,
          [payload.action]: (base.productActivity.actionCounts[payload.action] ?? 0) + 1,
        },
      },
    };
  }

  if (params.event.eventType === 'ai_request_metric') {
    const payload = params.event.payload as AiRequestMetricPayload;
    return {
      ...next,
      ai: addAiPayload(base.ai, payload),
      aiByModel: updateDimension({
        values: base.aiByModel,
        key: payload.model,
        create: createEmptyAiAggregate,
        update: (current) => addAiPayload(current, payload),
      }),
      aiByPurpose: updateDimension({
        values: base.aiByPurpose,
        key: payload.purpose,
        create: createEmptyAiAggregate,
        update: (current) => addAiPayload(current, payload),
      }),
      aiByPhase: updateDimension({
        values: base.aiByPhase,
        key: payload.phase,
        create: createEmptyAiAggregate,
        update: (current) => addAiPayload(current, payload),
      }),
      aiByOperationKind: updateDimension({
        values: base.aiByOperationKind ?? [],
        key: payload.operationKind,
        create: createEmptyAiAggregate,
        update: (current) => addAiPayload(current, payload),
      }),
    };
  }

  const payload = params.event.payload as PlanningOutcomeMetricPayload;
  const planning = addPlanningPayload(base.planning, payload);
  return {
    ...next,
    planning,
    planningBySchedulerVersion: payload.schedulerVersion
      ? updateDimension({
          values: base.planningBySchedulerVersion,
          key: payload.schedulerVersion,
          create: createEmptyPlanningAggregate,
          update: (current) => addPlanningPayload(current, payload),
        })
      : base.planningBySchedulerVersion,
    planningByPromptVersion: payload.promptVersion
      ? updateDimension({
          values: base.planningByPromptVersion,
          key: payload.promptVersion,
          create: createEmptyPlanningAggregate,
          update: (current) => addPlanningPayload(current, payload),
        })
      : base.planningByPromptVersion,
    planningByModel: payload.model
      ? updateDimension({
          values: base.planningByModel,
          key: payload.model,
          create: createEmptyPlanningAggregate,
          update: (current) => addPlanningPayload(current, payload),
        })
      : base.planningByModel,
  };
}

export function projectActorDay(params: {
  current: ObservabilityActorDay | null;
  event: StoredProductObservabilityEvent;
  nowIso: string;
}): ObservabilityActorDay {
  const localDate = observabilityReportingDate(params.event.occurredAt);
  const base: ObservabilityActorDay = params.current ?? {
    schemaVersion: PRODUCT_OBSERVABILITY_READ_MODEL_VERSION,
    environment: params.event.environment,
    localDate,
    actorSubjectId: params.event.actorSubjectId,
    firstOccurredAt: params.event.occurredAt,
    lastOccurredAt: params.event.occurredAt,
    eventCount: 0,
    productActivityObserved: false,
    aiRequestObserved: false,
    planningObserved: false,
    updatedAt: params.nowIso,
    expireAt: expiryFrom(params.nowIso),
  };
  return {
    ...base,
    firstOccurredAt: base.firstOccurredAt.localeCompare(params.event.occurredAt) <= 0
      ? base.firstOccurredAt
      : params.event.occurredAt,
    lastOccurredAt: base.lastOccurredAt.localeCompare(params.event.occurredAt) >= 0
      ? base.lastOccurredAt
      : params.event.occurredAt,
    eventCount: base.eventCount + 1,
    productActivityObserved: base.productActivityObserved || params.event.eventType === 'product_activity',
    aiRequestObserved: base.aiRequestObserved || params.event.eventType === 'ai_request_metric',
    planningObserved: base.planningObserved || params.event.eventType === 'planning_outcome',
    updatedAt: params.nowIso,
    expireAt: expiryFrom(params.nowIso),
  };
}

export function projectUserSummary(params: {
  current: ObservabilityUserSummary | null;
  event: StoredProductObservabilityEvent;
  nowIso: string;
}): ObservabilityUserSummary {
  const localDate = observabilityReportingDate(params.event.occurredAt);
  const base: ObservabilityUserSummary = params.current ?? {
    schemaVersion: PRODUCT_OBSERVABILITY_READ_MODEL_VERSION,
    actorSubjectId: params.event.actorSubjectId,
    firstActivityAt: params.event.occurredAt,
    lastActivityAt: params.event.occurredAt,
    firstActivityDate: localDate,
    lastActivityDate: localDate,
    eventCount: 0,
    productActivityCount: 0,
    aiRequestCount: 0,
    planningOutcomeCount: 0,
    lastProductAction: null,
    lastPlanningOutcome: null,
    updatedAt: params.nowIso,
  };
  const productPayload = params.event.eventType === 'product_activity'
    ? params.event.payload as ProductActivityTelemetryDraft['payload']
    : null;
  const planningPayload = params.event.eventType === 'planning_outcome'
    ? params.event.payload as PlanningOutcomeMetricPayload
    : null;
  const isLater = params.event.occurredAt.localeCompare(base.lastActivityAt) >= 0;
  const isEarlier = params.event.occurredAt.localeCompare(base.firstActivityAt) <= 0;
  return {
    ...base,
    firstActivityAt: isEarlier ? params.event.occurredAt : base.firstActivityAt,
    firstActivityDate: isEarlier ? localDate : base.firstActivityDate,
    lastActivityAt: isLater ? params.event.occurredAt : base.lastActivityAt,
    lastActivityDate: isLater ? localDate : base.lastActivityDate,
    eventCount: base.eventCount + 1,
    productActivityCount: base.productActivityCount + (productPayload ? 1 : 0),
    aiRequestCount: base.aiRequestCount + (params.event.eventType === 'ai_request_metric' ? 1 : 0),
    planningOutcomeCount: base.planningOutcomeCount + (planningPayload ? 1 : 0),
    lastProductAction: isLater && productPayload ? productPayload.action : base.lastProductAction,
    lastPlanningOutcome: isLater && planningPayload
      ? planningPayload.outcomeType
      : base.lastPlanningOutcome,
    updatedAt: params.nowIso,
  };
}
