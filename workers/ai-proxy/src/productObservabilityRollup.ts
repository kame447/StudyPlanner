import {
  PRODUCT_OBSERVABILITY_READ_MODEL_VERSION,
  type ObservabilityActorDay,
  type ObservabilityDailyRollup,
  type ObservabilityRollupCheckpoint,
  type ObservabilityRollupCursor,
  type ObservabilityUserSummary,
} from '../../../shared/productObservabilityReadModel';
import {
  FirestoreServiceAccountClient,
  FirestoreTransactionConflictError,
  type FirestoreOrderedDocument,
  type FirestoreServiceAccountEnv,
  type FirestoreTransactionDocumentWrite,
} from './firestoreServiceAccountClient';
import {
  observabilityReportingDate,
  projectActorDay,
  projectDailyRollup,
  projectUserSummary,
  type StoredProductObservabilityEvent,
} from './productObservabilityReadModelProjection';

const EVENT_COLLECTION = 'observability_events';
const ACTOR_DAY_COLLECTION = 'observability_actor_day';
const USER_SUMMARY_COLLECTION = 'observability_user_summary';
const DAILY_ROLLUP_COLLECTION = 'observability_daily_rollups';
const ROLLUP_STATE_COLLECTION = 'observability_rollup_state';
const ROLLUP_STATE_ID = 'main';
const DEFAULT_BATCH_SIZE = 50;
const MAX_TRANSACTION_ATTEMPTS = 3;

interface ObservabilityRollupFirestore {
  getDocument(collection: string, id: string): Promise<Record<string, unknown> | null>;
  setDocument(collection: string, id: string, value: Record<string, unknown>): Promise<void>;
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

function emptyCheckpoint(nowIso: string): ObservabilityRollupCheckpoint {
  return {
    schemaVersion: PRODUCT_OBSERVABILITY_READ_MODEL_VERSION,
    cursor: null,
    processedEventCount: 0,
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
    || typeof value.environment !== 'string'
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

function cacheKey(collection: string, id: string): string {
  return `${collection}/${id}`;
}

function asActorDay(value: Record<string, unknown> | null): ObservabilityActorDay | null {
  return value as unknown as ObservabilityActorDay | null;
}

function asDailyRollup(value: Record<string, unknown> | null): ObservabilityDailyRollup | null {
  return value as unknown as ObservabilityDailyRollup | null;
}

function asUserSummary(value: Record<string, unknown> | null): ObservabilityUserSummary | null {
  return value as unknown as ObservabilityUserSummary | null;
}

function failureCategory(error: unknown): string {
  if (error instanceof FirestoreTransactionConflictError) return 'transaction_conflict';
  if (error instanceof Error && error.message === 'invalid_observability_event') {
    return 'invalid_event';
  }
  return 'rollup_failure';
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

  private async recordFailure(
    base: ObservabilityRollupCheckpoint,
    error: unknown,
  ): Promise<void> {
    const nowIso = this.now().toISOString();
    await this.firestore.setDocument(ROLLUP_STATE_COLLECTION, ROLLUP_STATE_ID, {
      ...base,
      lastFailureAt: nowIso,
      lastFailureCategory: failureCategory(error),
      updatedAt: nowIso,
    } as unknown as Record<string, unknown>);
  }

  async runBatch(limit = DEFAULT_BATCH_SIZE): Promise<ProductObservabilityRollupResult> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      const before = await this.checkpoint();
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
      const runStartedAt = this.now().toISOString();
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

        if (orderedEvents.length === 0) {
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

        const eventRows = orderedEvents.map((document) => ({
          document,
          event: storedEventFromOrderedDocument(document),
        }));
        const cache = new Map<string, Record<string, unknown> | null>();
        const writes = new Map<string, FirestoreTransactionDocumentWrite>();
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
          const actorDayBefore = asActorDay(await read(ACTOR_DAY_COLLECTION, dayId));
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
          const dailyBefore = asDailyRollup(await read(DAILY_ROLLUP_COLLECTION, rollupId));
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

          const userBefore = asUserSummary(await read(
            USER_SUMMARY_COLLECTION,
            event.actorSubjectId,
          ));
          const nextUser = projectUserSummary({
            current: userBefore,
            event,
            nowIso: runStartedAt,
          });
          stage(
            USER_SUMMARY_COLLECTION,
            event.actorSubjectId,
            nextUser as unknown as Record<string, unknown>,
          );
        }

        const last = eventRows[eventRows.length - 1];
        const checkpoint: ObservabilityRollupCheckpoint = {
          ...transactionalCheckpoint,
          cursor: {
            observedAt: last.event.observedAt,
            documentName: last.document.documentName,
          },
          processedEventCount: transactionalCheckpoint.processedEventCount + eventRows.length,
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
        return {
          processed: eventRows.length,
          hasMore: orderedEvents.length >= Math.max(1, Math.floor(limit)),
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
        await this.recordFailure(before, error);
        throw error;
      }
    }

    const checkpoint = await this.checkpoint();
    await this.recordFailure(checkpoint, lastError);
    throw lastError instanceof Error
      ? lastError
      : new Error('Observability rollup transaction retry limit exceeded.');
  }
}
