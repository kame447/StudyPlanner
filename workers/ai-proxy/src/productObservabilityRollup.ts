import type {
  ObservabilityEnvironment,
  PlanningOutcomeMetricPayload,
  StoredObservabilityEvent,
} from '../../../shared/productObservabilityContract';
import {
  PRODUCT_OBSERVABILITY_READ_MODEL_VERSION,
  type ObservabilityActiveUserDirtySource,
  type ObservabilityActorDay,
  type ObservabilityDailyRollup,
  type ObservabilityRollupCheckpoint,
  type ObservabilityRollupCursor,
  type ObservabilityUserSummary,
} from '../../../shared/productObservabilityReadModel';
import type {
  ObservabilityPlanningDailyCohort,
  ObservabilityPlanningSessionSummary,
} from '../../../shared/productObservabilityPlanningReadModel';
import {
  FirestoreServiceAccountClient,
  FirestoreTransactionConflictError,
  type FirestoreOrderedDocument,
  type FirestoreServiceAccountEnv,
  type FirestoreTransactionDocumentWrite,
} from './firestoreServiceAccountClient';
import {
  PRODUCT_OBSERVABILITY_PLANNING_DAILY_COLLECTION,
  PRODUCT_OBSERVABILITY_PLANNING_SESSION_COLLECTION,
  planningDailyCohortDocumentId,
  planningSessionDocumentId,
  projectPlanningDailyCohort,
  projectPlanningSessionSummary,
} from './productObservabilityPlanningProjection';
import {
  observabilityReportingDate,
  projectActorDay,
  projectDailyRollup,
  projectUserSummary,
  type StoredProductObservabilityEvent,
} from './productObservabilityReadModelProjection';

const EVENT_COLLECTION = 'observability_events';
const ACTOR_DAY_COLLECTION = 'observability_actor_day';
const USER_SUMMARY_COLLECTION_PREFIX = 'observability_user_summary';
const DAILY_ROLLUP_COLLECTION = 'observability_daily_rollups';
const ROLLUP_STATE_COLLECTION = 'observability_rollup_state';
const ROLLUP_STATE_ID = 'main';
const DEFAULT_BATCH_SIZE = 50;
const MAX_TRANSACTION_ATTEMPTS = 3;
const MAX_ACTIVE_USER_DIRTY_SOURCES = 128;
const ROLLUP_SETTLE_LAG_MS = 5 * 60 * 1000;
const OBSERVABILITY_ENVIRONMENTS = new Set<ObservabilityEnvironment>([
  'production',
  'preview',
  'development',
  'test',
]);

type ActiveUserDirtySourceKey = Pick<
  ObservabilityActiveUserDirtySource,
  'environment' | 'localDate'
>;

interface ObservabilityRollupFirestore {
  getDocument(collection: string, id: string): Promise<Record<string, unknown> | null>;
  queryDocumentsAfter(params: {
    collection: string;
    orderByField: string;
    cursor?: { orderedValue: string; documentName: string } | null;
    limit?: number;
  }): Promise<FirestoreOrderedDocument[]>;
  beginTransaction(): Promise<string>;
  getDocumentInTransaction(
    collection: string,
    id: string,
    transaction: string,
  ): Promise<Record<string, unknown> | null>;
  commitTransaction(
    transaction: string,
    writes: readonly FirestoreTransactionDocumentWrite[],
  ): Promise<void>;
  rollbackTransaction(transaction: string): Promise<void>;
}

export interface ProductObservabilityRollupEnv extends FirestoreServiceAccountEnv {}

export interface ProductObservabilityRollupResult {
  processed: number;
  hasMore: boolean;
  checkpoint: ObservabilityRollupCheckpoint;
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

function dirtySourceKey(source: ActiveUserDirtySourceKey): string {
  return `${source.environment}:${source.localDate}`;
}

function readDirtySources(value: unknown): ObservabilityActiveUserDirtySource[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('invalid_observability_checkpoint');
  const byKey = new Map<string, ObservabilityActiveUserDirtySource>();
  for (const item of value) {
    if (!item || typeof item !== 'object') throw new Error('invalid_observability_checkpoint');
    const record = item as Record<string, unknown>;
    if (
      !isEnvironment(record.environment)
      || !isIsoDate(record.localDate)
      || !Number.isSafeInteger(record.revision)
      || Number(record.revision) < 1
    ) {
      throw new Error('invalid_observability_checkpoint');
    }
    const source: ObservabilityActiveUserDirtySource = {
      environment: record.environment,
      localDate: record.localDate,
      revision: Number(record.revision),
    };
    byKey.set(dirtySourceKey(source), source);
  }
  const sources = [...byKey.values()].sort((left, right) =>
    dirtySourceKey(left).localeCompare(dirtySourceKey(right)));
  if (sources.length > MAX_ACTIVE_USER_DIRTY_SOURCES) {
    throw new Error('active_user_dirty_sources_overflow');
  }
  return sources;
}

function mergeDirtySources(
  current: readonly ObservabilityActiveUserDirtySource[],
  changed: readonly ActiveUserDirtySourceKey[],
): ObservabilityActiveUserDirtySource[] {
  const byKey = new Map<string, ObservabilityActiveUserDirtySource>();
  current.forEach((source) => byKey.set(dirtySourceKey(source), source));
  changed.forEach((source) => {
    const key = dirtySourceKey(source);
    const existing = byKey.get(key);
    byKey.set(key, {
      ...source,
      revision: existing ? existing.revision + 1 : 1,
    });
  });
  const sources = [...byKey.values()].sort((left, right) =>
    dirtySourceKey(left).localeCompare(dirtySourceKey(right)));
  if (sources.length > MAX_ACTIVE_USER_DIRTY_SOURCES) {
    throw new Error('active_user_dirty_sources_overflow');
  }
  return sources;
}

function emptyCheckpoint(nowIso: string): ObservabilityRollupCheckpoint {
  return {
    schemaVersion: PRODUCT_OBSERVABILITY_READ_MODEL_VERSION,
    cursor: null,
    processedEventCount: 0,
    activeUserDirtySources: [],
    lastRunStartedAt: null,
    lastSuccessfulRunAt: null,
    lastFailureAt: null,
    lastFailureCategory: null,
    updatedAt: nowIso,
  };
}

function readCursor(value: unknown): ObservabilityRollupCursor | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  return typeof record.observedAt === 'string' && typeof record.documentName === 'string'
    ? { observedAt: record.observedAt, documentName: record.documentName }
    : null;
}

function readCheckpoint(
  value: Record<string, unknown> | null,
  nowIso: string,
): ObservabilityRollupCheckpoint {
  if (!value) return emptyCheckpoint(nowIso);
  return {
    schemaVersion: PRODUCT_OBSERVABILITY_READ_MODEL_VERSION,
    cursor: readCursor(value.cursor),
    processedEventCount: Number.isSafeInteger(value.processedEventCount)
      ? Math.max(0, Number(value.processedEventCount))
      : 0,
    activeUserDirtySources: readDirtySources(value.activeUserDirtySources),
    lastRunStartedAt: typeof value.lastRunStartedAt === 'string' ? value.lastRunStartedAt : null,
    lastSuccessfulRunAt: typeof value.lastSuccessfulRunAt === 'string'
      ? value.lastSuccessfulRunAt
      : null,
    lastFailureAt: typeof value.lastFailureAt === 'string' ? value.lastFailureAt : null,
    lastFailureCategory: typeof value.lastFailureCategory === 'string'
      ? value.lastFailureCategory
      : null,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : nowIso,
  };
}

function sameCursor(
  left: ObservabilityRollupCursor | null,
  right: ObservabilityRollupCursor | null,
): boolean {
  return left?.observedAt === right?.observedAt
    && left?.documentName === right?.documentName;
}

function storedEventFromOrderedDocument(
  document: FirestoreOrderedDocument,
): StoredProductObservabilityEvent {
  const { documentName: _documentName, id: _id, ...value } = document;
  if (
    typeof value.eventType !== 'string'
    || !['product_activity', 'ai_request_metric', 'planning_outcome'].includes(value.eventType)
    || typeof value.observedAt !== 'string'
    || typeof value.occurredAt !== 'string'
    || typeof value.actorSubjectId !== 'string'
    || !isEnvironment(value.environment)
    || !value.payload
    || typeof value.payload !== 'object'
  ) {
    throw new Error('invalid_observability_event');
  }
  return value as unknown as StoredProductObservabilityEvent;
}

function actorDayId(event: StoredProductObservabilityEvent): string {
  return `${event.environment}:${observabilityReportingDate(event.occurredAt)}:${event.actorSubjectId}`;
}

function dailyRollupId(event: StoredProductObservabilityEvent): string {
  return `${event.environment}:${observabilityReportingDate(event.occurredAt)}`;
}

function userSummaryCollection(event: StoredProductObservabilityEvent): string {
  return `${USER_SUMMARY_COLLECTION_PREFIX}_${event.environment}`;
}

function cacheKey(collection: string, id: string): string {
  return `${collection}/${id}`;
}

function withoutStorageId<T>(value: Record<string, unknown> | null): T | null {
  if (!value) return null;
  const { id: _id, ...document } = value;
  return document as unknown as T;
}

function failureCategory(error: unknown): string {
  if (error instanceof FirestoreTransactionConflictError) return 'transaction_conflict';
  if (error instanceof Error && error.message === 'invalid_observability_event') {
    return 'invalid_event';
  }
  if (error instanceof Error && error.message.startsWith('invalid_planning_')) {
    return 'planning_projection_invalid';
  }
  if (error instanceof Error && error.message === 'active_user_dirty_sources_overflow') {
    return 'active_user_dirty_sources_overflow';
  }
  if (error instanceof Error && error.message === 'invalid_observability_checkpoint') {
    return 'invalid_checkpoint';
  }
  return 'rollup_failure';
}

function eligibleDocuments(
  documents: readonly FirestoreOrderedDocument[],
  cutoffIso: string,
): FirestoreOrderedDocument[] {
  const eligible: FirestoreOrderedDocument[] = [];
  for (const document of documents) {
    const observedAt = document.observedAt;
    if (typeof observedAt === 'string' && observedAt > cutoffIso) break;
    eligible.push(document);
  }
  return eligible;
}

export class ProductObservabilityRollupEngine {
  constructor(
    env: ProductObservabilityRollupEnv,
    private readonly firestore: ObservabilityRollupFirestore = new FirestoreServiceAccountClient(env),
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async checkpoint(): Promise<ObservabilityRollupCheckpoint> {
    const nowIso = this.now().toISOString();
    return readCheckpoint(
      await this.firestore.getDocument(ROLLUP_STATE_COLLECTION, ROLLUP_STATE_ID),
      nowIso,
    );
  }

  private async recordFailure(error: unknown): Promise<void> {
    for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      const nowIso = this.now().toISOString();
      const transaction = await this.firestore.beginTransaction();
      try {
        const latest = readCheckpoint(
          await this.firestore.getDocumentInTransaction(
            ROLLUP_STATE_COLLECTION,
            ROLLUP_STATE_ID,
            transaction,
          ),
          nowIso,
        );
        const failed: ObservabilityRollupCheckpoint = {
          ...latest,
          lastFailureAt: nowIso,
          lastFailureCategory: failureCategory(error),
          updatedAt: nowIso,
        };
        await this.firestore.commitTransaction(transaction, [{
          collection: ROLLUP_STATE_COLLECTION,
          id: ROLLUP_STATE_ID,
          value: failed as unknown as Record<string, unknown>,
        }]);
        return;
      } catch (failureWriteError) {
        try {
          await this.firestore.rollbackTransaction(transaction);
        } catch {
          // A failed/committed transaction may no longer be rollbackable.
        }
        if (failureWriteError instanceof FirestoreTransactionConflictError) continue;
        console.error('[Product Observability] could not persist rollup failure checkpoint', {
          message: failureWriteError instanceof Error
            ? failureWriteError.message
            : String(failureWriteError),
        });
        return;
      }
    }
  }

  async clearActiveUserDirtySources(
    processedSources: readonly ObservabilityActiveUserDirtySource[],
  ): Promise<void> {
    const processed = new Map(processedSources.map((source) => [dirtySourceKey(source), source.revision]));
    if (processed.size === 0) return;

    for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      const nowIso = this.now().toISOString();
      const transaction = await this.firestore.beginTransaction();
      try {
        const latest = readCheckpoint(
          await this.firestore.getDocumentInTransaction(
            ROLLUP_STATE_COLLECTION,
            ROLLUP_STATE_ID,
            transaction,
          ),
          nowIso,
        );
        const remaining = latest.activeUserDirtySources.filter((source) => {
          const processedRevision = processed.get(dirtySourceKey(source));
          return processedRevision === undefined || processedRevision !== source.revision;
        });
        if (remaining.length === latest.activeUserDirtySources.length) {
          await this.firestore.rollbackTransaction(transaction);
          return;
        }
        const next: ObservabilityRollupCheckpoint = {
          ...latest,
          activeUserDirtySources: remaining,
          updatedAt: nowIso,
        };
        await this.firestore.commitTransaction(transaction, [{
          collection: ROLLUP_STATE_COLLECTION,
          id: ROLLUP_STATE_ID,
          value: next as unknown as Record<string, unknown>,
        }]);
        return;
      } catch (error) {
        try {
          await this.firestore.rollbackTransaction(transaction);
        } catch {
          // A failed/committed transaction may no longer be rollbackable.
        }
        if (error instanceof FirestoreTransactionConflictError) continue;
        throw error;
      }
    }
    throw new Error('Observability dirty-source checkpoint retry limit exceeded.');
  }

  async runBatch(limit = DEFAULT_BATCH_SIZE): Promise<ProductObservabilityRollupResult> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      const before = await this.checkpoint();
      const runStarted = this.now();
      const runStartedAt = runStarted.toISOString();
      const settleCutoff = new Date(runStarted.getTime() - ROLLUP_SETTLE_LAG_MS).toISOString();
      const orderedEvents = await this.firestore.queryDocumentsAfter({
        collection: EVENT_COLLECTION,
        orderByField: 'observedAt',
        cursor: before.cursor
          ? {
              orderedValue: before.cursor.observedAt,
              documentName: before.cursor.documentName,
            }
          : null,
        limit,
      });
      const settledEvents = eligibleDocuments(orderedEvents, settleCutoff);
      const transaction = await this.firestore.beginTransaction();
      try {
        const transactionalCheckpoint = readCheckpoint(
          await this.firestore.getDocumentInTransaction(
            ROLLUP_STATE_COLLECTION,
            ROLLUP_STATE_ID,
            transaction,
          ),
          runStartedAt,
        );
        if (!sameCursor(transactionalCheckpoint.cursor, before.cursor)) {
          await this.firestore.rollbackTransaction(transaction);
          continue;
        }

        if (settledEvents.length === 0) {
          const checkpoint: ObservabilityRollupCheckpoint = {
            ...transactionalCheckpoint,
            lastRunStartedAt: runStartedAt,
            lastSuccessfulRunAt: runStartedAt,
            lastFailureAt: null,
            lastFailureCategory: null,
            updatedAt: runStartedAt,
          };
          await this.firestore.commitTransaction(transaction, [{
            collection: ROLLUP_STATE_COLLECTION,
            id: ROLLUP_STATE_ID,
            value: checkpoint as unknown as Record<string, unknown>,
          }]);
          return { processed: 0, hasMore: false, checkpoint };
        }

        const eventRows = settledEvents.map((document) => ({
          document,
          event: storedEventFromOrderedDocument(document),
        }));
        const cache = new Map<string, Record<string, unknown> | null>();
        const writes = new Map<string, FirestoreTransactionDocumentWrite>();
        const changedActorSources = new Map<string, ActiveUserDirtySourceKey>();
        const read = async (collection: string, id: string) => {
          const key = cacheKey(collection, id);
          if (cache.has(key)) return cache.get(key) ?? null;
          const value = await this.firestore.getDocumentInTransaction(collection, id, transaction);
          cache.set(key, value);
          return value;
        };
        const stage = (
          collection: string,
          id: string,
          value: Record<string, unknown>,
        ) => {
          const key = cacheKey(collection, id);
          cache.set(key, value);
          writes.set(key, { collection, id, value });
        };

        for (const { event } of eventRows) {
          const dayId = actorDayId(event);
          const actorDayBefore = withoutStorageId<ObservabilityActorDay>(
            await read(ACTOR_DAY_COLLECTION, dayId),
          );
          if (actorDayBefore === null) {
            const source: ActiveUserDirtySourceKey = {
              environment: event.environment,
              localDate: observabilityReportingDate(event.occurredAt),
            };
            changedActorSources.set(dirtySourceKey(source), source);
          }
          const nextActorDay = projectActorDay({
            current: actorDayBefore,
            event,
            nowIso: runStartedAt,
          });
          stage(
            ACTOR_DAY_COLLECTION,
            dayId,
            nextActorDay as unknown as Record<string, unknown>,
          );

          const rollupId = dailyRollupId(event);
          const dailyBefore = withoutStorageId<ObservabilityDailyRollup>(
            await read(DAILY_ROLLUP_COLLECTION, rollupId),
          );
          const nextDaily = projectDailyRollup({
            current: dailyBefore,
            event,
            actorDayWasNew: actorDayBefore === null,
            nowIso: runStartedAt,
          });
          stage(
            DAILY_ROLLUP_COLLECTION,
            rollupId,
            nextDaily as unknown as Record<string, unknown>,
          );

          if (event.eventType === 'planning_outcome') {
            const planningEvent = event as StoredObservabilityEvent<PlanningOutcomeMetricPayload>;
            const featureSessionId = planningEvent.correlation.featureSessionId?.trim() ?? '';
            if (!featureSessionId) throw new Error('invalid_planning_session_event');
            const sessionId = planningSessionDocumentId(event.environment, featureSessionId);
            const sessionBefore = withoutStorageId<ObservabilityPlanningSessionSummary>(
              await read(PRODUCT_OBSERVABILITY_PLANNING_SESSION_COLLECTION, sessionId),
            );
            const nextSession = projectPlanningSessionSummary({
              current: sessionBefore,
              event: planningEvent,
              nowIso: runStartedAt,
            });
            const cohortDates = new Set<string>();
            if (sessionBefore?.startedDate) cohortDates.add(sessionBefore.startedDate);
            if (nextSession.startedDate) cohortDates.add(nextSession.startedDate);
            for (const cohortDate of cohortDates) {
              const cohortId = planningDailyCohortDocumentId(event.environment, cohortDate);
              const cohortBefore = withoutStorageId<ObservabilityPlanningDailyCohort>(
                await read(PRODUCT_OBSERVABILITY_PLANNING_DAILY_COLLECTION, cohortId),
              );
              const nextCohort = projectPlanningDailyCohort({
                current: cohortBefore,
                previousSession: sessionBefore,
                nextSession,
                environment: event.environment,
                cohortDate,
                nowIso: runStartedAt,
              });
              stage(
                PRODUCT_OBSERVABILITY_PLANNING_DAILY_COLLECTION,
                cohortId,
                nextCohort as unknown as Record<string, unknown>,
              );
            }
            stage(
              PRODUCT_OBSERVABILITY_PLANNING_SESSION_COLLECTION,
              sessionId,
              nextSession as unknown as Record<string, unknown>,
            );
          }

          const summaryCollection = userSummaryCollection(event);
          const userBefore = withoutStorageId<ObservabilityUserSummary>(await read(
            summaryCollection,
            event.actorSubjectId,
          ));
          const nextUser = projectUserSummary({
            current: userBefore,
            event,
            nowIso: runStartedAt,
          });
          stage(
            summaryCollection,
            event.actorSubjectId,
            nextUser as unknown as Record<string, unknown>,
          );
        }

        const changedSources = [...changedActorSources.values()].sort((left, right) =>
          dirtySourceKey(left).localeCompare(dirtySourceKey(right)));
        const last = eventRows[eventRows.length - 1];
        const checkpoint: ObservabilityRollupCheckpoint = {
          ...transactionalCheckpoint,
          cursor: {
            observedAt: last.event.observedAt,
            documentName: last.document.documentName,
          },
          processedEventCount: transactionalCheckpoint.processedEventCount + eventRows.length,
          activeUserDirtySources: mergeDirtySources(
            transactionalCheckpoint.activeUserDirtySources,
            changedSources,
          ),
          lastRunStartedAt: runStartedAt,
          lastSuccessfulRunAt: runStartedAt,
          lastFailureAt: null,
          lastFailureCategory: null,
          updatedAt: runStartedAt,
        };
        writes.set(cacheKey(ROLLUP_STATE_COLLECTION, ROLLUP_STATE_ID), {
          collection: ROLLUP_STATE_COLLECTION,
          id: ROLLUP_STATE_ID,
          value: checkpoint as unknown as Record<string, unknown>,
        });
        await this.firestore.commitTransaction(transaction, [...writes.values()]);
        const hasFreshTail = settledEvents.length < orderedEvents.length;
        return {
          processed: eventRows.length,
          hasMore: !hasFreshTail && orderedEvents.length >= Math.max(1, Math.floor(limit)),
          checkpoint,
        };
      } catch (error) {
        lastError = error;
        try {
          await this.firestore.rollbackTransaction(transaction);
        } catch {
          // A failed/committed transaction may no longer be rollbackable.
        }
        if (error instanceof FirestoreTransactionConflictError) continue;
        await this.recordFailure(error);
        throw error;
      }
    }

    await this.recordFailure(lastError);
    throw lastError instanceof Error
      ? lastError
      : new Error('Observability rollup transaction retry limit exceeded.');
  }
}
