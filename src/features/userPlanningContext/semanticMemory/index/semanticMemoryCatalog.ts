/** Content-free mirror: flag-off cleanup must enumerate names without opening IndexedDB. */
import { invalidateSemanticMemoryFlagOffCleanup } from './semanticMemoryCleanupState';
export const SEMANTIC_MEMORY_CATALOG_KEY = 'laplance-semantic-memory-index-catalog';
const KEY = SEMANTIC_MEMORY_CATALOG_KEY;
export interface SemanticMemoryRegistration { name: string; ownerHash: string }

export function readSemanticMemoryCatalog(): SemanticMemoryRegistration[] | null {
  const stored = globalThis.localStorage?.getItem(KEY);
  if (!stored) return null;
  try {
    const value: unknown = JSON.parse(stored);
    if (!Array.isArray(value) || value.some(row => !row || typeof row.name !== 'string'
      || typeof row.ownerHash !== 'string' || !row.name.startsWith(`laplance-semantic-memory:${row.ownerHash}:`))) return null;
    return value;
  } catch { return null; } // Corruption is absent metadata; legacy IDB catalog remains authoritative.
}

export function registerSemanticMemoryDatabase(row: SemanticMemoryRegistration): void {
  invalidateSemanticMemoryFlagOffCleanup();
  const rows = readSemanticMemoryCatalog() ?? [];
  globalThis.localStorage?.setItem(KEY, JSON.stringify([...rows.filter(item => item.name !== row.name), row]));
}

export function forgetSemanticMemoryDatabase(name: string): void {
  const rows = readSemanticMemoryCatalog();
  if (!rows) return;
  const remaining = rows.filter(row => row.name !== name);
  // Keep an empty mirror when IDB enumeration is unavailable: absence is not proof of empty storage.
  globalThis.localStorage.setItem(KEY, JSON.stringify(remaining));
}

export function clearSemanticMemoryCatalog(preserveEmpty = false): void {
  if (preserveEmpty) globalThis.localStorage.setItem(KEY, '[]');
  else globalThis.localStorage?.removeItem(KEY);
}
