import type { ObservabilityEnvironment } from '../../../shared/productObservabilityContract';
import { listObservabilityDatesInclusive, shiftObservabilityDate as addDays } from '../../../shared/productObservabilityDateRange';
import {
  PRODUCT_OBSERVABILITY_READ_MODEL_VERSION,
  PRODUCT_OBSERVABILITY_REPORTING_TIME_ZONE,
  type ObservabilityActiveUserWindows,
  type ObservabilityDailyRollup,
  type ObservabilityOverviewReadModel,
  type ObservabilityRegisteredUserSummary,
  type ObservabilityRollupCheckpoint,
  type ObservabilityUserSummary,
} from '../../../shared/productObservabilityReadModel';
import { PROFILE_REGISTERED_AT_FIELD } from '../../../shared/profileRegistrationTime';
import {
  FirestoreServiceAccountClient,
  type FirestoreAggregationFilter,
  type FirestoreOrderedCursor,
  type FirestoreOrderedDocument,
  type FirestoreServiceAccountEnv,
  type FirestoreTransactionDocumentKey,
} from './firestoreServiceAccountClient';
import {
  isObservabilityActorSubject,
  readActiveUsers,
  readCheckpoint,
  readDailyRollup,
  readUserSummary,
} from './productObservabilityReadModelCodec';
import { aggregateOverviewPeriod } from './productObservabilityOverviewAggregation';
import {
  latencyPercentileMs,
} from './productObservabilityReadModelProjection';

const PROFILE_COLLECTION = 'profiles';
const USER_SUMMARY_COLLECTION_PREFIX = 'observability_user_summary';
const DAILY_ROLLUP_COLLECTION = 'observability_daily_rollups';
const ACTIVE_USER_WINDOW_COLLECTION = 'observability_active_user_windows';
const ROLLUP_STATE_COLLECTION = 'observability_rollup_state';
const ROLLUP_STATE_ID = 'main';
const USER_SUMMARY_PAGE_SIZE = 100;
const MAX_OVERVIEW_DAYS = 93;
const MIN_CANONICAL_REGISTRATION_TIMESTAMP = '0001-01-01T00:00:00.000Z';

interface ObservabilityReadFirestore {
  getDocument(collection: string, id: string): Promise<Record<string, unknown> | null>;
  batchGetDocuments(
    collection: string,
    ids: readonly string[],
  ): Promise<Array<Record<string, unknown> | null>>;
  batchGetDocumentKeys(
    keys: readonly FirestoreTransactionDocumentKey[],
  ): Promise<Array<Record<string, unknown> | null>>;
  countDocuments(
    collection: string,
    filters?: readonly FirestoreAggregationFilter[],
  ): Promise<number>;
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

function reportingDateStartIso(localDate: string): string {
  const instant = new Date(`${localDate}T00:00:00+09:00`);
  if (!Number.isFinite(instant.getTime())) throw new Error('observability_date_range_invalid');
  return instant.toISOString();
}

function dailyId(environment: ObservabilityEnvironment, localDate: string): string {
  return `${environment}:${localDate}`;
}

function userSummaryCollection(environment: ObservabilityEnvironment): string {
  return `${USER_SUMMARY_COLLECTION_PREFIX}_${environment}`;
}

function validateUserCursor(
  cursor: FirestoreOrderedCursor | null | undefined,
  collection: string,
): void {
  if (!cursor) return;
  if (
    !isObservabilityActorSubject(cursor.orderedValue)
    || !cursor.documentName.includes(`/documents/${collection}/`)
    || !cursor.documentName.endsWith(`/${cursor.orderedValue}`)
  ) {
    throw new Error('observability_cursor_invalid');
  }
}

async function registeredUsersForPeriod(
  firestore: ObservabilityReadFirestore,
  fromDate: string,
  toDate: string,
): Promise<ObservabilityRegisteredUserSummary> {
  const indexedFilter: FirestoreAggregationFilter = {
    field: PROFILE_REGISTERED_AT_FIELD,
    operator: 'GREATER_THAN_OR_EQUAL',
    value: MIN_CANONICAL_REGISTRATION_TIMESTAMP,
    valueType: 'timestamp',
  };
  const [total, indexed] = await Promise.all([
    firestore.countDocuments(PROFILE_COLLECTION),
    firestore.countDocuments(PROFILE_COLLECTION, [indexedFilter]),
  ]);
  const registrationIndexReady = total === indexed;
  const newInPeriod = registrationIndexReady
    ? await firestore.countDocuments(PROFILE_COLLECTION, [
        {
          field: PROFILE_REGISTERED_AT_FIELD,
          operator: 'GREATER_THAN_OR_EQUAL',
          value: reportingDateStartIso(fromDate),
          valueType: 'timestamp',
        },
        {
          field: PROFILE_REGISTERED_AT_FIELD,
          operator: 'LESS_THAN',
          value: reportingDateStartIso(addDays(toDate, 1)),
          valueType: 'timestamp',
        },
      ])
    : null;
  return {
    total,
    newInPeriod,
    registrationIndexReady,
    scope: 'firebase_project',
  };
}

export class ProductObservabilityReadModelService {
  constructor(
    env: ProductObservabilityReadModelEnv,
    private readonly firestore: ObservabilityReadFirestore = new FirestoreServiceAccountClient(env),
  ) {}

  async getDailyRollups(params: {
    environment: ObservabilityEnvironment;
    fromDate: string;
    toDate: string;
  }): Promise<ObservabilityDailyRollup[]> {
    const dates = listObservabilityDatesInclusive(params.fromDate, params.toDate, MAX_OVERVIEW_DAYS);
    const values = await this.firestore.batchGetDocuments(
      DAILY_ROLLUP_COLLECTION,
      dates.map((localDate) => dailyId(params.environment, localDate)),
    );
    return values
      .map((value, index) => readDailyRollup(value, params.environment, dates[index]))
      .filter((value): value is ObservabilityDailyRollup => Boolean(value));
  }

  async getRollupCheckpoint(): Promise<ObservabilityRollupCheckpoint> {
    return readCheckpoint(await this.firestore.getDocument(
      ROLLUP_STATE_COLLECTION,
      ROLLUP_STATE_ID,
    ));
  }

  async getOverview(params: {
    environment: ObservabilityEnvironment;
    fromDate: string;
    toDate: string;
  }): Promise<ObservabilityOverviewReadModel> {
    const dates = listObservabilityDatesInclusive(params.fromDate, params.toDate, MAX_OVERVIEW_DAYS);
    const [{ daily, activeUsers, checkpoint }, registeredUsers] = await Promise.all([
      this.getPeriodSnapshot(params, dates),
      registeredUsersForPeriod(this.firestore, params.fromDate, params.toDate),
    ]);
    const period = aggregateOverviewPeriod(daily);
    return {
      schemaVersion: PRODUCT_OBSERVABILITY_READ_MODEL_VERSION,
      fromDate: params.fromDate,
      toDate: params.toDate,
      reportingTimeZone: PRODUCT_OBSERVABILITY_REPORTING_TIME_ZONE,
      registeredUsers,
      period,
      daily,
      activeUsers,
      aiLatencyP50Ms: latencyPercentileMs(period.ai.latency, 0.5),
      aiLatencyP95Ms: latencyPercentileMs(period.ai.latency, 0.95),
      rollupCheckpoint: checkpoint,
    };
  }

  async getUserSummary(
    actorSubjectId: string,
    environment: ObservabilityEnvironment = 'production',
  ): Promise<ObservabilityUserSummary | null> {
    const normalized = actorSubjectId.trim();
    if (!isObservabilityActorSubject(normalized)) {
      throw new Error('observability_actor_subject_invalid');
    }
    const value = await this.firestore.getDocument(userSummaryCollection(environment), normalized);
    if (!value) return null;
    const documentName = String(value.id ?? normalized);
    return readUserSummary({
      ...value,
      id: normalized,
      documentName,
    });
  }

  async getUserSummaries(
    actorSubjectIds: readonly string[],
    environment: ObservabilityEnvironment = 'production',
  ): Promise<Array<ObservabilityUserSummary | null>> {
    const normalized = actorSubjectIds.map((actorSubjectId) => actorSubjectId.trim());
    if (normalized.some((actorSubjectId) => !isObservabilityActorSubject(actorSubjectId))) {
      throw new Error('observability_actor_subject_invalid');
    }
    const values = await this.firestore.batchGetDocuments(
      userSummaryCollection(environment),
      normalized,
    );
    return values.map((value, index) => value ? readUserSummary({
      ...value,
      id: normalized[index],
      documentName: `${userSummaryCollection(environment)}/${normalized[index]}`,
    }) : null);
  }

  async getUserTrend(params: {
    environment: ObservabilityEnvironment;
    fromDate: string;
    toDate: string;
  }): Promise<{
    daily: ObservabilityDailyRollup[];
    activeUsers: ObservabilityActiveUserWindows | null;
  }> {
    const dates = listObservabilityDatesInclusive(params.fromDate, params.toDate, MAX_OVERVIEW_DAYS);
    const { daily, activeUsers } = await this.getPeriodSnapshot(params, dates);
    return { daily, activeUsers };
  }

  private async getPeriodSnapshot(params: {
    environment: ObservabilityEnvironment;
    fromDate: string;
    toDate: string;
  }, dates: readonly string[]): Promise<{
    daily: ObservabilityDailyRollup[];
    activeUsers: ObservabilityActiveUserWindows | null;
    checkpoint: ObservabilityRollupCheckpoint;
  }> {
    const keys: FirestoreTransactionDocumentKey[] = [
      ...dates.map((localDate) => ({
        collection: DAILY_ROLLUP_COLLECTION,
        id: dailyId(params.environment, localDate),
      })),
      {
        collection: ACTIVE_USER_WINDOW_COLLECTION,
        id: `${params.environment}:${params.toDate}`,
      },
      { collection: ROLLUP_STATE_COLLECTION, id: ROLLUP_STATE_ID },
    ];
    const values = await this.firestore.batchGetDocumentKeys(keys);
    const checkpoint = readCheckpoint(values[dates.length + 1] ?? null);
    return {
      checkpoint,
      daily: dates
        .map((localDate, index) => readDailyRollup(
          values[index] ?? null,
          params.environment,
          localDate,
        ))
        .filter((value): value is ObservabilityDailyRollup => Boolean(value)),
      activeUsers: readActiveUsers(
        values[dates.length] ?? null,
        params.environment,
        params.toDate,
        checkpoint.activeUserDirtySources,
      ),
    };
  }

  async listUserSummaries(params: {
    environment?: ObservabilityEnvironment;
    cursor?: FirestoreOrderedCursor | null;
    limit?: number;
  } = {}): Promise<ObservabilityUserSummaryPage> {
    const limit = Math.max(1, Math.min(USER_SUMMARY_PAGE_SIZE, params.limit ?? 50));
    const collection = userSummaryCollection(params.environment ?? 'production');
    validateUserCursor(params.cursor, collection);
    const rows = await this.firestore.queryDocumentsAfter({
      collection,
      orderByField: 'actorSubjectId',
      cursor: params.cursor ?? null,
      limit,
    });
    const users = rows.map(readUserSummary);
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
