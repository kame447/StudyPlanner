import { collection, doc, documentId, getDocFromServer, getDocsFromServer, limit, orderBy, query,
  runTransaction, serverTimestamp, startAfter, type Firestore } from 'firebase/firestore';
import { MAX_CONVERSATION_SYNC_BYTES, validConversationScope, validateConversationPayload } from './weeklyPlanningConversationPayload';
import { sameConversationScope, type ConversationOperation, type ConversationPayload,
  type ConversationRemoteStore, type ConversationScope, type ConversationSnapshot } from './weeklyPlanningConversationSync';

export const CONVERSATION_COLLECTION = 'weekly_planning_conversations';
export const conversationDocumentId = (scope: Pick<ConversationScope, 'chatId' | 'weekStartDate'>) => `${scope.chatId}.${scope.weekStartDate}`;

function decode(value: unknown, ownerId: string, id: string): ConversationSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('remote-state-unreadable');
  const data = value as Record<string, unknown>;
  const scope = { ownerId: data.ownerId, chatId: data.chatId, weekStartDate: data.weekStartDate,
    conversationId: data.conversationId } as ConversationScope;
  if (data.schemaVersion !== 1 || scope.ownerId !== ownerId || !validConversationScope(scope)
    || id !== conversationDocumentId(scope) || !Number.isSafeInteger(data.revision) || (data.revision as number) < 1
    || typeof data.operationId !== 'string' || !data.operationId || data.operationId.length > 128
    || typeof data.deleted !== 'boolean' || typeof data.payload !== 'string'
    || new TextEncoder().encode(data.payload).byteLength > MAX_CONVERSATION_SYNC_BYTES) throw new Error('remote-state-unreadable');
  let payload: ConversationPayload | null;
  try { payload = data.deleted ? null : JSON.parse(data.payload); } catch { throw new Error('remote-state-unreadable'); }
  if (data.deleted ? data.payload !== '' : payload === null || !validateConversationPayload(scope, payload)) throw new Error('remote-state-unreadable');
  return { scope, revision: data.revision as number, operationId: data.operationId, deleted: data.deleted, payload };
}

/** The Firestore transaction is the single shared revision authority. SDK offline LWW is not used. */
export function createFirestoreConversationStore(db: Firestore, ownerId: string, isCurrent: () => boolean) {
  const sessions = collection(db, CONVERSATION_COLLECTION, ownerId, 'sessions');
  function guard(scope?: ConversationScope) {
    if (!isCurrent() || (scope && scope.ownerId !== ownerId)) throw new Error('owner-changed');
    if (scope && !validConversationScope(scope)) throw new Error('invalid-conversation-scope');
  }
  const store: ConversationRemoteStore = {
    read: async scope => {
      guard(scope);
      const snapshot = await getDocFromServer(doc(sessions, conversationDocumentId(scope)));
      guard(scope);
      if (!snapshot.exists()) return null;
      const decoded = decode(snapshot.data(), ownerId, snapshot.id);
      if (!sameConversationScope(decoded.scope, scope)) throw new Error('conversation-identity-conflict');
      return decoded;
    },
    commit: async (operation: ConversationOperation) => {
      const { scope, payload } = operation;
      guard(scope);
      if (!Number.isSafeInteger(operation.baseRevision) || operation.baseRevision < 0
        || !operation.operationId || operation.operationId.length > 128
        || (payload !== null && !validateConversationPayload(scope, payload))) throw new Error('invalid-conversation-operation');
      const reference = doc(sessions, conversationDocumentId(scope));
      function previousCommit(current: ConversationSnapshot | null) {
        if (current && !sameConversationScope(current.scope, scope)) throw new Error('conversation-identity-conflict');
        if (current?.operationId === operation.operationId) {
          if (current.revision !== operation.baseRevision + 1 || JSON.stringify(current.payload) !== JSON.stringify(payload)) throw new Error('operation-identity-conflict');
          return { status: 'accepted' as const, snapshot: current };
        }
        return (current?.revision ?? 0) !== operation.baseRevision || current?.deleted
          ? { status: 'conflict' as const, snapshot: current } : null;
      }
      try {
        const result = await runTransaction(db, async transaction => {
          guard(scope);
          const stored = await transaction.get(reference);
          guard(scope);
          const current = stored.exists() ? decode(stored.data(), ownerId, stored.id) : null;
          const previous = previousCommit(current);
          if (previous) return previous;
          const next: ConversationSnapshot = { scope, revision: operation.baseRevision + 1,
            operationId: operation.operationId, deleted: payload === null, payload };
          transaction.set(reference, { schemaVersion: 1, ...scope, revision: next.revision,
            operationId: next.operationId, deleted: next.deleted, payload: payload === null ? '' : JSON.stringify(payload),
            updatedAt: serverTimestamp() });
          return { status: 'accepted' as const, snapshot: next };
        });
        guard(scope);
        return result;
      } catch (error) {
        guard(scope);
        const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
        if (code !== 'permission-denied' && code !== 'aborted') throw error;
        // Rules may reject a raced revision before the Web SDK receives ABORTED.
        // One authorized server read proves a conflict/receipt; failed reads and unchanged
        // revisions retain the original failure. Never retry the write or bypass Rules.
        const current = await store.read(scope);
        guard(scope);
        const previous = previousCommit(current);
        if (previous) return previous;
        throw error;
      }
    },
  };
  return { ...store,
    async list(cursor: string | null = null, pageSize = 20): Promise<{ items: ConversationSnapshot[]; cursor: string | null }> {
      guard();
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50 || (cursor !== null && cursor.includes('/'))) throw new Error('invalid-conversation-page');
      const page = await getDocsFromServer(query(sessions, orderBy(documentId()), ...(cursor ? [startAfter(cursor)] : []), limit(pageSize)));
      guard();
      return { items: page.docs.map(item => decode(item.data(), ownerId, item.id)),
        cursor: page.size === pageSize ? page.docs[page.size - 1].id : null };
    },
  };
}
