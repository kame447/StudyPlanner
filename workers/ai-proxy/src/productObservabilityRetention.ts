import {
  FirestoreServiceAccountClient,
  type FirestoreBulkDocumentWrite,
  type FirestoreOrderedDocument,
  type FirestoreServiceAccountEnv,
} from './firestoreServiceAccountClient';

export const PRODUCT_OBSERVABILITY_RETENTION_COLLECTIONS = [
  'observability_events',
  'observability_actor_day',
  'observability_daily_rollups',
  'observability_active_user_windows',
] as const;
// Swept in a separate schedule phase so each commit stays below 500 writes.
export const WEEKLY_PLANNING_TRACE_RETENTION_COLLECTIONS = [
  'weekly_planning_trace_sessions',
  'weekly_planning_trace_entries',
  'weekly_planning_trace_access_audit',
] as const;
const DEFAULT_RETENTION_BATCH_SIZE = 100;
const MAX_RETENTION_BATCH_SIZE = 100;

interface ObservabilityRetentionFirestore {
  queryDocumentsAfter(params: {
    collection: string;
    orderByField: string;
    limit?: number;
    endAtTimestamp?: string;
  }): Promise<FirestoreOrderedDocument[]>;
  commitWrites(writes: readonly FirestoreBulkDocumentWrite[]): Promise<void>;
}

export interface ProductObservabilityRetentionEnv extends FirestoreServiceAccountEnv {}

export interface ProductObservabilityRetentionResult {
  deleted: number;
  hasMore: boolean;
}

function expiredPrefix(
  rows: readonly FirestoreOrderedDocument[],
  nowIso: string,
): FirestoreOrderedDocument[] {
  const now = nanosecondTimestamp(nowIso);
  const expired: FirestoreOrderedDocument[] = [];
  for (const row of rows) {
    const expireAt = nanosecondTimestamp(row.expireAt);
    if (!now || !expireAt || expireAt > now) break;
    expired.push(row);
  }
  return expired;
}

// Firestore returns UTC timestamps with 0, 3, 6 or 9 fractional digits; padding
// to nanoseconds makes string order equal to time order without rounding.
function nanosecondTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  return match ? `${match[1]}.${(match[2] ?? '').padEnd(9, '0')}Z` : null;
}

export class ProductObservabilityRetentionService {
  constructor(
    env: ProductObservabilityRetentionEnv,
    private readonly firestore: ObservabilityRetentionFirestore = new FirestoreServiceAccountClient(env),
    private readonly now: () => Date = () => new Date(),
    private readonly collections: readonly string[] = PRODUCT_OBSERVABILITY_RETENTION_COLLECTIONS,
  ) {}

  async runBatch(
    limit = DEFAULT_RETENTION_BATCH_SIZE,
  ): Promise<ProductObservabilityRetentionResult> {
    const pageSize = Math.max(1, Math.min(MAX_RETENTION_BATCH_SIZE, Math.floor(limit)));
    const nowIso = this.now().toISOString();
    let deleted = 0;
    let hasMore = false;
    const deletes: FirestoreBulkDocumentWrite[] = [];

    for (const collection of this.collections) {
      const first = await this.firestore.queryDocumentsAfter({
        collection,
        orderByField: 'expireAt',
        limit: 1,
      });
      if (expiredPrefix(first, nowIso).length === 0) continue;
      // This is only an idle-work probe. Deletions must come from a fresh full
      // page, since the first document may change between these two reads.
      // endAt keeps billed reads to expired documents instead of a full page.
      const rows = await this.firestore.queryDocumentsAfter({
        collection,
        orderByField: 'expireAt',
        limit: pageSize,
        endAtTimestamp: nowIso,
      });
      const expired = expiredPrefix(rows, nowIso);
      // The precondition keeps a session whose expireAt an append extended
      // after this read; the whole commit then retries on a later run.
      expired.forEach((row) => deletes.push({
        collection,
        id: row.id,
        delete: true,
        ...(row.updateTime ? { currentDocument: { updateTime: row.updateTime } } : {}),
      }));
      deleted += expired.length;
      if (expired.length === pageSize) hasMore = true;
    }

    await this.firestore.commitWrites(deletes);
    return { deleted, hasMore };
  }
}
