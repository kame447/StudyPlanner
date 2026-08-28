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
  ObservabilityAdminIdentityMatch,
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
import { ProductObservabilityStore } from './productObservabilityStore';

const EVENT_COLLECTION = 'observability_events';
const ACTOR_DAY_COLLECTION = 'observability_actor_day';
const PROFILE_COLLECTION = 'profiles';
const ACTOR_SUBJECT_PATTERN = /^actor-[A-Za-z0-9-]{8,160}$/;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_IDENTITY_MATCHES = 5;
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
  getDocument(collection: string, id: string): Promise<Record<string, unknown> | null>;
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

interface IdentityStore {
  lookupActorSubjectId(firebaseUid: string): Promise<string | null>;
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

function isPlanningPurpose(key: string): boolean {
  return key.startsWith('weekly_planning') || key.startsWith('planning_');
}

function validateEventCursor(cursor: FirestoreOrderedCursor | null | undefined): void {
  if (!cursor) return;
  if (!Number.isFinite(new Date(cursor.orderedValue).getTime())
    || !cursor.documentName.includes(`/documents/${EVENT_COLLECTION}/`)) {
    throw new Error('observability_cursor_invalid');
  }
}

function profileString(profile: Record<string, unknown>, key: string): string {
  const value = profile[key];
  return typeof value === 'string' ? value.trim() : '';
}

function registeredAt(profile: Record<string, unknown>): string | null {
  const canonical = profileString(profile, 'registeredAt');
  if (canonical && Number.isFinite(new Date(canonical).getTime())) return canonical;
  return null;
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
      cachedTokens: finiteNonNegativeInteger(payload.cachedTokens),
      cacheWriteTokens: finiteNonNegativeInteger(payload.cacheWriteTokens),
      reasoningTokens: finiteNonNegativeInteger(payload.reasoningTokens),
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
  private readonly identityStore: IdentityStore;

  constructor(
    env: ProductObservabilityReadModelEnv,
    private readonly firestore: AnalysisFirestore = new FirestoreServiceAccountClient(env),
    readModel?: ProductObservabilityReadModelService,
    identityStore?: IdentityStore,
  ) {
    this.readModel = readModel ?? new ProductObservabilityReadModelService(env);
    this.identityStore = identityStore ?? new ProductObservabilityStore(env);
  }

  async getAiAnalysis(params: {
    environment: ObservabilityEnvironment;
    fromDate: string;
    toDate: string;
  }): Promise<ObservabilityAiAnalysisReadModel> {
    const overview = await this.readModel.getOverview(params);
    const byModel = mergeDimensions(overview.daily, (entry) => entry.aiByModel);
    const byPurpose = mergeDimensions(overview.daily, (entry) => entry.aiByPurpose);
    const byPhase = mergeDimensions(overview.daily, (entry) => entry.aiByPhase);
    const byOperationKind = mergeDimensions(
      overview.daily,
      (entry) => entry.aiByOperationKind ?? [],
    );
    const planningAggregate = byPurpose
      .filter((entry) => isPlanningPurpose(entry.key))
      .reduce(
        (aggregate, entry) => mergeAiAggregate(aggregate, entry.aggregate),
        emptyAiAggregate(),
      );
    const initialRequestCount = byPhase.find((entry) => entry.key === 'initial')?.aggregate.requestCount ?? 0;
    const repairRequestCount = byPhase.find((entry) => entry.key === 'repair')?.aggregate.requestCount ?? 0;
    const repairEligibleCount = initialRequestCount + repairRequestCount;
    const turnCount = overview.period.planning.outcomeCounts.turn_started ?? 0;
    const cacheKnown = planningAggregate.promptTokensUnknownCount === 0
      && planningAggregate.cachedTokensUnknownCount === 0;

    return {
      fromDate: overview.fromDate,
      toDate: overview.toDate,
      environment: params.environment,
      reportingTimeZone: overview.reportingTimeZone,
      total: overview.period.ai,
      latencyP50Ms: overview.aiLatencyP50Ms,
      latencyP95Ms: overview.aiLatencyP95Ms,
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
      rollupCheckpoint: overview.rollupCheckpoint,
    };
  }

  async resolveUserIdentity(searchValue: string): Promise<ObservabilityAdminIdentityMatch[]> {
    const search = searchValue.trim();
    if (search.length < 3 || search.length > 160) {
      throw new Error('observability_identity_search_invalid');
    }

    const profiles = new Map<string, Record<string, unknown>>();
    if (search.includes('@')) {
      const rows = await this.firestore.queryDocumentsAfter({
        collection: PROFILE_COLLECTION,
        orderByField: 'email',
        filters: [{ field: 'email', value: search.toLowerCase() }],
        limit: MAX_IDENTITY_MATCHES,
      });
      rows.forEach((row) => profiles.set(row.id, row));
    } else {
      const [byId, byUsername] = await Promise.all([
        this.firestore.getDocument(PROFILE_COLLECTION, search),
        this.firestore.queryDocumentsAfter({
          collection: PROFILE_COLLECTION,
          orderByField: 'username',
          filters: [{ field: 'username', value: search }],
          limit: MAX_IDENTITY_MATCHES,
        }),
      ]);
      if (byId) profiles.set(search, byId);
      byUsername.forEach((row) => profiles.set(row.id, row));
    }

    return Promise.all([...profiles.entries()].slice(0, MAX_IDENTITY_MATCHES).map(
      async ([firebaseUid, profile]): Promise<ObservabilityAdminIdentityMatch> => ({
        firebaseUid,
        email: profileString(profile, 'email'),
        username: profileString(profile, 'username') || profileString(profile, 'email') || firebaseUid,
        registeredAt: registeredAt(profile),
        actorSubjectId: await this.identityStore.lookupActorSubjectId(firebaseUid),
      }),
    ));
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
