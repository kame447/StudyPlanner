const APP_ACCESS_STORAGE_KEY = 'studyplanner.app-access-key';

function normalizeValue(value: string | undefined): string {
  return value?.trim() ?? '';
}

export function getConfiguredAppAccessKey(): string {
  return normalizeValue(import.meta.env.VITE_APP_ACCESS_KEY);
}

export function isAppAccessGateEnabled(): boolean {
  return getConfiguredAppAccessKey().length > 0;
}

export function hasStoredAppAccessGrant(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const configuredKey = getConfiguredAppAccessKey();

  if (!configuredKey) {
    return true;
  }

  return window.localStorage.getItem(APP_ACCESS_STORAGE_KEY) === configuredKey;
}

export function verifyAndStoreAppAccessKey(candidate: string): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const configuredKey = getConfiguredAppAccessKey();
  const normalizedCandidate = candidate.trim();

  if (!configuredKey || normalizedCandidate !== configuredKey) {
    return false;
  }

  window.localStorage.setItem(APP_ACCESS_STORAGE_KEY, configuredKey);
  return true;
}
