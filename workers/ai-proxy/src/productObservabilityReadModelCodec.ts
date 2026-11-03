import { readObservabilityRejectionEvidence } from '../../../shared/productObservabilityReadModel';
import type { ObservabilityEnvironment } from '../../../shared/productObservabilityContract';
import { shiftObservabilityDate as addDays } from '../../../shared/productObservabilityDateRange';
import {
  OBSERVABILITY_LATENCY_BUCKET_UPPER_BOUNDS_MS,
  OBSERVABILITY_LATENCY_HISTOGRAM_VERSION,
  PRODUCT_OBSERVABILITY_READ_MODEL_VERSION,
  PRODUCT_OBSERVABILITY_REPORTING_TIME_ZONE,
  PRODUCT_OBSERVABILITY_USER_ENRICHMENT_VERSION,
  type ObservabilityActiveUserDirtySource,
  type ObservabilityActiveUserWindows,
  type ObservabilityDailyRollup,
  type ObservabilityRollupCheckpoint,
  type ObservabilityUserSummary,
} from '../../../shared/productObservabilityReadModel';
import type { FirestoreOrderedDocument } from './firestoreServiceAccountClient';

const ACTOR_SUBJECT_PATTERN = /^actor-[A-Za-z0-9-]{8,160}$/;
const OBSERVABILITY_ENVIRONMENTS = new Set<ObservabilityEnvironment>([
  'production',
  'preview',
  'development',
  'test',
]);

export function isObservabilityActorSubject(value: string): boolean {
  return ACTOR_SUBJECT_PATTERN.test(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(new Date(`${value}T00:00:00.000Z`).getTime());
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime());
}

function isEnvironment(value: unknown): value is ObservabilityEnvironment {
  return typeof value === 'string'
    && OBSERVABILITY_ENVIRONMENTS.has(value as ObservabilityEnvironment);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}


function withoutStorageId<T>(value: Record<string, unknown> | null): T | null {
  if (!value) return null;
  const { id: _id, ...document } = value;
  return document as unknown as T;
}

function checkpointDirtySources(value: unknown): ObservabilityActiveUserDirtySource[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('observability_checkpoint_invalid');
  const byKey = new Map<string, ObservabilityActiveUserDirtySource>();
  for (const item of value) {
    if (!item || typeof item !== 'object') throw new Error('observability_checkpoint_invalid');
    const record = item as Record<string, unknown>;
    if (
      !isEnvironment(record.environment)
      || !isIsoDate(record.localDate)
      || !Number.isSafeInteger(record.revision)
      || Number(record.revision) < 1
    ) {
      throw new Error('observability_checkpoint_invalid');
    }
    const source: ObservabilityActiveUserDirtySource = {
      environment: record.environment,
      localDate: record.localDate,
      revision: Number(record.revision),
    };
    const key = `${source.environment}:${source.localDate}`;
    const existing = byKey.get(key);
    if (!existing || source.revision > existing.revision) byKey.set(key, source);
  }
  return [...byKey.values()].sort((left, right) =>
    `${left.environment}:${left.localDate}`.localeCompare(`${right.environment}:${right.localDate}`));
}

export function readCheckpoint(value: Record<string, unknown> | null): ObservabilityRollupCheckpoint {
  const nowIso = new Date().toISOString();
  if (value?.schemaVersion !== undefined
    && value.schemaVersion !== PRODUCT_OBSERVABILITY_READ_MODEL_VERSION) {
    throw new Error('observability_read_model_version_mismatch');
  }
  const cursorRecord = value?.cursor && typeof value.cursor === 'object'
    ? value.cursor as Record<string, unknown>
    : null;
  return {
    schemaVersion: PRODUCT_OBSERVABILITY_READ_MODEL_VERSION,
    cursor: cursorRecord
      && typeof cursorRecord.observedAt === 'string'
      && typeof cursorRecord.documentName === 'string'
      ? {
          observedAt: cursorRecord.observedAt,
          documentName: cursorRecord.documentName,
        }
      : null,
    processedEventCount: Number.isSafeInteger(value?.processedEventCount)
      ? Math.max(0, Number(value?.processedEventCount))
      : 0,
    ...readObservabilityRejectionEvidence(value),
    activeUserDirtySources: checkpointDirtySources(value?.activeUserDirtySources),
    lastRunStartedAt: typeof value?.lastRunStartedAt === 'string' ? value.lastRunStartedAt : null,
    lastSuccessfulRunAt: typeof value?.lastSuccessfulRunAt === 'string'
      ? value.lastSuccessfulRunAt
      : null,
    lastFailureAt: typeof value?.lastFailureAt === 'string' ? value.lastFailureAt : null,
    lastFailureCategory: typeof value?.lastFailureCategory === 'string'
      ? value.lastFailureCategory
      : null,
    updatedAt: typeof value?.updatedAt === 'string' ? value.updatedAt : nowIso,
  };
}

export function readDailyRollup(
  value: Record<string, unknown> | null,
  environment: ObservabilityEnvironment,
  localDate: string,
): ObservabilityDailyRollup | null {
  const daily = withoutStorageId<ObservabilityDailyRollup>(value);
  if (!daily) return null;
  const latency = daily.ai?.latency;
  const latencyBuckets = latency?.bucketCounts;
  const bucketCount = OBSERVABILITY_LATENCY_BUCKET_UPPER_BOUNDS_MS.length + 1;
  const latencyValid = latency?.version === OBSERVABILITY_LATENCY_HISTOGRAM_VERSION
    && Array.isArray(latencyBuckets)
    && latencyBuckets.length === bucketCount
    && latencyBuckets.every(isNonNegativeSafeInteger)
    && isNonNegativeSafeInteger(latency.sampleCount)
    && latencyBuckets.reduce((sum, count) => sum + count, 0) === latency.sampleCount
    && typeof latency.sumMs === 'number'
    && Number.isFinite(latency.sumMs)
    && latency.sumMs >= 0
    && (latency.minMs === null || (typeof latency.minMs === 'number' && Number.isFinite(latency.minMs) && latency.minMs >= 0))
    && (latency.maxMs === null || (typeof latency.maxMs === 'number' && Number.isFinite(latency.maxMs) && latency.maxMs >= 0))
    && (latency.sampleCount === 0 || (latency.minMs !== null && latency.maxMs !== null && latency.minMs <= latency.maxMs));
  const aiCountsValid = isNonNegativeSafeInteger(daily.ai?.requestCount)
    && isNonNegativeSafeInteger(daily.ai?.successCount)
    && isNonNegativeSafeInteger(daily.ai?.failureCount)
    && daily.ai.successCount + daily.ai.failureCount === daily.ai.requestCount
    && daily.ai.requestCount <= daily.processedEventCount;
  const firstOccurredValid = daily.firstOccurredAt === null || isIsoTimestamp(daily.firstOccurredAt);
  const lastOccurredValid = daily.lastOccurredAt === null || isIsoTimestamp(daily.lastOccurredAt);
  const timeRangeValid = firstOccurredValid
    && lastOccurredValid
    && (daily.firstOccurredAt === null) === (daily.lastOccurredAt === null)
    && (daily.firstOccurredAt === null || daily.lastOccurredAt === null || daily.firstOccurredAt <= daily.lastOccurredAt);
  if (
    daily.schemaVersion !== PRODUCT_OBSERVABILITY_READ_MODEL_VERSION
    || daily.environment !== environment
    || daily.localDate !== localDate
    || daily.reportingTimeZone !== PRODUCT_OBSERVABILITY_REPORTING_TIME_ZONE
    || !isNonNegativeSafeInteger(daily.processedEventCount)
    || !isNonNegativeSafeInteger(daily.activeActorCount)
    || daily.activeActorCount > daily.processedEventCount
    || !isNonNegativeSafeInteger(daily.productActivity?.eventCount)
    || daily.productActivity.eventCount > daily.processedEventCount
    || !aiCountsValid
    || !latencyValid
    || !timeRangeValid
  ) {
    throw new Error('observability_daily_rollup_invalid');
  }
  return daily;
}

export function readUserSummary(value: FirestoreOrderedDocument): ObservabilityUserSummary {
  const { documentName: _documentName, id: _id, ...document } = value;
  const user = document as unknown as ObservabilityUserSummary;
  const enrichmentFieldsPresent = user.userEnrichmentVersion !== undefined
    || user.activeDayCount !== undefined
    || user.latestErrorAt !== undefined
    || user.latestErrorCategory !== undefined
    || user.userEnrichmentUpdatedAt !== undefined;
  const enrichmentValid = !enrichmentFieldsPresent || (
    user.userEnrichmentVersion === PRODUCT_OBSERVABILITY_USER_ENRICHMENT_VERSION
    && isNonNegativeSafeInteger(user.activeDayCount)
    && (user.latestErrorAt === null || isIsoTimestamp(user.latestErrorAt))
    && (user.latestErrorCategory === null
      || (typeof user.latestErrorCategory === 'string' && Boolean(user.latestErrorCategory.trim())))
    && (user.latestErrorAt === null) === (user.latestErrorCategory === null)
    && isIsoTimestamp(user.userEnrichmentUpdatedAt)
  );
  if (
    user.schemaVersion !== PRODUCT_OBSERVABILITY_READ_MODEL_VERSION
    || !isObservabilityActorSubject(user.actorSubjectId)
    || !isIsoTimestamp(user.firstActivityAt)
    || !isIsoTimestamp(user.lastActivityAt)
    || user.firstActivityAt > user.lastActivityAt
    || !isIsoDate(user.firstActivityDate)
    || !isIsoDate(user.lastActivityDate)
    || user.firstActivityDate > user.lastActivityDate
    || !isNonNegativeSafeInteger(user.eventCount)
    || !isNonNegativeSafeInteger(user.productActivityCount)
    || !isNonNegativeSafeInteger(user.aiRequestCount)
    || !isNonNegativeSafeInteger(user.planningOutcomeCount)
    || user.productActivityCount + user.aiRequestCount + user.planningOutcomeCount !== user.eventCount
    || !enrichmentValid
  ) {
    throw new Error('observability_user_summary_invalid');
  }
  return user;
}

function activeUserSnapshotIsDirty(
  dirtySources: readonly ObservabilityActiveUserDirtySource[],
  environment: ObservabilityEnvironment,
  asOfDate: string,
): boolean {
  const firstIncludedDate = addDays(asOfDate, -29);
  return dirtySources.some((source) =>
    source.environment === environment
    && source.localDate >= firstIncludedDate
    && source.localDate <= asOfDate);
}

export function readActiveUsers(
  value: Record<string, unknown> | null,
  environment: ObservabilityEnvironment,
  asOfDate: string,
  dirtySources: readonly ObservabilityActiveUserDirtySource[],
): ObservabilityActiveUserWindows | null {
  const snapshot = withoutStorageId<ObservabilityActiveUserWindows>(value);
  if (!snapshot || activeUserSnapshotIsDirty(dirtySources, environment, asOfDate)) return null;
  if (
    snapshot.schemaVersion !== PRODUCT_OBSERVABILITY_READ_MODEL_VERSION
    || snapshot.environment !== environment
    || snapshot.asOfDate !== asOfDate
    || snapshot.reportingTimeZone !== PRODUCT_OBSERVABILITY_REPORTING_TIME_ZONE
    || !Number.isSafeInteger(snapshot.today)
    || !Number.isSafeInteger(snapshot.last7Days)
    || !Number.isSafeInteger(snapshot.last30Days)
    || snapshot.today < 0
    || snapshot.last7Days < snapshot.today
    || snapshot.last30Days < snapshot.last7Days
  ) {
    throw new Error('observability_active_user_snapshot_invalid');
  }
  return snapshot;
}
