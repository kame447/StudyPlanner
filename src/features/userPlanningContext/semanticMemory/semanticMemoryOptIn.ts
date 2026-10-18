import { eraseAllSemanticMemoryIndexes as eraseIndexes, deleteAllSemanticMemoryIndexDatabases,
  semanticMemoryDatabaseNames } from './index/semanticMemoryIndexedDb';
import { semanticMemoryHash } from './index/semanticMemoryFingerprint';
import type { SemanticMemoryUnavailableReason } from './semanticMemoryContract';

const PREFIX = 'laplance-semantic-memory-opt-in:';
export const SEMANTIC_MEMORY_ERASE_PENDING_KEY = 'laplance-semantic-memory-erase-pending';
// Content-free nonce survives completion so delayed consent writes in any tab cannot undo sign-out.
export const SEMANTIC_MEMORY_ERASE_EPOCH_KEY = 'laplance-semantic-memory-erase-epoch';

function beginErase(): string | null {
  try {
    const token = crypto.randomUUID();
    globalThis.localStorage.setItem(SEMANTIC_MEMORY_ERASE_PENDING_KEY, token);
    globalThis.localStorage.setItem(SEMANTIC_MEMORY_ERASE_EPOCH_KEY, token);
    return token;
  } catch { return null; }
}

function finishErase(token: string | null): boolean {
  if (!token) return false;
  try {
    // An older completion cannot acknowledge a newer tab's erase request.
    if (globalThis.localStorage.getItem(SEMANTIC_MEMORY_ERASE_PENDING_KEY) === token) {
      globalThis.localStorage.removeItem(SEMANTIC_MEMORY_ERASE_PENDING_KEY);
    }
    return true;
  } catch { return false; }
}

export async function readSemanticMemoryOptIn(ownerId: string): Promise<boolean> {
  try {
    if (!ownerId || import.meta.env.VITE_SEMANTIC_MEMORY_ENABLED !== 'true') return false;
    const generation = globalThis.localStorage.getItem(SEMANTIC_MEMORY_ERASE_EPOCH_KEY);
    const key = `${PREFIX}${await semanticMemoryHash(ownerId)}`;
    return generation === globalThis.localStorage.getItem(SEMANTIC_MEMORY_ERASE_EPOCH_KEY)
      && !globalThis.localStorage.getItem(SEMANTIC_MEMORY_ERASE_PENDING_KEY)
      && globalThis.localStorage.getItem(key) === 'true';
  } catch { return false; }
}

export async function semanticMemoryAccess(ownerId: string): Promise<SemanticMemoryUnavailableReason | null> {
  if (import.meta.env.VITE_SEMANTIC_MEMORY_ENABLED !== 'true') return 'disabled';
  return await readSemanticMemoryOptIn(ownerId) ? null : 'not_opted_in';
}

export async function setSemanticMemoryOptIn(ownerId: string, enabled: boolean): Promise<boolean> {
  if (!enabled) return clearSemanticMemoryOptIn(ownerId);
  if (!ownerId || import.meta.env.VITE_SEMANTIC_MEMORY_ENABLED !== 'true') return false;
  try {
    const generation = globalThis.localStorage.getItem(SEMANTIC_MEMORY_ERASE_EPOCH_KEY);
    const key = `${PREFIX}${await semanticMemoryHash(ownerId)}`;
    if (generation !== globalThis.localStorage.getItem(SEMANTIC_MEMORY_ERASE_EPOCH_KEY)
      || globalThis.localStorage.getItem(SEMANTIC_MEMORY_ERASE_PENDING_KEY)) return false;
    globalThis.localStorage.setItem(key, 'true');
    return true;
  } catch { return false; }
}

/** Withdraw consent before waiting for erase so pending work immediately loses access. */
export async function clearSemanticMemoryOptIn(ownerId: string): Promise<boolean> {
  try {
    // A new owner-only erase must not acknowledge an older unfinished global erase.
    if (globalThis.localStorage.getItem(SEMANTIC_MEMORY_ERASE_PENDING_KEY)) {
      return (await eraseAllSemanticMemoryIndexes()).status === 'ok';
    }
  } catch { /* Continue attempting erasure even when the preference store is denied. */ }
  const token = beginErase();
  let removed = false;
  try {
    globalThis.localStorage.removeItem(`${PREFIX}${await semanticMemoryHash(ownerId)}`);
    removed = true;
  } catch { /* Storage failure still attempts vector erasure. */ }
  return (await eraseIndexes({ ownerId })).status === 'ok' && removed && finishErase(token);
}

/** Call on sign-out/account switch before constructing the next owner's index. */
export async function eraseAllSemanticMemoryIndexes(): ReturnType<typeof eraseIndexes> {
  // Runs synchronously before the first await, including when sign-out immediately closes the page.
  const token = beginErase();
  let consentCleared = true;
  try {
    const storage = globalThis.localStorage;
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    for (const key of keys) {
      if (!key?.startsWith(PREFIX)) continue;
      try { storage.removeItem(key); } catch { consentCleared = false; }
    }
  } catch { consentCleared = false; }
  const result = await deleteAllSemanticMemoryIndexDatabases();
  return result.status === 'ok' && (!consentCleared || !finishErase(token))
    ? { status: 'unavailable', reason: 'storage_unavailable' } : result;
}

/** Startup cleanup is intentional even with flag OFF: delete leftovers, never load a model. */
export async function prepareSemanticMemoryOwner(ownerId: string): ReturnType<typeof eraseIndexes> {
  try {
    const storage = globalThis.localStorage;
    const ownerHash = await semanticMemoryHash(ownerId);
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    const consentForAnotherOwner = keys.some(key => key?.startsWith(PREFIX) && key !== `${PREFIX}${ownerHash}`);
    const names = await semanticMemoryDatabaseNames();
    const foreignDatabase = names.some(name => name !== 'laplance-semantic-memory:catalog'
      && !name.startsWith(`laplance-semantic-memory:${ownerHash}:`));
    if (storage.getItem(SEMANTIC_MEMORY_ERASE_PENDING_KEY) || consentForAnotherOwner || foreignDatabase
      || import.meta.env.VITE_SEMANTIC_MEMORY_ENABLED !== 'true') return eraseAllSemanticMemoryIndexes();
    return { status: 'ok' };
  } catch {
    // Inability to discover old payloads is not evidence that they have been forgotten.
    beginErase();
    return { status: 'unavailable', reason: 'storage_unavailable' };
  }
}
