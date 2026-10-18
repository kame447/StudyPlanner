/** A cleanup hint only; contains a hashed owner scope or the literal signed-out scope. */
export const SEMANTIC_MEMORY_FLAG_OFF_CLEANUP_KEY = 'laplance-semantic-memory-flag-off-cleanup-done';

export function invalidateSemanticMemoryFlagOffCleanup(): void {
  const storage = globalThis.localStorage;
  if (storage?.getItem(SEMANTIC_MEMORY_FLAG_OFF_CLEANUP_KEY) !== null) {
    storage?.removeItem(SEMANTIC_MEMORY_FLAG_OFF_CLEANUP_KEY);
  }
}
