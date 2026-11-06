import { conversationScopeKey, sameConversationScope, type ConversationLocalRecord, type ConversationLocalStore,
  type ConversationScope } from './weeklyPlanningConversationSync';

const STORE = 'sessions';
function decode(raw: unknown, scope: ConversationScope): ConversationLocalRecord | null {
  if (raw === undefined || raw === null) return null;
  const row = raw as ConversationLocalRecord;
  if (row.version !== 1 || !row.scope || !sameConversationScope(row.scope, scope)
    || !Number.isSafeInteger(row.generation) || row.generation < 0 || typeof row.dirty !== 'boolean'
    || !['conflict', null].includes(row.blocked)
    || !Object.prototype.hasOwnProperty.call(row, 'working') || !Object.prototype.hasOwnProperty.call(row, 'confirmed')
    || !Object.prototype.hasOwnProperty.call(row, 'pending') || !Object.prototype.hasOwnProperty.call(row, 'conflict')) throw new Error('local-state-unreadable');
  return row;
}

/** Durable replica and outbox share one IndexedDB record/transaction, not separate localStorage keys. */
export function createIndexedDbConversationStore(options: { factory?: IDBFactory; databaseName?: string } = {}) {
  let opened: Promise<IDBDatabase> | null = null;
  function database() {
    if (opened) return opened;
    opened = new Promise<IDBDatabase>((resolve, reject) => {
      const factory = options.factory ?? globalThis.indexedDB;
      if (!factory) { reject(new Error('indexeddb-unavailable')); return; }
      const request = factory.open(options.databaseName ?? 'laplance-conversation-sync-v1', 1);
      let failed = false;
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(STORE);
        store.createIndex('owner', 'scope.ownerId');
      };
      request.onerror = () => reject(request.error ?? new Error('indexeddb-open-failed'));
      request.onblocked = () => { failed = true; reject(new Error('indexeddb-upgrade-blocked')); };
      request.onsuccess = () => {
        if (failed) { request.result.close(); return; }
        request.result.onversionchange = () => { request.result.close(); opened = null; };
        resolve(request.result);
      };
    }).catch(error => { opened = null; throw error; });
    return opened;
  }
  const store: ConversationLocalStore = {
    read: async scope => {
      const db = await database();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, 'readonly');
        const request = transaction.objectStore(STORE).get(conversationScopeKey(scope));
        let result: ConversationLocalRecord | null = null;
        let failure: unknown;
        request.onsuccess = () => { try { result = decode(request.result, scope); } catch (error) { failure = error; transaction.abort(); } };
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = transaction.onerror = () => reject(failure ?? transaction.error ?? new Error('indexeddb-read-failed'));
      });
    },
    update: async (scope, change) => {
      const db = await database();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, 'readwrite');
        const collection = transaction.objectStore(STORE);
        const key = conversationScopeKey(scope);
        const request = collection.get(key);
        let result: ConversationLocalRecord;
        let failure: unknown;
        request.onsuccess = () => {
          try { result = change(decode(request.result, scope)); decode(result, scope); collection.put(result, key); }
          catch (error) { failure = error; transaction.abort(); }
        };
        // A put success is not durability; wait for the whole transaction to commit.
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = transaction.onerror = () => reject(failure ?? transaction.error ?? new Error('indexeddb-write-failed'));
      });
    },
  };
  return { ...store,
    async removeOwner(ownerId: string) {
      const db = await database();
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE, 'readwrite');
        const cursor = transaction.objectStore(STORE).index('owner').openCursor(IDBKeyRange.only(ownerId));
        cursor.onsuccess = () => { if (cursor.result) { cursor.result.delete(); cursor.result.continue(); } };
        transaction.oncomplete = () => resolve();
        transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error('indexeddb-delete-failed'));
      });
    },
    async close() { if (opened) { (await opened).close(); opened = null; } },
  };
}
