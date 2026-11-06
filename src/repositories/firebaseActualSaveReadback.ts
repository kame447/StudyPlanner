import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { collection, documentId, getDocsFromServer, query, where } from 'firebase/firestore';
import { ActualSaveReadbackUnknownError, type ActualSaveServerReadback } from '../domain/actualSaveReadback';

/** Reads only the confirmed server view of the requested owner-bound actual IDs. */
export function createFirebaseActualSaveReadback(firestoreDb: Firestore, firebaseAuth: Auth) {
  return async (ownerId: string, ids: readonly string[]): Promise<ActualSaveServerReadback> => {
    if (!ownerId || firebaseAuth.currentUser?.uid !== ownerId) throw new ActualSaveReadbackUnknownError('auth_mismatch');
    if (ids.length === 0 || ids.some(id => !id)) throw new ActualSaveReadbackUnknownError('read_failed');
    let snapshots: Awaited<ReturnType<typeof getDocsFromServer>>[];
    try {
      // Exact ID ranges, rather than equality, also permit a missing first-save document under current Rules.
      snapshots = await Promise.all(ids.map(id => getDocsFromServer(query(collection(firestoreDb, 'actuals'),
        where('userId', '==', ownerId), where(documentId(), '>=', id), where(documentId(), '<=', id)))));
    } catch (error) {
      const code = (error as { code?: string })?.code;
      throw new ActualSaveReadbackUnknownError(code === 'permission-denied' ? 'permission_denied'
        : code === 'unavailable' ? 'unavailable' : 'read_failed');
    }
    if (firebaseAuth.currentUser?.uid !== ownerId) throw new ActualSaveReadbackUnknownError('auth_mismatch');
    return { fromCache: snapshots.some(snapshot => snapshot.metadata?.fromCache !== false),
      hasPendingWrites: snapshots.some(snapshot => snapshot.metadata?.hasPendingWrites !== false),
      records: snapshots.flatMap(snapshot => snapshot.docs.map(row => ({
        ...(row.data() as Record<string, unknown>), id: row.id,
      } as ActualSaveServerReadback['records'][number]))) };
  };
}
