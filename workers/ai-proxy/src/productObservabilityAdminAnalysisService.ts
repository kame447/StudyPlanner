import {
  PLANNING_OUTCOME_TYPES,
  PRODUCT_ACTIVITY_ACTIONS,
  type AiRequestMetricStatus,
  type ObservabilityEnvironment,
} from '../../../shared/productObservabilityContract';
import type {
  ObservabilityAiAggregate,
  ObservabilityDailyRollup,
  ObservabilityDimensionAggregate,
} from '../../../shared/productObservabilityReadModel';
import type {
  ObservabilityAiAnalysisReadModel,
  ObservabilityAiDimensionSummary,
  ObservabilityUserInvestigationReadModel,
  ObservabilityUserTimelineItem,
} from '../../../shared/productObservabilityAdminReadModel';
import {
  FirestoreServiceAccountClient,
  type FirestoreOrderedCursor,
} from './firestoreServiceAccountClient';
import {
  createEmptyLatencyHistogram,
  latencyPercentileMs,
  mergeLatencyHistograms,
} from './productObservabilityReadModelProjection';
import {
  ProductObservabilityReadModelService,
  type ProductObservabilityReadModelEnv,
} from './productObservabilityReadModelService';

const EVENT_COLLECTION = 'observability_events';
const ACTOR_DAY_COLLECTION = 'observability_actor_days';
const ACTOR_SUBJECT_PATTERN = /^actor-[A-Za-z0-9-]{8,160}$/;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const activityActions = new Set<string>(PRODUCT_ACTIVITY_ACTIONS);
const planningOutcomes = new Set<string>(PLANNING_OUTCOME_TYPES);
const aiStatuses = new Set<AiRequestMetricStatus>([
  'success',
  'quota_rejected',
  'timeout',
  'network_failure',
  'provider_error',
  'empty_response',
  'invalid_response',
  'cancelled',
  'unknown_failure',
]);

interface AnalysisFirestore {
  countDocuments(
    collection: string,
    filters?: readonly Array<{
      field: string;
      operator: 'EQUAL';
      value: string;
      valueType?: 'string';
    }>,
  ): Promise<number>;
  queryDocumentsAfter(params: {
    collection: string;
    orderByField: string;
    filters?: Array<{ field: string; value: string }>;
    cursor?: FirestoreOrderedCursor | null;
    limit?: number;
  }): Promise<Array<Record<string, unknown> & { id: string; documentName: string }>>;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function finiteNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
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

function validateEventCursor(cursor: FirestoreOrderedCursor | null | undefined): void {
  if (!cursor) return;
  if (!Number.isFinite(new Date(cursor.orderedValue).getTime())
    || !cursor.documentName.includes(`/documents/${EVENT_COLLECTION}/`)) {
    throw new Error('observability_cursor_invalid');
  }
}

function timelineItem(value: Record<string, unknown>): ObservabilityUserTimelineItem | null {
  const eventType = value.eventType;
  const eventId = value.eventId;
  const occurredAt = value.occurredAt;
  const appVersion = value.appVersion;
  if ((eventType !== 'product_activity'
      && eventType !== 'ai_request_metric'
      && eventType !== 'planning_outcome')
    || typeof eventId !== 'string'
    || typeof occurredAt !== 'string'
    || !Number.isFinite(new Date(occurredAt).getTime())
    || typeof appVersion !== 'string') {
    return null;
  }

  const payload = record(value.payload) ?? {};
  const correlation = record(value.correlation) ?? {};
  const productAction = eventType === 'product_activity'
    && typeof payload.action === 'string'
    && activityActions.has(payload.action)
    ? payload.action as ObservabilityUserTimelineItem['productAction']
    : null;
  const planningOutcome = eventType === 'planning_outcome'
    && typeof payload.outcomeType === 'string'
    && planningOutcomes.has(payload.outcomeType)
    ? payload.outcomeType as ObservabilityUserTimelineItem['planningOutcome']
    : null;

  let ai: ObservabilityUserTimelineItem['ai'] = null;
  if (eventType === 'ai_request_metric'
    && typeof payload.purpose === 'string'
    && (payload.phase === 'initial'
      || payload.phase === 'repair'
      || payload.phase === 'single'
      || payload.phase === 'unknown')
    && (payload.provider === 'openai' || payload.provider === 'gemini')
    && typeof payload.model === 'string'
    && typeof payload.status === 'string'
    && aiStatuses.has(payload.status as AiRequestMetricStatus)) {
    ai = {
      purpose: payload.purpose,
      phase: payload.phase,
      provider: payload.provider,
      model: payload.model,
      status: payload.status as AiRequestMetricStatus,
      totalTokens: finiteNonNegativeInteger(payload.totalTokens),
      estimatedCostMicros: finiteNonNegativeInteger(payload.estimatedCostMicros),
      durationMs: finiteNonNegativeNumber(payload.durationMs) ?? 0,
    };
  }

  const correlationValue = (key: 'featureSessionId' | 'requestId' | 'traceSessionId') =>
    typeof correlation[key] === 'string' && correlation[key].trim() ? correlation[key] as string : null;

  return {
    eventId,
    eventType,
    occurredAt,
    appVersion,
    productAction,
    ai,
    planningOutcome,
    featureSessionId: correlationValue('featureSessionId'),
    requestId: correlationValue('requestId'),
    traceSessionId: correlationValue('traceSessionId'),
  };
}

export class ProductObservabilityAdminAnalysisService {
  private readonly readModel: ProductObservabilityReadModelService;

  constructor(
    env: ProductObservabilityReadModelEnv,
    private readonly firestore: AnalysisFirestore = new FirestoreServiceAccountClient(env),
    readModel?: ProductObservabilityReadModelService,
  ) {
    this.readModel = readModel ?? new ProductObservabilityReadModelService(env);
  }

  async getAiAnalysis(params: {
    environment: ObservabilityEnvironment;
    fromDate: string;
    toDate: string;
  }): Promise<ObservabilityAiAnalysisReadModel> {
    const overview = await this.readModel.getOverview(params);
    return {
      fromDate: overview.fromDate,
      toDate: overview.toDate,
      environment: params.environment,
      reportingTimeZone: overview.reportingTimeZone,
      total: overview.period.ai,
      latencyP50Ms: overview.aiLatencyP50Ms,
      latencyP95Ms: overview.aiLatencyP95Ms,
      byModel: mergeDimensions(overview.daily, (entry) => entry.aiByModel),
      byPurpose: mergeDimensions(overview.daily, (entry) => entry.aiByPurpose),
      byPhase: mergeDimensions(overview.daily, (entry) => entry.aiByPhase),
      rollupCheckpoint: overview.rollupCheckpoint,
    };
  }

  async getUserInvestigation(params: {
    actorSubjectId: string;
    environment: ObservabilityEnvironment;
    cursor?: FirestoreOrderedCursor | null;
    limit?: number;
  }): Promise<ObservabilityUserInvestigationReadModel> {
    const actorSubjectId = params.actorSubjectId.trim();
    if (!ACTOR_SUBJECT_PATTERN.test(actorSubjectId)) {
      throw new Error('observability_actor_subject_invalid');
    }
    validateEventCursor(params.cursor);
    const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, params.limit ?? DEFAULT_PAGE_SIZE));
    const [summary, activeDayCount, rows] = await Promise.all([
      this.readModel.getUserSummary(actorSubjectId, params.environment),
      this.firestore.countDocuments(ACTOR_DAY_COLLECTION, [
        { field: 'actorSubjectId', operator: 'EQUAL', value: actorSubjectId },
        { field: 'environment', operator: 'EQUAL', value: params.environment },
      ]),
      this.firestore.queryDocumentsAfter({
        collection: EVENT_COLLECTION,
        orderByField: 'occurredAt',
        filters: [
          { field: 'actorSubjectId', value: actorSubjectId },
          { field: 'environment', value: params.environment },
        ],
        cursor: params.cursor ?? null,
        limit,
      }),
    ]);
    const timeline = rows
      .map((row) => timelineItem(row))
      .filter((item): item is ObservabilityUserTimelineItem => Boolean(item));
    const last = rows[rows.length - 1];
    return {
      environment: params.environment,
      actorSubjectId,
      summary,
      activeDayCount,
      timeline,
      nextCursor: rows.length === limit && last
        ? {
            orderedValue: String(last.occurredAt ?? ''),
            documentName: last.documentName,
          }
        : null,
    };
  }
}
