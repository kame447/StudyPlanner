export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket: string;
  messagingSenderId: string;
  measurementId: string;
  enabled: boolean;
}

let didLogMissingFirebaseConfig = false;

function normalizeEnvValue(value: string | undefined): string {
  return value?.trim() ?? '';
}

export function getFirebaseConfig(): FirebaseConfig {
  const apiKey = normalizeEnvValue(import.meta.env.VITE_FIREBASE_API_KEY);
  const authDomain = normalizeEnvValue(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN);
  const projectId = normalizeEnvValue(import.meta.env.VITE_FIREBASE_PROJECT_ID);
  const appId = normalizeEnvValue(import.meta.env.VITE_FIREBASE_APP_ID);
  const missingRequiredKeys = [
    !apiKey ? 'VITE_FIREBASE_API_KEY' : null,
    !authDomain ? 'VITE_FIREBASE_AUTH_DOMAIN' : null,
    !projectId ? 'VITE_FIREBASE_PROJECT_ID' : null,
    !appId ? 'VITE_FIREBASE_APP_ID' : null,
  ].filter((value): value is string => Boolean(value));
  const enabled = missingRequiredKeys.length === 0;

  if (!enabled && !didLogMissingFirebaseConfig && typeof window !== 'undefined') {
    didLogMissingFirebaseConfig = true;
    console.warn(
      '[Firebase Config] Missing required environment variables:',
      missingRequiredKeys,
    );
  }

  return {
    apiKey,
    authDomain,
    projectId,
    appId,
    storageBucket: normalizeEnvValue(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: normalizeEnvValue(
      import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    ),
    measurementId: normalizeEnvValue(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID),
    enabled,
  };
}

export function isFirebaseEnabled(): boolean {
  return getFirebaseConfig().enabled;
}
