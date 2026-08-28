import type { ObservabilityEnvironment } from '../../../shared/productObservabilityContract';
import {
  OBSERVABILITY_LATENCY_HISTOGRAM_VERSION,
  PRODUCT_OBSERVABILITY_READ_MODEL_VERSION,
  PRODUCT_OBSERVABILITY_REPORTING_TIME_ZONE,
  type ObservabilityActiveUserDirtySource,
  type ObservabilityActiveUserWindows,
  type ObservabilityDailyRollup,
  type ObservabilityOverviewReadModel,
  type ObservabilityRollupCheckpoint,
  type ObservabilityUserSummary,
} from '../../../shared/productObservabilityReadModel';
import {
  FirestoreServiceAccountClient,
  type FirestoreOrderedCursor,
  type FirestoreOrderedDocument,
  type FirestoreServiceAccountEnv,
} from './firestoreServiceAccountClient';
import {
  createEmptyLatencyHistogram,
  latencyPercentileMs,
  mergeLatencyHistograms,
} from './productObservabilityReadModelProjection';

const USER_SUMMARY_COLLECTION_PREFIX = 'observability_user_summary';
const DAILY_ROLLUP_COLLECTION = 'observability_daily_rollups';
const ACTIVE_USER_WINDOW_COLLECTION = 'observability_active_user_windows';
const ROLLUP_STATE_COLLECTION = 'observability_rollup_state';
const ROLLUP_STATE_ID = 'main';
const USER_SUMMARY_PAGE_SIZE = 100;
const MAX_OVERVIEW_DAYS = 93;
const OBSERVABILITY_ENVIRONMENTS = new Set<ObservabilityEnvironment>([
  'production',
  'preview',
  'development',
  'test',
]);

interface ObservabilityReadFirestore {
  getDocument(collection: string, id: string): Promise<Record<string, unknown> | null>;
  queryDocumentsAfter(params: {
    collection: string;
    orderByField: string;
    filters?: Array<{ field: string; value: string }>;
    cursor?: FirestoreOrderedCursor | null;
    limit?: number;
  }): Promise<FirestoreOrderedDocument[]>;
}

export interface ProductObservabilityReadModelEnv extends FirestoreServiceAccountEnv {}

export interface ObservabilityUserSummaryPage {
  users: ObservabilityUserSummary[];
  nextCursor: FirestoreOrderedCursor | null;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(new Date(`${value}T00:00:00.000Z`).getTime());
}

function isEnvironment(value: unknown): value is ObservabilityEnvironment {
  return typeof value === 'string'
    && OBSERVABILITY_ENVIRONMENTS.has(value as ObservabilityEnvironment);
}

function listDatesInclusive(fromDate: string, toDate: string): string[] {
  if (!isIsoDate(fromDate) || !isIsoDate(toDate) || fromDate > toDate) {
    throw new Error('observability_date_range_invalid');
  }
  const start = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  const result: string[] = [];
  for (let current = start.getTime(); current <= end.getTime(); current += 86_400_000) {
    result.push(new Date(current).toISOString().slice(0, 10));
    if (result.length > MAX_OVERVIEW_DAYS) {
      throw new Error('observability_date_range_too_large');
    }
  }
  return result;
}

function addDays(localDate: string, offset: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function dailyId(environment: ObservabilityEnvironment, localDate: string): string {
  return `${environment}:${localDate}`;
}

function activeUserWindowId(environment: ObservabilityEnvironment, asOfDate: string): string {
  return `${environment}:${asOfDate}`;
}

function userSummaryCollection(environment: ObservabilityEnvironment): string {
  return `${USER_SUMMARY_COLLECTION_PREFIX}_${environment}`;
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

function readCheckpoint(value: Record<string, unknown> | null): ObservabilityRollupCheckpoint {
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

function asUserSummary(value: FirestoreOrderedDocument): ObservabilityUserSummary {
  const { documentName: _documentName, id: _id, ...document } = value;
  return document as unknown as ObservabilityUserSummary;
}

function assertCompatibleLatency(daily: readonly ObservabilityDailyRollup[]): void {
  const incompatible = daily.find(
    (entry) => entry.ai.latency.version !== OBSERVABILITY_LATENCY_HISTOGRAM_VERSION,
  );
  if (incompatible) throw new Error('observability_latency_histogram_version_mismatch');
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

function readActiveUsers(
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

export class ProductObservabilityReadModelService {
  constructor(
    env: ProductObservabilityReadModelEnv,
    private readonly firestore: ObservabilityReadFirestore = new FirestoreServiceAccountClient(env),
  ) {}

  async getOverview(params: {
    environment: ObservabilityEnvironment;
    fromDate: string;
    toDate: string;
  }): Promise<ObservabilityOverviewReadModel> {
    const dates = listDatesInclusive(params.fromDate, params.toDate);
    const [daily, activeUsersValue, checkpointValue] = await Promise.all([
      Promise.all(dates.map(async (localDate) => withoutStorageId<ObservabilityDailyRollup>(
        await this.firestore.getDocument(
          DAILY_ROLLUP_COLLECTION,
          dailyId(params.environment, localDate),
        ),
      ))),
      this.firestore.getDocument(
        ACTIVE_USER_WINDOW_COLLECTION,
        activeUserWindowId(params.environment, params.toDate),
      ),
      this.firestore.getDocument(ROLLUP_STATE_COLLECTION, ROLLUP_STATE_ID),
    ]);
    const presentDaily = daily.filter((value): value is ObservabilityDailyRollup => Boolean(value));
    assertCompatibleLatency(presentDaily);
    const latency = presentDaily.length > 0
      ? mergeLatencyHistograms(presentDaily.map((entry) => entry.ai.latency))
      : createEmptyLatencyHistogram();
    const checkpoint = readCheckpoint(checkpointValue);
    return {
      schemaVersion: PRODUCT_OBSERVABILITY_READ_MODEL_VERSION,
      fromDate: params.fromDate,
      toDate: params.toDate,
      reportingTimeZone: PRODUCT_OBSERVABILITY_REPORTING_TIME_ZONE,
      daily: presentDaily,
      activeUsers: readActiveUsers(
        activeUsersValue,
        params.environment,
        params.toDate,
        checkpoint.activeUserDirtySources,
      ),
      aiLatencyP50Ms: latencyPercentileMs(latency, 0.5),
      aiLatencyP95Ms: latencyPercentileMs(latency, 0.95),
      rollupCheckpoint: checkpoint,
    };
  }

  async getUserSummary(
    actorSubjectId: string,
    environment: ObservabilityEnvironment = 'production',
  ): Promise<ObservabilityUserSummary | null> {
    const normalized = actorSubjectId.trim();
    if (!/^actor-[A-Za-z0-9-]{8,160}$/.test(normalized)) {
      throw new Error('observability_actor_subject_invalid');
    }
    return withoutStorageId<ObservabilityUserSummary>(
      await this.firestore.getDocument(userSummaryCollection(environment), normalized),
    );
  }

  async listUserSummaries(params: {
    environment?: ObservabilityEnvironment;
    cursor?: FirestoreOrderedCursor | null;
    limit?: number;
  } = {}): Promise<ObservabilityUserSummaryPage> {
    const limit = Math.max(1, Math.min(USER_SUMMARY_PAGE_SIZE, params.limit ?? 50));
    const rows = await this.firestore.queryDocumentsAfter({
      collection: userSummaryCollection(params.environment ?? 'production'),
      orderByField: 'actorSubjectId',
      cursor: params.cursor ?? null,
      limit,
    });
    const users = rows.map(asUserSummary);
    const last = rows[rows.length - 1];
    return {
      users,
      nextCursor: rows.length === limit && last
        ? {
            orderedValue: String(last.actorSubjectId ?? ''),
            documentName: last.documentName,
          }
        : null,
    };
  }
}
