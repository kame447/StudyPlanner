import { FirestoreWriteConflictError, type FirestoreServiceAccountClient } from './firestoreServiceAccountClient';

const RETENTION_MS = 180 * 86_400_000;
/** A bounded sweep removes bodies, not identity tombstones. A concurrent edit wins by updateTime,
 * never by a client timestamp; failed conditional batches are reconsidered by the next schedule. */
export async function sweepExpiredConversations(
  firestore: Pick<FirestoreServiceAccountClient, 'queryDocumentsAfter' | 'commitWrites'>,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_MS).toISOString();
  const rows = await firestore.queryDocumentsAfter({ collection: 'sessions', allDescendants: true,
    orderByField: 'updatedAt', booleanFilter: { field: 'deleted', value: false },
    endAtTimestamp: cutoff, limit: 20 });
  const writes = rows.flatMap(row => {
    const identity = /\/documents\/(weekly_planning_conversations\/([^/]+)\/sessions)\/([^/]+)$/.exec(row.documentName);
    if (!identity || row.ownerId !== identity[2] || row.id !== identity[3] || row.schemaVersion !== 1
      || row.deleted !== false || typeof row.updatedAt !== 'string' || !Number.isFinite(Date.parse(row.updatedAt))
      || Date.parse(row.updatedAt) > Date.parse(cutoff) || !row.updateTime
      || !Number.isSafeInteger(row.revision) || (row.revision as number) < 1
      || (row.revision as number) >= Number.MAX_SAFE_INTEGER) return [];
    return [{ collection: identity[1], id: row.id,
      value: { deleted: true, payload: '', revision: (row.revision as number) + 1, operationId: `expired-${row.revision}` },
      updateMask: ['deleted', 'payload', 'revision', 'operationId'], currentDocument: { updateTime: row.updateTime } }];
  });
  try { await firestore.commitWrites(writes); }
  catch (error) { if (error instanceof FirestoreWriteConflictError) return 0; throw error; }
  return writes.length;
}
