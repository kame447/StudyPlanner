import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getFirebaseConfig } from './firebaseConfig';

let firebaseApp: FirebaseApp | null | undefined;
let firebaseAuth: Auth | null | undefined;
let firestoreDb: Firestore | null | undefined;

export function getFirebaseApp(): FirebaseApp | null {
  if (firebaseApp !== undefined) {
    return firebaseApp;
  }

  const config = getFirebaseConfig();

  if (!config.enabled) {
    firebaseApp = null;
    return firebaseApp;
  }

  firebaseApp = initializeApp({
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    appId: config.appId,
    storageBucket: config.storageBucket || undefined,
    messagingSenderId: config.messagingSenderId || undefined,
    measurementId: config.measurementId || undefined,
  });
  return firebaseApp;
}

export function getFirebaseAuth(): Auth | null {
  if (firebaseAuth !== undefined) {
    return firebaseAuth;
  }

  const app = getFirebaseApp();

  if (!app) {
    firebaseAuth = null;
    return firebaseAuth;
  }

  firebaseAuth = getAuth(app);
  return firebaseAuth;
}

export function getFirestoreDb(): Firestore | null {
  if (firestoreDb !== undefined) {
    return firestoreDb;
  }

  const app = getFirebaseApp();

  if (!app) {
    firestoreDb = null;
    return firestoreDb;
  }

  firestoreDb = getFirestore(app);
  return firestoreDb;
}

export function createGoogleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}
