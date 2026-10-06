export interface StartupSessionCapability {
  isCurrent(): boolean;
  onInvalidate(dispose: () => void): () => void;
}

export interface StartupSessionScope extends StartupSessionCapability {
  invalidate(): void;
}

export function createStartupSessionScope(): StartupSessionScope {
  let current = true;
  const disposers = new Set<() => void>();
  const disposeSafely = (dispose: () => void) => {
    try { dispose(); } catch { /* One optional reader cannot prevent revoking the rest. */ }
  };
  return {
    isCurrent: () => current,
    onInvalidate(dispose) {
      if (!current) { disposeSafely(dispose); return () => {}; }
      disposers.add(dispose);
      return () => { disposers.delete(dispose); };
    },
    invalidate() {
      if (!current) return;
      current = false;
      const pending = [...disposers];
      disposers.clear();
      pending.forEach(disposeSafely);
    },
  };
}
