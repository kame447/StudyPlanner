import {
  FirestoreServiceAccountClient,
  type FirestoreBulkDocumentWrite,
  type FirestoreOrderedDocument,
  type FirestoreServiceAccountEnv,
} from './firestoreServiceAccountClient';

const RETENTION_COLLECTIONS = [
  'observability_events',
  'observability_actor_day',
  'observability_daily_rollups',
  'observability_active_user_windows',
] as const;
const DEFAULT_RETENTION_BATCH_SIZE = 100;
const MAX_RETENTION_BATCH_SIZE = 100;

interface ObservabilityRetentionFirestore {
  queryDocumentsAfter(params: {
    collection: string;
    orderByField: string;
    limit?: number;
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
  const expired: FirestoreOrderedDocument[] = [];
  for (const row of rows) {
    if (typeof row.expireAt !== 'string' || row.expireAt > nowIso) break;
    expired.push(row);
  }
  return expired;
}

export class ProductObservabilityRetentionService {
  constructor(
    env: ProductObservabilityRetentionEnv,
    private readonly firestore: ObservabilityRetentionFirestore = new FirestoreServiceAccountClient(env),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async runBatch(
    limit = DEFAULT_RETENTION_BATCH_SIZE,
  ): Promise<ProductObservabilityRetentionResult> {
    const pageSize = Math.max(1, Math.min(MAX_RETENTION_BATCH_SIZE, Math.floor(limit)));
    const nowIso = this.now().toISOString();
    let deleted = 0;
    let hasMore = false;
    const deletes: FirestoreBulkDocumentWrite[] = [];

    for (const collection of RETENTION_COLLECTIONS) {
      const rows = await this.firestore.queryDocumentsAfter({
        collection,
        orderByField: 'expireAt',
        limit: pageSize,
      });
      const expired = expiredPrefix(rows, nowIso);
      expired.forEach((row) => deletes.push({ collection, id: row.id, delete: true }));
      deleted += expired.length;
      if (expired.length === pageSize) hasMore = true;
    }

    await this.firestore.commitWrites(deletes);
    return { deleted, hasMore };
  }
}
