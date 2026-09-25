import type { ObservabilityEnvironment } from '../../../shared/productObservabilityContract';
import {
  PRODUCT_OBSERVABILITY_READ_MODEL_VERSION,
  PRODUCT_OBSERVABILITY_REPORTING_TIME_ZONE,
  type ObservabilityActiveUserDirtySource,
  type ObservabilityActiveUserWindows,
} from '../../../shared/productObservabilityReadModel';
import {
  FirestoreServiceAccountClient,
  type FirestoreOrderedCursor,
  type FirestoreOrderedDocument,
  type FirestoreServiceAccountEnv,
  type FirestoreTransactionDocumentKey,
  type FirestoreTransactionDocumentWrite,
} from './firestoreServiceAccountClient';
import { observabilityReportingDate } from './productObservabilityReadModelProjection';

const ACTOR_DAY_COLLECTION = 'observability_actor_day';
const ACTIVE_USER_WINDOW_COLLECTION = 'observability_active_user_windows';
export const ACTIVE_USER_SNAPSHOT_JOB_COLLECTION =
  'observability_active_user_snapshot_job';
export const ACTIVE_USER_SNAPSHOT_JOB_ID = 'main';
export const ACTIVE_USER_SNAPSHOT_ACCUMULATOR_COLLECTION =
  'observability_active_user_snapshot_accumulator';

const ACTOR_DAY_PAGE_SIZE = 500;
export const ACTIVE_USER_SNAPSHOT_MAX_PAGE_READS = 35;
export const ACTIVE_USER_SNAPSHOT_SHARD_COUNT = 64;
export const ACTIVE_USER_SNAPSHOT_MAX_SHARD_STORAGE_BYTES = 450_000;
export const ACTIVE_USER_SNAPSHOT_MAX_PUBLISH_TRANSACTION_BYTES = 8 * 1024 * 1024;
export const FIRESTORE_TRANSACTION_LIMIT_BYTES = 10 * 1024 * 1024;
const FIRESTORE_MAX_INDEXED_FIELD_VALUE_BYTES = 1_500;
const ACTOR_FLAGS_ENCODING = 'actor-flags-lines-v1' as const;
const READ_MODEL_RETENTION_DAYS = 400;
const SNAPSHOT_JOB_SCHEMA_VERSION = 1 as const;
const ACTOR_SUBJECT_PATTERN = /^actor-[A-Za-z0-9-]{8,160}$/;
const WINDOW_TODAY = 1;
const WINDOW_LAST_7_DAYS = 2;
const WINDOW_LAST_30_DAYS = 4;

interface ActiveUserSnapshotFirestore {
  beginTransaction(): Promise<string>;
  batchGetDocumentKeys(
    keys: readonly FirestoreTransactionDocumentKey[],
    transaction?: string,
  ): Promise<Array<Record<string, unknown> | null>>;
  queryDocumentsAfter(params: {
    collection: string;
    orderByField: string;
    filters?: Array<{ field: string; value: string }>;
    cursor?: FirestoreOrderedCursor | null;
    limit?: number;
  }): Promise<FirestoreOrderedDocument[]>;
  commitTransaction(
    transaction: string,
    writes: readonly FirestoreTransactionDocumentWrite[],
    deletes?: readonly FirestoreTransactionDocumentKey[],
  ): Promise<void>;
  rollbackTransaction(transaction: string): Promise<void>;
}

export interface ProductObservabilityActiveUserSnapshotEnv extends FirestoreServiceAccountEnv {
  ENVIRONMENT?: string;
}

interface ActiveUserSnapshotJob {
  schemaVersion: typeof SNAPSHOT_JOB_SCHEMA_VERSION;
  status: 'idle' | 'scanning';
  taskKey: string | null;
  source: ObservabilityActiveUserDirtySource | null;
  environment: ObservabilityEnvironment | null;
  targetDate: string | null;
  scanDateIndex: number;
  cursor: FirestoreOrderedCursor | null;
  updatedAt: string;
}

interface ActiveUserSnapshotAccumulatorShard {
  schemaVersion: typeof SNAPSHOT_JOB_SCHEMA_VERSION;
  taskKey: string;
  shard: number;
  actors: Record<string, number>;
  updatedAt: string;
}

interface StoredActiveUserSnapshotAccumulatorShard {
  schemaVersion: typeof SNAPSHOT_JOB_SCHEMA_VERSION;
  taskKey: string;
  shard: number;
  actorFlagsEncoding: typeof ACTOR_FLAGS_ENCODING;
  actorFlags: string;
  updatedAt: string;
}

export interface ProductObservabilityActiveUserSnapshotBatchResult {
  pageReads: number;
  published: boolean;
  hasMore: boolean;
  completedSource: ObservabilityActiveUserDirtySource | null;
}

function normalizedEnvironment(value: string | undefined): ObservabilityEnvironment {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'preview' || normalized === 'development' || normalized === 'test') {
    return normalized;
  }
  return 'production';
}

function isEnvironment(value: unknown): value is ObservabilityEnvironment {
  return value === 'production'
    || value === 'preview'
    || value === 'development'
    || value === 'test';
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(new Date(`${value}T00:00:00.000Z`).getTime());
}

function addDays(localDate: string, offset: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) throw new Error('observability_date_invalid');
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function datesEndingAt(asOfDate: string, days: number): string[] {
  return Array.from({ length: days }, (_, index) => addDays(asOfDate, index - days + 1));
}

function snapshotId(environment: ObservabilityEnvironment, asOfDate: string): string {
  return `${environment}:${asOfDate}`;
}

function expiryFrom(nowIso: string): string {
  return new Date(
    new Date(nowIso).getTime() + READ_MODEL_RETENTION_DAYS * 86_400_000,
  ).toISOString();
}

function dirtySourceKey(source: ObservabilityActiveUserDirtySource): string {
  return `${source.environment}:${source.localDate}:${source.revision}`;
}

function sameSource(
  left: ObservabilityActiveUserDirtySource | null,
  right: ObservabilityActiveUserDirtySource,
): boolean {
  return Boolean(left)
    && left?.environment === right.environment
    && left.localDate === right.localDate
    && left.revision === right.revision;
}

function orderedSources(
  sources: readonly ObservabilityActiveUserDirtySource[],
): ObservabilityActiveUserDirtySource[] {
  return [...sources].sort((left, right) =>
    dirtySourceKey(left).localeCompare(dirtySourceKey(right)));
}

function finalTargetDate(
  source: ObservabilityActiveUserDirtySource,
  today: string,
): string | null {
  if (source.localDate > today) return null;
  const lastAffected = addDays(source.localDate, 29);
  return lastAffected < today ? lastAffected : today;
}

function taskKey(params: {
  source: ObservabilityActiveUserDirtySource | null;
  environment: ObservabilityEnvironment;
  targetDate: string;
}): string {
  const source = params.source
    ? dirtySourceKey(params.source)
    : `bootstrap:${params.environment}`;
  return `${source}:${params.targetDate}`;
}

function idleJob(nowIso: string): ActiveUserSnapshotJob {
  return {
    schemaVersion: SNAPSHOT_JOB_SCHEMA_VERSION,
    status: 'idle',
    taskKey: null,
    source: null,
    environment: null,
    targetDate: null,
    scanDateIndex: 0,
    cursor: null,
    updatedAt: nowIso,
  };
}

function readSource(value: unknown): ObservabilityActiveUserDirtySource | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object') throw new Error('active_user_snapshot_job_invalid');
  const record = value as Record<string, unknown>;
  if (
    !isEnvironment(record.environment)
    || !isIsoDate(record.localDate)
    || !Number.isSafeInteger(record.revision)
    || Number(record.revision) < 1
  ) {
    throw new Error('active_user_snapshot_job_invalid');
  }
  return {
    environment: record.environment,
    localDate: record.localDate,
    revision: Number(record.revision),
  };
}

function readCursor(value: unknown): FirestoreOrderedCursor | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object') throw new Error('active_user_snapshot_job_invalid');
  const record = value as Record<string, unknown>;
  if (typeof record.orderedValue !== 'string' || typeof record.documentName !== 'string') {
    throw new Error('active_user_snapshot_job_invalid');
  }
  return {
    orderedValue: record.orderedValue,
    documentName: record.documentName,
  };
}

function readJob(value: Record<string, unknown> | null, nowIso: string): ActiveUserSnapshotJob {
  if (!value) return idleJob(nowIso);
  const status = value.status;
  if (
    value.schemaVersion !== SNAPSHOT_JOB_SCHEMA_VERSION
    || (status !== 'idle' && status !== 'scanning')
    || !Number.isSafeInteger(value.scanDateIndex)
    || Number(value.scanDateIndex) < 0
    || Number(value.scanDateIndex) > 30
  ) {
    throw new Error('active_user_snapshot_job_invalid');
  }
  const source = readSource(value.source);
  const environment = value.environment === null || value.environment === undefined
    ? null
    : isEnvironment(value.environment)
      ? value.environment
      : null;
  const targetDate = value.targetDate === null || value.targetDate === undefined
    ? null
    : isIsoDate(value.targetDate)
      ? value.targetDate
      : null;
  const storedTaskKey = typeof value.taskKey === 'string' ? value.taskKey : null;
  if (status === 'scanning' && (!environment || !targetDate || !storedTaskKey)) {
    throw new Error('active_user_snapshot_job_invalid');
  }
  return {
    schemaVersion: SNAPSHOT_JOB_SCHEMA_VERSION,
    status,
    taskKey: storedTaskKey,
    source,
    environment,
    targetDate,
    scanDateIndex: Number(value.scanDateIndex),
    cursor: readCursor(value.cursor),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : nowIso,
  };
}

function accumulatorId(index: number): string {
  return `main:${String(index).padStart(2, '0')}`;
}

function readShard(
  value: Record<string, unknown> | null,
  expectedTaskKey: string,
  index: number,
  nowIso: string,
): ActiveUserSnapshotAccumulatorShard {
  if (
    value?.schemaVersion !== SNAPSHOT_JOB_SCHEMA_VERSION
    || value.taskKey !== expectedTaskKey
    || value.shard !== index
  ) {
    return {
      schemaVersion: SNAPSHOT_JOB_SCHEMA_VERSION,
      taskKey: expectedTaskKey,
      shard: index,
      actors: {},
      updatedAt: nowIso,
    };
  }
  if (
    value.actorFlagsEncoding !== ACTOR_FLAGS_ENCODING
    || typeof value.actorFlags !== 'string'
  ) {
    throw new Error('active_user_snapshot_accumulator_invalid');
  }
  const actors: Record<string, number> = {};
  const lines = value.actorFlags ? value.actorFlags.split('\n') : [];
  for (const line of lines) {
    const separator = line.lastIndexOf(':');
    const actorSubjectId = separator >= 0 ? line.slice(0, separator) : '';
    const flags = separator >= 0 ? Number(line.slice(separator + 1)) : Number.NaN;
    if (
      !ACTOR_SUBJECT_PATTERN.test(actorSubjectId)
      || !Number.isSafeInteger(flags)
      || flags < 0
      || flags > 7
      || actors[actorSubjectId] !== undefined
    ) {
      throw new Error('active_user_snapshot_accumulator_invalid');
    }
    actors[actorSubjectId] = flags;
  }
  if (encodeActorFlags(actors) !== value.actorFlags) {
    throw new Error('active_user_snapshot_accumulator_invalid');
  }
  return {
    schemaVersion: SNAPSHOT_JOB_SCHEMA_VERSION,
    taskKey: expectedTaskKey,
    shard: index,
    actors,
    updatedAt: nowIso,
  };
}

function actorShard(actorSubjectId: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < actorSubjectId.length; index += 1) {
    hash ^= actorSubjectId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % ACTIVE_USER_SNAPSHOT_SHARD_COUNT;
}

function encodeActorFlags(actors: Readonly<Record<string, number>>): string {
  return Object.entries(actors)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([actorSubjectId, flags]) => `${actorSubjectId}:${flags}`)
    .join('\n');
}

function storedShard(
  shard: ActiveUserSnapshotAccumulatorShard,
): StoredActiveUserSnapshotAccumulatorShard {
  return {
    schemaVersion: shard.schemaVersion,
    taskKey: shard.taskKey,
    shard: shard.shard,
    actorFlagsEncoding: ACTOR_FLAGS_ENCODING,
    actorFlags: encodeActorFlags(shard.actors),
    updatedAt: shard.updatedAt,
  };
}

function stringStorageBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength + 1;
}

function documentNameStorageBytes(collection: string, id: string): number {
  return stringStorageBytes(collection) + stringStorageBytes(id) + 16;
}

function firestoreValueStorageBytes(value: unknown): number {
  if (value === null || value === undefined) return 1;
  if (typeof value === 'boolean') return 1;
  if (typeof value === 'number') return 8;
  if (typeof value === 'string') return stringStorageBytes(value);
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + firestoreValueStorageBytes(item), 0);
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).reduce(
      (total, [field, item]) =>
        total + stringStorageBytes(field) + firestoreValueStorageBytes(item),
      32,
    );
  }
  return 1;
}

function firestoreDocumentStorageBytes(
  collection: string,
  id: string,
  value: Readonly<Record<string, unknown>>,
): number {
  return documentNameStorageBytes(collection, id)
    + Object.entries(value).reduce(
      (total, [field, item]) =>
        total + stringStorageBytes(field) + firestoreValueStorageBytes(item),
      0,
    )
    + 32;
}

function indexedLeafFields(
  value: Readonly<Record<string, unknown>>,
  prefix = '',
): Array<{ fieldPath: string; value: unknown }> {
  const fields: Array<{ fieldPath: string; value: unknown }> = [];
  for (const [field, item] of Object.entries(value)) {
    const fieldPath = prefix ? `${prefix}.${field}` : field;
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      fields.push(...indexedLeafFields(item as Record<string, unknown>, fieldPath));
    } else if (Array.isArray(item)) {
      item.forEach((entry) => fields.push({ fieldPath, value: entry }));
    } else {
      fields.push({ fieldPath, value: item });
    }
  }
  return fields;
}

function indexedValueStorageBytes(value: unknown): number {
  const bytes = firestoreValueStorageBytes(value);
  return typeof value === 'string'
    ? Math.min(bytes, FIRESTORE_MAX_INDEXED_FIELD_VALUE_BYTES)
    : bytes;
}

function defaultSingleFieldIndexStorageBytes(
  collection: string,
  id: string,
  value: Readonly<Record<string, unknown>>,
): number {
  const documentNameBytes = documentNameStorageBytes(collection, id);
  return indexedLeafFields(value).reduce((total, field) => {
    // Top-level documents have no parent document. Reusing the full document-name
    // size as the parent term deliberately overestimates the documented formula.
    const oneEntry = documentNameBytes
      + documentNameBytes
      + stringStorageBytes(field.fieldPath)
      + indexedValueStorageBytes(field.value)
      + 32;
    // Default automatic indexing creates ascending and descending entries.
    return total + (oneEntry * 2);
  }, 0);
}

function documentAndDefaultIndexesStorageBytes(
  collection: string,
  id: string,
  value: Readonly<Record<string, unknown>>,
): number {
  return firestoreDocumentStorageBytes(collection, id, value)
    + defaultSingleFieldIndexStorageBytes(collection, id, value);
}

export function estimateActiveUserSnapshotPublishTransactionStorageBytes(params: {
  accumulatorDocuments: readonly (Readonly<Record<string, unknown>> | null)[];
  snapshot: ObservabilityActiveUserWindows;
  nextJob: Readonly<Record<string, unknown>>;
}): number {
  const deleteBytes = params.accumulatorDocuments.reduce(
    (total, value, index) => total + (value
      ? documentAndDefaultIndexesStorageBytes(
        ACTIVE_USER_SNAPSHOT_ACCUMULATOR_COLLECTION,
        accumulatorId(index),
        value,
      )
      : 0),
    0,
  );
  const snapshotBytes = documentAndDefaultIndexesStorageBytes(
    ACTIVE_USER_WINDOW_COLLECTION,
    snapshotId(params.snapshot.environment, params.snapshot.asOfDate),
    params.snapshot as unknown as Record<string, unknown>,
  );
  const jobBytes = documentAndDefaultIndexesStorageBytes(
    ACTIVE_USER_SNAPSHOT_JOB_COLLECTION,
    ACTIVE_USER_SNAPSHOT_JOB_ID,
    params.nextJob,
  );
  // Count both removed and inserted storage for updates. Firestore's transaction
  // limit includes documents and index entries modified by the transaction.
  return deleteBytes + (2 * snapshotBytes) + (2 * jobBytes);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertAccumulatorBounds(
  shards: readonly ActiveUserSnapshotAccumulatorShard[],
): void {
  for (const [index, shard] of shards.entries()) {
    const value = storedShard(shard) as unknown as Record<string, unknown>;
    const bytes = firestoreDocumentStorageBytes(
      ACTIVE_USER_SNAPSHOT_ACCUMULATOR_COLLECTION,
      accumulatorId(index),
      value,
    );
    if (bytes > ACTIVE_USER_SNAPSHOT_MAX_SHARD_STORAGE_BYTES) {
      throw new Error('active_user_snapshot_accumulator_shard_overflow');
    }
  }
}

function assertPublishTransactionBounds(params: {
  accumulatorDocuments: readonly (Readonly<Record<string, unknown>> | null)[];
  snapshot: ObservabilityActiveUserWindows;
  nextJob: ActiveUserSnapshotJob;
}): void {
  const estimatedBytes = estimateActiveUserSnapshotPublishTransactionStorageBytes({
    accumulatorDocuments: params.accumulatorDocuments,
    snapshot: params.snapshot,
    nextJob: params.nextJob as unknown as Record<string, unknown>,
  });
  if (estimatedBytes > ACTIVE_USER_SNAPSHOT_MAX_PUBLISH_TRANSACTION_BYTES) {
    throw new Error('active_user_snapshot_publish_transaction_overflow');
  }
}

function flagsForDateIndex(index: number): number {
  return WINDOW_LAST_30_DAYS
    | (index >= 23 ? WINDOW_LAST_7_DAYS : 0)
    | (index === 29 ? WINDOW_TODAY : 0);
}

function snapshotFromShards(params: {
  shards: readonly ActiveUserSnapshotAccumulatorShard[];
  environment: ObservabilityEnvironment;
  targetDate: string;
  nowIso: string;
}): ObservabilityActiveUserWindows {
  let today = 0;
  let last7Days = 0;
  let last30Days = 0;
  for (const shard of params.shards) {
    for (const flags of Object.values(shard.actors)) {
      if ((flags & WINDOW_TODAY) !== 0) today += 1;
      if ((flags & WINDOW_LAST_7_DAYS) !== 0) last7Days += 1;
      if ((flags & WINDOW_LAST_30_DAYS) !== 0) last30Days += 1;
    }
  }
  return {
    schemaVersion: PRODUCT_OBSERVABILITY_READ_MODEL_VERSION,
    environment: params.environment,
    asOfDate: params.targetDate,
    reportingTimeZone: PRODUCT_OBSERVABILITY_REPORTING_TIME_ZONE,
    today,
    last7Days,
    last30Days,
    updatedAt: params.nowIso,
    expireAt: expiryFrom(params.nowIso),
  };
}

function scanningJob(params: {
  source: ObservabilityActiveUserDirtySource | null;
  environment: ObservabilityEnvironment;
  targetDate: string;
  nowIso: string;
}): ActiveUserSnapshotJob {
  return {
    schemaVersion: SNAPSHOT_JOB_SCHEMA_VERSION,
    status: 'scanning',
    taskKey: taskKey(params),
    source: params.source,
    environment: params.environment,
    targetDate: params.targetDate,
    scanDateIndex: 0,
    cursor: null,
    updatedAt: params.nowIso,
  };
}

export class ProductObservabilityActiveUserSnapshotService {
  private readonly defaultEnvironment: ObservabilityEnvironment;

  constructor(
    env: ProductObservabilityActiveUserSnapshotEnv,
    private readonly firestore: ActiveUserSnapshotFirestore = new FirestoreServiceAccountClient(env),
    private readonly now: () => Date = () => new Date(),
  ) {
    this.defaultEnvironment = normalizedEnvironment(env.ENVIRONMENT);
  }

  async runBatch(
    dirtySources: readonly ObservabilityActiveUserDirtySource[],
  ): Promise<ProductObservabilityActiveUserSnapshotBatchResult> {
    const nowIso = this.now().toISOString();
    const today = observabilityReportingDate(nowIso);
    const keys: FirestoreTransactionDocumentKey[] = [
      { collection: ACTIVE_USER_SNAPSHOT_JOB_COLLECTION, id: ACTIVE_USER_SNAPSHOT_JOB_ID },
      {
        collection: ACTIVE_USER_WINDOW_COLLECTION,
        id: snapshotId(this.defaultEnvironment, today),
      },
      ...Array.from({ length: ACTIVE_USER_SNAPSHOT_SHARD_COUNT }, (_, index) => ({
        collection: ACTIVE_USER_SNAPSHOT_ACCUMULATOR_COLLECTION,
        id: accumulatorId(index),
      })),
    ];
    const values = await this.firestore.batchGetDocumentKeys(keys);
    const commitIfCurrent = async (
      writes: readonly FirestoreTransactionDocumentWrite[],
      deletes: readonly FirestoreTransactionDocumentKey[] = [],
    ): Promise<boolean> => {
      const transaction = await this.firestore.beginTransaction();
      try {
        const latest = await this.firestore.batchGetDocumentKeys(keys, transaction);
        if (stableJson(latest) !== stableJson(values)) {
          await this.firestore.rollbackTransaction(transaction);
          return false;
        }
        await this.firestore.commitTransaction(transaction, writes, deletes);
        return true;
      } catch (error) {
        try {
          await this.firestore.rollbackTransaction(transaction);
        } catch {
          // The original failure is authoritative; the transaction may already be closed.
        }
        throw error;
      }
    };
    const storedJob = readJob(values[0] ?? null, nowIso);
    const currentDefaultSnapshot = values[1] ?? null;
    const availableSources = orderedSources(dirtySources);

    let job = storedJob;
    const storedSourceStillPending = job.source
      ? availableSources.some((source) => sameSource(job.source, source))
      : job.status === 'scanning';
    if (job.status !== 'scanning' || !storedSourceStillPending) {
      const source = availableSources[0] ?? null;
      if (source) {
        const targetDate = source.localDate <= today ? source.localDate : null;
        if (!targetDate) {
          const committed = await commitIfCurrent([{
            collection: ACTIVE_USER_SNAPSHOT_JOB_COLLECTION,
            id: ACTIVE_USER_SNAPSHOT_JOB_ID,
            value: idleJob(nowIso) as unknown as Record<string, unknown>,
          }]);
          return {
            pageReads: 0,
            published: false,
            hasMore: true,
            completedSource: committed ? source : null,
          };
        }
        job = scanningJob({
          source,
          environment: source.environment,
          targetDate,
          nowIso,
        });
      } else if (!currentDefaultSnapshot) {
        job = scanningJob({
          source: null,
          environment: this.defaultEnvironment,
          targetDate: today,
          nowIso,
        });
      } else {
        return {
          pageReads: 0,
          published: false,
          hasMore: false,
          completedSource: null,
        };
      }
    }

    if (!job.taskKey || !job.environment || !job.targetDate) {
      throw new Error('active_user_snapshot_job_invalid');
    }
    const shards = Array.from(
      { length: ACTIVE_USER_SNAPSHOT_SHARD_COUNT },
      (_, index) => readShard(values[index + 2] ?? null, job.taskKey as string, index, nowIso),
    );
    const touchedShards = new Set<number>();
    const scanDates = datesEndingAt(job.targetDate, 30);
    let pageReads = 0;
    let scanDateIndex = job.scanDateIndex;
    let cursor = job.cursor;

    while (
      scanDateIndex < scanDates.length
      && pageReads < ACTIVE_USER_SNAPSHOT_MAX_PAGE_READS
    ) {
      const scanDate = scanDates[scanDateIndex];
      const page = await this.firestore.queryDocumentsAfter({
        collection: ACTOR_DAY_COLLECTION,
        orderByField: 'localDate',
        filters: [{ field: 'localDate', value: scanDate }],
        cursor,
        limit: ACTOR_DAY_PAGE_SIZE,
      });
      pageReads += 1;
      const flags = flagsForDateIndex(scanDateIndex);
      for (const row of page) {
        const actorSubjectId = row.actorSubjectId;
        if (
          row.environment !== job.environment
          || row.localDate !== scanDate
          || typeof actorSubjectId !== 'string'
          || !ACTOR_SUBJECT_PATTERN.test(actorSubjectId)
        ) {
          continue;
        }
        const shardIndex = actorShard(actorSubjectId);
        const before = shards[shardIndex].actors[actorSubjectId] ?? 0;
        const after = before | flags;
        if (after !== before) {
          shards[shardIndex].actors[actorSubjectId] = after;
          shards[shardIndex].updatedAt = nowIso;
          touchedShards.add(shardIndex);
        }
      }
      if (page.length < ACTOR_DAY_PAGE_SIZE) {
        scanDateIndex += 1;
        cursor = null;
      } else {
        const last = page[page.length - 1];
        cursor = {
          orderedValue: scanDate,
          documentName: last.documentName,
        };
      }
    }

    assertAccumulatorBounds(shards);
    const snapshot = snapshotFromShards({
      shards,
      environment: job.environment,
      targetDate: job.targetDate,
      nowIso,
    });
    if (scanDateIndex < scanDates.length) {
      const nextJob: ActiveUserSnapshotJob = {
        ...job,
        scanDateIndex,
        cursor,
        updatedAt: nowIso,
      };
      const writes: FirestoreTransactionDocumentWrite[] = [{
        collection: ACTIVE_USER_SNAPSHOT_JOB_COLLECTION,
        id: ACTIVE_USER_SNAPSHOT_JOB_ID,
        value: nextJob as unknown as Record<string, unknown>,
      }];
      [...touchedShards].sort((left, right) => left - right).forEach((index) => {
        writes.push({
          collection: ACTIVE_USER_SNAPSHOT_ACCUMULATOR_COLLECTION,
          id: accumulatorId(index),
          value: storedShard(shards[index]) as unknown as Record<string, unknown>,
        });
      });
      const checkpointAccumulatorDocuments = values.slice(2).map((value, index) =>
        touchedShards.has(index)
          ? storedShard(shards[index]) as unknown as Record<string, unknown>
          : value);
      assertPublishTransactionBounds({
        accumulatorDocuments: checkpointAccumulatorDocuments,
        snapshot,
        nextJob,
      });
      await commitIfCurrent(writes);
      return {
        pageReads,
        published: false,
        hasMore: true,
        completedSource: null,
      };
    }

    let nextJob = idleJob(nowIso);
    let completedSource: ObservabilityActiveUserDirtySource | null = null;
    if (job.source) {
      const lastTarget = finalTargetDate(job.source, today);
      const nextTarget = addDays(job.targetDate, 1);
      if (lastTarget && nextTarget <= lastTarget) {
        nextJob = scanningJob({
          source: job.source,
          environment: job.source.environment,
          targetDate: nextTarget,
          nowIso,
        });
      } else {
        completedSource = job.source;
      }
    }
    assertPublishTransactionBounds({
      // Only documents that existed at the initial consistent read are deleted.
      // Actors discovered in this final scan remain in memory and are published
      // directly into the canonical snapshot without first inflating the delete.
      accumulatorDocuments: values.slice(2),
      snapshot,
      nextJob,
    });

    const committed = await commitIfCurrent(
      [
        {
          collection: ACTIVE_USER_WINDOW_COLLECTION,
          id: snapshotId(job.environment, job.targetDate),
          value: snapshot as unknown as Record<string, unknown>,
        },
        {
          collection: ACTIVE_USER_SNAPSHOT_JOB_COLLECTION,
          id: ACTIVE_USER_SNAPSHOT_JOB_ID,
          value: nextJob as unknown as Record<string, unknown>,
        },
      ],
      Array.from({ length: ACTIVE_USER_SNAPSHOT_SHARD_COUNT }, (_, index) => ({
        collection: ACTIVE_USER_SNAPSHOT_ACCUMULATOR_COLLECTION,
        id: accumulatorId(index),
      })),
    );
    if (!committed) {
      return {
        pageReads,
        published: false,
        hasMore: true,
        completedSource: null,
      };
    }
    return {
      pageReads,
      published: true,
      hasMore: Boolean(completedSource) || nextJob.status === 'scanning',
      completedSource,
    };
  }
}
