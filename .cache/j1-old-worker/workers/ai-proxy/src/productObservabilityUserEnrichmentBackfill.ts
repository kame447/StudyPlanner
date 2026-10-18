import type { ObservabilityEnvironment } from '../../../shared/productObservabilityContract';
import {
  PRODUCT_OBSERVABILITY_READ_MODEL_VERSION,
  PRODUCT_OBSERVABILITY_USER_ENRICHMENT_VERSION,
  type ObservabilityUserSummary,
} from '../../../shared/productObservabilityReadModel';
import {
  FirestoreServiceAccountClient,
  FirestoreWriteConflictError,
  type FirestoreAggregationFilter,
  type FirestoreBulkDocumentWrite,
  type FirestoreDocumentSnapshot,
  type FirestoreOrderedCursor,
  type FirestoreOrderedDocument,
  type FirestoreServiceAccountEnv,
} from './firestoreServiceAccountClient';
import {
  classifyObservabilityEventError,
  userSummaryEnrichmentReady,
} from './productObservabilityUserEnrichment';

export const USER_ENRICHMENT_BACKFILL_STATE_COLLECTION =
  'observability_user_enrichment_backfill_state';
export const USER_ENRICHMENT_BACKFILL_STATE_ID = 'main';
export const USER_ENRICHMENT_BACKFILL_BATCH_SIZE = 17;

const ACTOR_DAY_COLLECTION = 'observability_actor_day';
const EVENT_COLLECTION = 'observability_events';
const USER_SUMMARY_COLLECTION_PREFIX = 'observability_user_summary';
const BACKFILL_SCHEMA_VERSION = 1 as const;
const RECENT_ERROR_PAGE_SIZE = 100;
const RECENT_ERROR_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const ENVIRONMENTS: readonly ObservabilityEnvironment[] = [
  'production',
  'preview',
  'development',
  'test',
];
const ACTOR_SUBJECT_PATTERN = /^actor-[A-Za-z0-9-]{8,160}$/;

interface PendingRecentErrorScan {
  actorSubjectId: string;
  summaryDocumentUpdateTime: string;
  cursor: FirestoreOrderedCursor;
}

export interface UserEnrichmentBackfillCheckpoint {
  schemaVersion: typeof BACKFILL_SCHEMA_VERSION;
  environmentIndex: number;
  cursorDocumentName: string | null;
  pendingRecentErrorScan: PendingRecentErrorScan | null;
  completedEnvironments: ObservabilityEnvironment[];
  processedUsers: number;
  enrichedUsers: number;
  completed: boolean;
  updatedAt: string;
}

export interface ProductObservabilityUserEnrichmentBackfillResult {
  checkpoint: UserEnrichmentBackfillCheckpoint;
  processed: number;
  conflicted: boolean;
}

interface UserEnrichmentBackfillFirestore {
  getDocumentSnapshot(
    collection: string,
    id: string,
  ): Promise<FirestoreDocumentSnapshot | null>;
  queryDocumentSnapshotsByNameAfter(params: {
    collection: string;
    cursorDocumentName?: string | null;
    limit?: number;
  }): Promise<FirestoreDocumentSnapshot[]>;
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
    direction?: 'ASCENDING' | 'DESCENDING';
  }): Promise<FirestoreOrderedDocument[]>;
  commitWrites(writes: readonly FirestoreBulkDocumentWrite[]): Promise<void>;
}

export interface ProductObservabilityUserEnrichmentBackfillEnv
  extends FirestoreServiceAccountEnv {}

function emptyCheckpoint(nowIso: string): UserEnrichmentBackfillCheckpoint {
  return {
    schemaVersion: BACKFILL_SCHEMA_VERSION,
    environmentIndex: 0,
    cursorDocumentName: null,
    pendingRecentErrorScan: null,
    completedEnvironments: [],
    processedUsers: 0,
    enrichedUsers: 0,
    completed: false,
    updatedAt: nowIso,
  };
}

function isEnvironment(value: unknown): value is ObservabilityEnvironment {
  return ENVIRONMENTS.includes(value as ObservabilityEnvironment);
}

function readCursor(value: unknown): FirestoreOrderedCursor | null {
  if (!value || typeof value !== 'object') return null;
  const cursor = value as Record<string, unknown>;
  return typeof cursor.orderedValue === 'string'
    && typeof cursor.documentName === 'string'
    ? { orderedValue: cursor.orderedValue, documentName: cursor.documentName }
    : null;
}

export function readUserEnrichmentBackfillCheckpoint(
  value: Record<string, unknown> | null,
  nowIso: string,
): UserEnrichmentBackfillCheckpoint {
  if (!value) return emptyCheckpoint(nowIso);
  const completedEnvironments = Array.isArray(value.completedEnvironments)
    ? value.completedEnvironments.filter(isEnvironment)
    : [];
  const pendingValue = value.pendingRecentErrorScan;
  let pendingRecentErrorScan: PendingRecentErrorScan | null = null;
  if (pendingValue !== null && pendingValue !== undefined) {
    if (!pendingValue || typeof pendingValue !== 'object') {
      throw new Error('user_enrichment_backfill_checkpoint_invalid');
    }
    const pending = pendingValue as Record<string, unknown>;
    const cursor = readCursor(pending.cursor);
    if (!ACTOR_SUBJECT_PATTERN.test(String(pending.actorSubjectId ?? ''))
      || typeof pending.summaryDocumentUpdateTime !== 'string'
      || !cursor) {
      throw new Error('user_enrichment_backfill_checkpoint_invalid');
    }
    pendingRecentErrorScan = {
      actorSubjectId: String(pending.actorSubjectId),
      summaryDocumentUpdateTime: pending.summaryDocumentUpdateTime,
      cursor,
    };
  }
  if (
    value.schemaVersion !== BACKFILL_SCHEMA_VERSION
    || !Number.isSafeInteger(value.environmentIndex)
    || Number(value.environmentIndex) < 0
    || Number(value.environmentIndex) > ENVIRONMENTS.length
    || !Array.isArray(value.completedEnvironments)
    || completedEnvironments.length !== value.completedEnvironments.length
    || completedEnvironments.length !== new Set(completedEnvironments).size
    || !Number.isSafeInteger(value.processedUsers)
    || Number(value.processedUsers) < 0
    || !Number.isSafeInteger(value.enrichedUsers)
    || Number(value.enrichedUsers) < 0
    || Number(value.enrichedUsers) > Number(value.processedUsers)
    || typeof value.completed !== 'boolean'
    || value.completed !== (Number(value.environmentIndex) >= ENVIRONMENTS.length)
    || completedEnvironments.join('\n')
      !== ENVIRONMENTS.slice(0, Number(value.environmentIndex)).join('\n')
    || (value.cursorDocumentName !== null && typeof value.cursorDocumentName !== 'string')
    || typeof value.updatedAt !== 'string'
    || !Number.isFinite(new Date(value.updatedAt).getTime())
  ) {
    throw new Error('user_enrichment_backfill_checkpoint_invalid');
  }
  return {
    schemaVersion: BACKFILL_SCHEMA_VERSION,
    environmentIndex: Number(value.environmentIndex),
    cursorDocumentName: value.cursorDocumentName as string | null,
    pendingRecentErrorScan,
    completedEnvironments,
    processedUsers: Number(value.processedUsers),
    enrichedUsers: Number(value.enrichedUsers),
    completed: value.completed,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : nowIso,
  };
}

function summaryCollection(environment: ObservabilityEnvironment): string {
  return `${USER_SUMMARY_COLLECTION_PREFIX}_${environment}`;
}

function summaryFromSnapshot(snapshot: FirestoreDocumentSnapshot): ObservabilityUserSummary {
  const value = snapshot.value as unknown as ObservabilityUserSummary;
  if (
    value.schemaVersion !== PRODUCT_OBSERVABILITY_READ_MODEL_VERSION
    || value.actorSubjectId !== snapshot.id
    || !ACTOR_SUBJECT_PATTERN.test(value.actorSubjectId)
    || typeof value.updatedAt !== 'string'
    || !Number.isFinite(new Date(value.updatedAt).getTime())
  ) {
    throw new Error('user_enrichment_backfill_summary_invalid');
  }
  return value;
}

function recentErrorResult(params: {
  rows: readonly FirestoreOrderedDocument[];
  cutoffIso: string;
}): {
  completed: boolean;
  latestErrorAt: string | null;
  latestErrorCategory: string | null;
  cursor: FirestoreOrderedCursor | null;
} {
  for (const row of params.rows) {
    const occurredAt = typeof row.occurredAt === 'string' ? row.occurredAt : '';
    if (!occurredAt || !Number.isFinite(new Date(occurredAt).getTime())) {
      throw new Error('user_enrichment_backfill_event_invalid');
    }
    if (occurredAt < params.cutoffIso) {
      return { completed: true, latestErrorAt: null, latestErrorCategory: null, cursor: null };
    }
    const classified = classifyObservabilityEventError(row);
    if (classified) {
      return {
        completed: true,
        latestErrorAt: classified.occurredAt,
        latestErrorCategory: classified.category,
        cursor: null,
      };
    }
  }
  if (params.rows.length < RECENT_ERROR_PAGE_SIZE) {
    return { completed: true, latestErrorAt: null, latestErrorCategory: null, cursor: null };
  }
  const last = params.rows[params.rows.length - 1];
  return {
    completed: false,
    latestErrorAt: null,
    latestErrorCategory: null,
    cursor: {
      orderedValue: String(last.occurredAt),
      documentName: last.documentName,
    },
  };
}

export function userEnrichmentBackfillReady(
  checkpoint: UserEnrichmentBackfillCheckpoint | null,
  environment: ObservabilityEnvironment,
): boolean {
  return Boolean(checkpoint?.completedEnvironments.includes(environment));
}

export class ProductObservabilityUserEnrichmentBackfillService {
  constructor(
    env: ProductObservabilityUserEnrichmentBackfillEnv,
    private readonly firestore: UserEnrichmentBackfillFirestore =
      new FirestoreServiceAccountClient(env),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async checkpoint(): Promise<UserEnrichmentBackfillCheckpoint | null> {
    const snapshot = await this.firestore.getDocumentSnapshot(
      USER_ENRICHMENT_BACKFILL_STATE_COLLECTION,
      USER_ENRICHMENT_BACKFILL_STATE_ID,
    );
    return snapshot
      ? readUserEnrichmentBackfillCheckpoint(snapshot.value, this.now().toISOString())
      : null;
  }

  async ready(environment: ObservabilityEnvironment): Promise<boolean> {
    return userEnrichmentBackfillReady(await this.checkpoint(), environment);
  }

  async runBatch(
    limit = USER_ENRICHMENT_BACKFILL_BATCH_SIZE,
  ): Promise<ProductObservabilityUserEnrichmentBackfillResult> {
    const nowIso = this.now().toISOString();
    const checkpointSnapshot = await this.firestore.getDocumentSnapshot(
      USER_ENRICHMENT_BACKFILL_STATE_COLLECTION,
      USER_ENRICHMENT_BACKFILL_STATE_ID,
    );
    const current = readUserEnrichmentBackfillCheckpoint(
      checkpointSnapshot?.value ?? null,
      nowIso,
    );
    if (current.completed) return { checkpoint: current, processed: 0, conflicted: false };

    const environment = ENVIRONMENTS[current.environmentIndex];
    if (!environment) throw new Error('user_enrichment_backfill_checkpoint_invalid');
    const pageSize = Math.max(
      1,
      Math.min(USER_ENRICHMENT_BACKFILL_BATCH_SIZE, Math.floor(limit)),
    );
    const snapshots = await this.firestore.queryDocumentSnapshotsByNameAfter({
      collection: summaryCollection(environment),
      cursorDocumentName: current.cursorDocumentName,
      limit: pageSize,
    });
    const cutoffIso = new Date(this.now().getTime() - RECENT_ERROR_WINDOW_MS).toISOString();
    const writes: FirestoreBulkDocumentWrite[] = [];
    let processed = 0;
    let cursorDocumentName = current.cursorDocumentName;
    let pendingRecentErrorScan = current.pendingRecentErrorScan;
    let enrichedUsers = current.enrichedUsers;
    if (snapshots.length === 0) pendingRecentErrorScan = null;

    for (const snapshot of snapshots) {
      const summary = summaryFromSnapshot(snapshot);
      if (userSummaryEnrichmentReady(summary)) {
        cursorDocumentName = snapshot.documentName;
        pendingRecentErrorScan = null;
        processed += 1;
        continue;
      }
      const pending = pendingRecentErrorScan?.actorSubjectId === summary.actorSubjectId
        && pendingRecentErrorScan.summaryDocumentUpdateTime === snapshot.updateTime
        ? pendingRecentErrorScan
        : null;
      const [activeDayCount, errorRows] = await Promise.all([
        this.firestore.countDocuments(ACTOR_DAY_COLLECTION, [
          { field: 'actorSubjectId', operator: 'EQUAL', value: summary.actorSubjectId },
          { field: 'environment', operator: 'EQUAL', value: environment },
        ]),
        this.firestore.queryDocumentsAfter({
          collection: EVENT_COLLECTION,
          orderByField: 'occurredAt',
          filters: [
            { field: 'actorSubjectId', value: summary.actorSubjectId },
            { field: 'environment', value: environment },
          ],
          cursor: pending?.cursor ?? null,
          limit: RECENT_ERROR_PAGE_SIZE,
          direction: 'DESCENDING',
        }),
      ]);
      const recentError = recentErrorResult({ rows: errorRows, cutoffIso });
      if (!recentError.completed && recentError.cursor) {
        pendingRecentErrorScan = {
          actorSubjectId: summary.actorSubjectId,
          summaryDocumentUpdateTime: snapshot.updateTime,
          cursor: recentError.cursor,
        };
        break;
      }
      writes.push({
        collection: summaryCollection(environment),
        id: summary.actorSubjectId,
        value: {
          userEnrichmentVersion: PRODUCT_OBSERVABILITY_USER_ENRICHMENT_VERSION,
          activeDayCount,
          latestErrorAt: recentError.latestErrorAt,
          latestErrorCategory: recentError.latestErrorCategory,
          userEnrichmentUpdatedAt: nowIso,
        },
        updateMask: [
          'userEnrichmentVersion',
          'activeDayCount',
          'latestErrorAt',
          'latestErrorCategory',
          'userEnrichmentUpdatedAt',
        ],
        currentDocument: { updateTime: snapshot.updateTime },
      });
      cursorDocumentName = snapshot.documentName;
      pendingRecentErrorScan = null;
      processed += 1;
      enrichedUsers += 1;
    }

    const pageCompleted = !pendingRecentErrorScan && snapshots.length < pageSize;
    const completedEnvironments = pageCompleted
      ? [...new Set([...current.completedEnvironments, environment])]
      : current.completedEnvironments;
    const environmentIndex = pageCompleted
      ? current.environmentIndex + 1
      : current.environmentIndex;
    const next: UserEnrichmentBackfillCheckpoint = {
      schemaVersion: BACKFILL_SCHEMA_VERSION,
      environmentIndex,
      cursorDocumentName: pageCompleted ? null : cursorDocumentName,
      pendingRecentErrorScan: pageCompleted ? null : pendingRecentErrorScan,
      completedEnvironments,
      processedUsers: current.processedUsers + processed,
      enrichedUsers,
      completed: environmentIndex >= ENVIRONMENTS.length,
      updatedAt: nowIso,
    };
    writes.push({
      collection: USER_ENRICHMENT_BACKFILL_STATE_COLLECTION,
      id: USER_ENRICHMENT_BACKFILL_STATE_ID,
      value: next as unknown as Record<string, unknown>,
      currentDocument: checkpointSnapshot
        ? { updateTime: checkpointSnapshot.updateTime }
        : { exists: false },
    });
    try {
      await this.firestore.commitWrites(writes);
      return { checkpoint: next, processed, conflicted: false };
    } catch (error) {
      if (error instanceof FirestoreWriteConflictError) {
        return { checkpoint: current, processed: 0, conflicted: true };
      }
      throw error;
    }
  }
}
