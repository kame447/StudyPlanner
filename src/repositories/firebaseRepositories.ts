import { getFirebaseAuth, getFirestoreDb } from '../lib/firebaseClient';
import type { RepositoryBundle } from './createRepositories';
import { createFirebaseAuthRepository } from './firebaseAuthRepository';
import { createFirebasePlannerRepository } from './firebasePlannerRepository';

export function createFirebaseRepositories(): RepositoryBundle {
  const firebaseAuth = getFirebaseAuth();
  const firestoreDb = getFirestoreDb();

  if (!firebaseAuth || !firestoreDb) {
    throw new Error('Firebase の設定が不足しています。');
  }

  return {
    authRepository: createFirebaseAuthRepository(firebaseAuth, firestoreDb),
    plannerRepository: createFirebasePlannerRepository(firestoreDb),
  };
}
