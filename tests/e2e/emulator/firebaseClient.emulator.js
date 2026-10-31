// The production Firebase client, connected to the local Auth and Firestore emulators before first use (#947).
// Only tests/e2e/emulator/vite.config.mjs substitutes this module; production builds never see it.
import { connectAuthEmulator } from 'firebase/auth';
import { connectFirestoreEmulator } from 'firebase/firestore';
import * as client from '../../../src/lib/firebaseClient.ts';

let connected = false;

function connectOnce() {
  if (connected) return;
  connected = true;
  const auth = client.getFirebaseAuth();
  const firestore = client.getFirestoreDb();
  if (!auth || !firestore) throw new Error('The emulator target needs the demo Firebase config from its Vite config.');
  connectAuthEmulator(auth, `http://${import.meta.env.VITE_E2E_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  const [host, port] = import.meta.env.VITE_E2E_FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(firestore, host, Number(port));
}

export function getFirebaseApp() {
  connectOnce();
  return client.getFirebaseApp();
}

export function getFirebaseAuth() {
  connectOnce();
  return client.getFirebaseAuth();
}

export function getFirestoreDb() {
  connectOnce();
  return client.getFirestoreDb();
}

export const createGoogleProvider = client.createGoogleProvider;
