import { doc, getDoc, type Firestore } from 'firebase/firestore';
import { getFirebaseAuth, getFirestoreDb } from '../lib/firebaseClient';
import type { RepositoryBundle } from './createRepositories';
import { createFirebaseAuthRepository } from './firebaseAuthRepository';
import { createFirebasePlannerRepository } from './firebasePlannerRepository';
import { createFirebaseScheduleEventAuthority } from './firebaseScheduleEventAuthority';
import { createObservedPlannerRepository } from './observedPlannerRepository';
import {
  ScheduleEventMigrationCapabilityUnavailableError,
  createScheduleEventBackedPlannerRepository,
  type LegacyScheduleSnapshot,
  type ScheduleEventAuthorityRepository,
} from './scheduleEventAuthorityRepository';

function isPermissionDenied(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = String((error as { code?: unknown }).code ?? '');
  return code.includes('permission-denied');
}

export function createRolloutCompatibleFirebaseScheduleEventAuthority(
  firestoreDb: Firestore,
  authorityRepository: ScheduleEventAuthorityRepository =
    createFirebaseScheduleEventAuthority(firestoreDb),
): ScheduleEventAuthorityRepository {
  return {
    ...authorityRepository,
    async ensureMigrated(
      userId: string,
      loadLegacy: () => Promise<LegacyScheduleSnapshot>,
    ) {
      try {
        // The application and Firestore Rules are deployed independently. Probe
        // the migration marker read before attempting cutover so a newly deployed
        // client can continue on the legacy authority while production still has
        // the previous Rules version. Once the Rules capability is present, the
        // next operation retries and performs the normal marker-first migration.
        await getDoc(doc(firestoreDb, 'schedule_event_migrations', userId));
      } catch (error) {
        if (isPermissionDenied(error)) {
          throw new ScheduleEventMigrationCapabilityUnavailableError(
            'Firestore Rules do not expose the ScheduleEvent migration capability yet.',
          );
        }
        throw error;
      }

      await authorityRepository.ensureMigrated(userId, loadLegacy);
    },
  };
}

export function createFirebaseRepositories(): RepositoryBundle {
  const firebaseAuth = getFirebaseAuth();
  const firestoreDb = getFirestoreDb();

  if (!firebaseAuth || !firestoreDb) {
    throw new Error('Firebase の設定が不足しています。');
  }

  const legacyPlannerRepository = createFirebasePlannerRepository(firestoreDb);
  const plannerRepository = createScheduleEventBackedPlannerRepository(
    legacyPlannerRepository,
    createRolloutCompatibleFirebaseScheduleEventAuthority(firestoreDb),
  );

  return {
    authRepository: createFirebaseAuthRepository(firebaseAuth, firestoreDb),
    plannerRepository: createObservedPlannerRepository(plannerRepository),
  };
}
