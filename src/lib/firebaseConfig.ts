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

function normalizeEnvValue(value: string | undefined): string {
  return value?.trim() ?? '';
}

export function getFirebaseConfig(): FirebaseConfig {
  const apiKey = normalizeEnvValue(import.meta.env.VITE_FIREBASE_API_KEY);
  const authDomain = normalizeEnvValue(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN);
  const projectId = normalizeEnvValue(import.meta.env.VITE_FIREBASE_PROJECT_ID);
  const appId = normalizeEnvValue(import.meta.env.VITE_FIREBASE_APP_ID);

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
    enabled: Boolean(apiKey && authDomain && projectId && appId),
  };
}

export function isFirebaseEnabled(): boolean {
  return getFirebaseConfig().enabled;
}
