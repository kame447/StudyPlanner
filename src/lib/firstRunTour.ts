const STORAGE_PREFIX = 'laplance-first-run-tour-v1:';

function storageKey(ownerId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(ownerId)}`;
}

export function hasCompletedFirstRunTour(ownerId: string): boolean {
  if (!ownerId) return false;
  try {
    return window.localStorage.getItem(storageKey(ownerId)) === 'done';
  } catch {
    return false;
  }
}

export function markFirstRunTourComplete(ownerId: string): void {
  if (!ownerId) return;
  try {
    window.localStorage.setItem(storageKey(ownerId), 'done');
  } catch {
    // Continue in the current session even if browser storage is unavailable.
  }
}
