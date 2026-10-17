import { eraseAllSemanticMemoryIndexes as eraseIndexes } from './index/semanticMemoryIndexedDb';
import { semanticMemoryHash } from './index/semanticMemoryFingerprint';
import type { SemanticMemoryUnavailableReason } from './semanticMemoryContract';

const PREFIX = 'laplance-semantic-memory-opt-in:';

export async function readSemanticMemoryOptIn(ownerId: string): Promise<boolean> {
  try {
    return Boolean(ownerId) && import.meta.env.VITE_SEMANTIC_MEMORY_ENABLED === 'true'
      && globalThis.localStorage.getItem(`${PREFIX}${await semanticMemoryHash(ownerId)}`) === 'true';
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
    globalThis.localStorage.setItem(`${PREFIX}${await semanticMemoryHash(ownerId)}`, 'true');
    return true;
  } catch { return false; }
}

/** Withdraw consent before waiting for erase so pending work immediately loses access. */
export async function clearSemanticMemoryOptIn(ownerId: string): Promise<boolean> {
  let removed = false;
  try {
    globalThis.localStorage.removeItem(`${PREFIX}${await semanticMemoryHash(ownerId)}`);
    removed = true;
  } catch { /* Storage failure still attempts vector erasure. */ }
  return (await eraseIndexes({ ownerId })).status === 'ok' && removed;
}

/** Call on sign-out/account switch before constructing the next owner's index. */
export async function eraseAllSemanticMemoryIndexes(): ReturnType<typeof eraseIndexes> {
  try {
    const storage = globalThis.localStorage;
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    keys.forEach((key) => { if (key?.startsWith(PREFIX)) storage.removeItem(key); });
  } catch { /* IndexedDB erasure also invalidates already running instances. */ }
  return eraseIndexes();
}
