/** Content-free mirror: flag-off cleanup must enumerate names without opening IndexedDB. */
const KEY = 'laplance-semantic-memory-index-catalog';
export interface SemanticMemoryRegistration { name: string; ownerHash: string }

export function readSemanticMemoryCatalog(): SemanticMemoryRegistration[] | null {
  const stored = globalThis.localStorage?.getItem(KEY);
  if (!stored) return null;
  const value: unknown = JSON.parse(stored);
  if (!Array.isArray(value) || value.some(row => !row || typeof row.name !== 'string'
    || typeof row.ownerHash !== 'string' || !row.name.startsWith(`laplance-semantic-memory:${row.ownerHash}:`))) {
    throw new Error('invalid semantic memory catalog');
  }
  return value;
}

export function registerSemanticMemoryDatabase(row: SemanticMemoryRegistration): void {
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
