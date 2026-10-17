import {
  SEMANTIC_MEMORY_INDEX_SCHEMA_VERSION,
  SemanticMemoryUnavailableError,
  type SemanticMemoryIndexEntry,
  type SemanticMemoryModelDescriptor,
} from '../semanticMemoryContract';
import { semanticMemoryHash } from './semanticMemoryFingerprint';

const PREFIX = 'laplance-semantic-memory:';
const CATALOG = `${PREFIX}catalog`;
const CHANNEL = `${PREFIX}invalidation`;
const localInvalidators = new Set<(name: string) => void>();

function announceInvalidation(name: string): void {
  localInvalidators.forEach((invalidate) => invalidate(name));
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage(name);
    channel.close();
  }
}

/** Account cleanup discovers/deletes existing databases without opening or creating any. */
export async function deleteAllSemanticMemoryIndexDatabases(factory = globalThis.indexedDB): Promise<{
  status: 'ok';
} | { status: 'unavailable'; reason: 'storage_unavailable' | 'quota_exceeded' }> {
  try {
    if (!factory?.databases) throw new Error('database enumeration unavailable');
    for (const database of await factory.databases()) {
      if (!database.name?.startsWith(PREFIX)) continue;
      const name = database.name;
      announceInvalidation(name);
      await new Promise<void>((resolve, reject) => {
        const pending = factory.deleteDatabase(name);
        pending.onsuccess = () => resolve();
        pending.onerror = () => reject(pending.error);
        pending.onblocked = () => reject(new SemanticMemoryUnavailableError('storage_unavailable'));
      });
    }
    return { status: 'ok' };
  } catch (error) {
    return { status: 'unavailable', reason: semanticMemoryStorageError(error).reason === 'quota_exceeded'
      ? 'quota_exceeded' : 'storage_unavailable' };
  }
}

interface Fence {
  revision: number;
  snapshot: string;
  generation: number;
}
interface Registration { name: string; ownerHash: string }
export interface SemanticMemoryWriteToken extends Fence {}

export function semanticMemoryStorageError(error: unknown): SemanticMemoryUnavailableError {
  if (error instanceof SemanticMemoryUnavailableError) return error;
  return new SemanticMemoryUnavailableError(
    error instanceof Error && error.name === 'QuotaExceededError'
      ? 'quota_exceeded' : 'storage_unavailable',
  );
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('transaction aborted'));
    transaction.onerror = (event) => reject((event.target as IDBRequest | null)?.error ?? transaction.error);
  });
}

function open(factory: IDBFactory, name: string, catalog = false): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const pending = factory.open(name, 1);
    let settled = false;
    // A blocked upgrade/private-mode open must not hang core planning indefinitely.
    const timer = setTimeout(() => {
      settled = true;
      reject(new SemanticMemoryUnavailableError('storage_unavailable'));
    }, 1500);
    pending.onupgradeneeded = () => {
      const db = pending.result;
      if (catalog) db.createObjectStore('indexes', { keyPath: 'name' });
      else {
        db.createObjectStore('entries', { keyPath: 'recordId' });
        db.createObjectStore('state');
      }
    };
    pending.onblocked = () => {
      clearTimeout(timer);
      settled = true;
      reject(new SemanticMemoryUnavailableError('storage_unavailable'));
    };
    pending.onerror = () => { clearTimeout(timer); reject(pending.error); };
    pending.onsuccess = () => {
      clearTimeout(timer);
      if (settled) pending.result.close();
      else {
        pending.result.onversionchange = () => pending.result.close();
        resolve(pending.result);
      }
    };
  });
}

async function registrations(factory: IDBFactory): Promise<Registration[]> {
  const db = await open(factory, CATALOG, true);
  try {
    const tx = db.transaction('indexes', 'readonly');
    const done = complete(tx);
    const rows = await request(tx.objectStore('indexes').getAll()) as Registration[];
    await done;
    return rows;
  } finally { db.close(); }
}

async function eraseDatabase(factory: IDBFactory, name: string): Promise<void> {
  announceInvalidation(name);
  const db = await open(factory, name);
  try {
    const tx = db.transaction(['entries', 'state'], 'readwrite');
    const done = complete(tx);
    const state = tx.objectStore('state');
    const pending = state.get('fence');
    pending.onsuccess = () => {
      const old = pending.result as Fence | undefined;
      tx.objectStore('entries').clear();
      // Content-free fence survives erasure: an in-flight old tab cannot write back.
      state.put({ revision: old?.revision ?? -1, snapshot: old?.snapshot ?? '',
        generation: (old?.generation ?? 0) + 1 }, 'fence');
    };
    await done;
  } finally { db.close(); }
}

/** Erases vectors, preserving only hashed names and revision/generation tombstones. */
export async function eraseAllSemanticMemoryIndexes(options: {
  ownerId?: string;
  factory?: IDBFactory;
} = {}): Promise<{ status: 'ok' } | { status: 'unavailable'; reason: 'storage_unavailable' | 'quota_exceeded' }> {
  try {
    const factory = options.factory ?? globalThis.indexedDB;
    if (!factory) throw new Error('IndexedDB unavailable');
    const ownerHash = options.ownerId === undefined ? null : await semanticMemoryHash(options.ownerId);
    for (const row of await registrations(factory)) {
      if (ownerHash === null || row.ownerHash === ownerHash) await eraseDatabase(factory, row.name);
    }
    return { status: 'ok' };
  } catch (error) {
    const reason = semanticMemoryStorageError(error).reason;
    return { status: 'unavailable', reason: reason === 'quota_exceeded' ? reason : 'storage_unavailable' };
  }
}

export class SemanticMemoryIndexedDbStore {
  private db: IDBDatabase | undefined;
  private invalidated = false;
  private generation: number | undefined;
  private channel: BroadcastChannel | undefined;
  private opening: Promise<IDBDatabase> | undefined;
  private name = '';
  private readonly invalidate = (name: string) => {
    if (name === this.name) { this.invalidated = true; this.db?.close(); }
  };

  constructor(private readonly ownerId: string, private readonly model: SemanticMemoryModelDescriptor,
    private readonly factory: IDBFactory = globalThis.indexedDB) {}

  private async database(): Promise<IDBDatabase> {
    if (this.invalidated) throw new SemanticMemoryUnavailableError('not_opted_in');
    if (this.db) return this.db;
    this.opening ??= this.initializeDatabase();
    return this.opening;
  }

  private async initializeDatabase(): Promise<IDBDatabase> {
    if (!this.factory) throw new SemanticMemoryUnavailableError('storage_unavailable');
    const ownerHash = await semanticMemoryHash(this.ownerId);
    const modelHash = await semanticMemoryHash(JSON.stringify(this.model));
    this.name = `${PREFIX}${ownerHash}:v${SEMANTIC_MEMORY_INDEX_SCHEMA_VERSION}:${modelHash}`;
    const catalog = await open(this.factory, CATALOG, true);
    try {
      const tx = catalog.transaction('indexes', 'readwrite');
      const done = complete(tx);
      tx.objectStore('indexes').put({ name: this.name, ownerHash });
      await done;
    } finally { catalog.close(); }
    // Model/schema changes discard the obsolete disposable payload, keeping its fence.
    let inherited: Fence | undefined;
    for (const row of await registrations(this.factory)) {
      if (row.ownerHash === ownerHash && row.name !== this.name) {
        const sibling = await open(this.factory, row.name);
        try {
          const tx = sibling.transaction('state', 'readonly');
          const done = complete(tx);
          const fence = await request(tx.objectStore('state').get('fence')) as Fence | undefined;
          await done;
          if (fence && (!inherited || fence.revision > inherited.revision)) inherited = fence;
        } finally { sibling.close(); }
        await eraseDatabase(this.factory, row.name);
      }
    }
    this.db = await open(this.factory, this.name);
    if (inherited) {
      const tx = this.db.transaction('state', 'readwrite');
      const done = complete(tx);
      const pending = tx.objectStore('state').get('fence');
      pending.onsuccess = () => {
        const own = pending.result as Fence | undefined;
        if (!own || own.revision < inherited!.revision) tx.objectStore('state').put(inherited, 'fence');
      };
      await done;
    }
    localInvalidators.add(this.invalidate);
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(CHANNEL);
      this.channel.onmessage = (event: MessageEvent<unknown>) => {
        if (typeof event.data === 'string') this.invalidate(event.data);
      };
    }
    if (this.invalidated) { this.db.close(); throw new SemanticMemoryUnavailableError('not_opted_in'); }
    return this.db;
  }

  async reconcile(revision: number, snapshot: string, fingerprints: ReadonlyMap<string, string>): Promise<{
    token: SemanticMemoryWriteToken; entries: SemanticMemoryIndexEntry[];
  }> {
    const db = await this.database();
    const tx = db.transaction(['entries', 'state'], 'readwrite');
    const done = complete(tx);
    let result: { token: Fence; entries: SemanticMemoryIndexEntry[] } | undefined;
    let rejected = false;
    const state = tx.objectStore('state');
    const pending = state.get('fence');
    pending.onsuccess = () => {
      const old = pending.result as Fence | undefined;
      if ((old && (revision < old.revision || (revision === old.revision && snapshot !== old.snapshot)))
        || (this.generation !== undefined && this.generation !== (old?.generation ?? 0))) {
        rejected = true;
        return;
      }
      const token = { revision, snapshot, generation: old?.generation ?? 0 };
      const all = tx.objectStore('entries').getAll();
      all.onsuccess = () => {
        const valid = (all.result as SemanticMemoryIndexEntry[]).filter((entry) => {
          const keep = fingerprints.get(entry.recordId) === entry.contentFingerprint
            && entry.ownerId === this.ownerId && entry.sourceRevision <= revision
            && entry.modelId === this.model.modelId && entry.modelRevision === this.model.revision
            && entry.schemaVersion === SEMANTIC_MEMORY_INDEX_SCHEMA_VERSION;
          if (!keep) tx.objectStore('entries').delete(entry.recordId);
          return keep;
        });
        state.put(token, 'fence');
        result = { token, entries: valid };
      };
    };
    await done;
    if (rejected || !result) throw new SemanticMemoryUnavailableError('internal_error', 'stale canonical revision or generation');
    this.generation = result.token.generation;
    return result;
  }

  async write(token: SemanticMemoryWriteToken, entries: SemanticMemoryIndexEntry[]): Promise<boolean> {
    const db = await this.database();
    const tx = db.transaction(['entries', 'state'], 'readwrite');
    const done = complete(tx);
    let accepted = false;
    let writeError: unknown;
    const pending = tx.objectStore('state').get('fence');
    pending.onsuccess = () => {
      const current = pending.result as Fence | undefined;
      if (!this.invalidated && current?.revision === token.revision
        && current.snapshot === token.snapshot && current.generation === token.generation) {
        try {
          entries.forEach((entry) => tx.objectStore('entries').put(entry));
          accepted = true;
        } catch (error) { writeError = error; tx.abort(); }
      }
    };
    try { await done; } catch (error) { throw writeError ?? error; }
    return accepted;
  }

  async read(): Promise<{ entries: SemanticMemoryIndexEntry[]; revision: number }> {
    const db = await this.database();
    const tx = db.transaction(['entries', 'state'], 'readonly');
    const done = complete(tx);
    const [entries, fence] = await Promise.all([
      request(tx.objectStore('entries').getAll()), request(tx.objectStore('state').get('fence')),
    ]);
    await done;
    if (this.generation !== undefined && this.generation !== (fence as Fence | undefined)?.generation) {
      throw new SemanticMemoryUnavailableError('not_opted_in');
    }
    return { entries: entries as SemanticMemoryIndexEntry[], revision: (fence as Fence | undefined)?.revision ?? -1 };
  }

  dispose(): void {
    this.invalidated = true;
    this.db?.close();
    this.channel?.close();
    localInvalidators.delete(this.invalidate);
  }
}
