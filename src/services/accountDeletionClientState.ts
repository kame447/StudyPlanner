const paused = new Set<string>();
const key = (uid: string) => `studyplanner.accountDeletionStarted.v1.${encodeURIComponent(uid)}`;

export function pauseAccountClientWrites(uid: string): void {
  paused.add(uid);
  try { window.localStorage.setItem(key(uid), 'true'); } catch { /* The current page still pauses. */ }
}

export function accountClientWritesPaused(uid: string): boolean {
  if (paused.has(uid)) return true;
  try { return window.localStorage.getItem(key(uid)) === 'true'; } catch { return false; }
}

export function resumeAccountClientWrites(uid: string): void {
  paused.delete(uid);
  try { window.localStorage.removeItem(key(uid)); } catch { /* No server job was started. */ }
}
