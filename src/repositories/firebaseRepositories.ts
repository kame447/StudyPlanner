import { getFirebaseAuth, getFirestoreDb } from '../lib/firebaseClient';
import type { RepositoryBundle } from './createRepositories';
import { createFirebaseAuthRepository } from './firebaseAuthRepository';
import { createFirebasePlannerRepository } from './firebasePlannerRepository';
import { createFirebaseScheduleEventAuthority } from './firebaseScheduleEventAuthority';
import { createObservedPlannerRepository } from './observedPlannerRepository';
import { createScheduleEventBackedPlannerRepository } from './scheduleEventAuthorityRepository';

export function createFirebaseRepositories(): RepositoryBundle {
  const firebaseAuth = getFirebaseAuth();
  const firestoreDb = getFirestoreDb();

  if (!firebaseAuth || !firestoreDb) {
    throw new Error('Firebase の設定が不足しています。');
  }

  const legacyPlannerRepository = createFirebasePlannerRepository(firestoreDb);
  const plannerRepository = createScheduleEventBackedPlannerRepository(
    legacyPlannerRepository,
    createFirebaseScheduleEventAuthority(firestoreDb),
  );

  return {
    authRepository: createFirebaseAuthRepository(firebaseAuth, firestoreDb),
    plannerRepository: createObservedPlannerRepository(plannerRepository),
  };
}
