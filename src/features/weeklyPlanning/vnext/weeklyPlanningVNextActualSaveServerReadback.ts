import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { createFirebaseActualSaveReadback } from '../../../repositories/firebaseActualSaveReadback';
import { readAndClassifyActualSave, type ActualSaveIntentRecord } from './weeklyPlanningVNextActualSaveReadback';

/** Lazy-side read-only composition; the UI does not call this slice yet. */
export function readAndClassifyActualSaveFromServer(params: {
  firestoreDb: Firestore;
  firebaseAuth: Auth;
  ownerId: string;
  attempted: readonly ActualSaveIntentRecord[];
}) {
  return readAndClassifyActualSave({ ownerId: params.ownerId, attempted: params.attempted,
    readConfirmed: createFirebaseActualSaveReadback(params.firestoreDb, params.firebaseAuth) });
}
