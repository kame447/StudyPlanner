import { createConfirmedStudyHistory, invalidateStudyHistoryOnWrites } from './confirmedStudyHistory';
import { createFirebaseClassAttendanceRepository } from './firebaseClassAttendanceRepository';
import type { ClassAttendanceRepository } from './classAttendanceRepository';
import { createFirebaseStudyStreakRepository } from './firebaseStudyStreakRepository';
import type { StudyStreakRepository } from './studyStreakRepository';
import { getFirebaseAuth, getFirestoreDb } from '../lib/firebaseClient';
import type { RepositoryBundle } from './createRepositories';
import { createFirebaseAuthRepository } from './firebaseAuthRepository';
import { createFirebasePlannerRepository } from './firebasePlannerRepository';
import { createFirebaseScheduleEventAuthority } from './firebaseScheduleEventAuthority';
import { createObservedPlannerRepository } from './observedPlannerRepository';
import { createScheduleEventBackedPlannerRepository } from './scheduleEventAuthorityRepository';

export function createFirebaseRepositories(): RepositoryBundle & { classAttendanceRepository: ClassAttendanceRepository; studyStreakRepository: StudyStreakRepository } {
  const firebaseAuth = getFirebaseAuth();
  const firestoreDb = getFirestoreDb();

  if (!firebaseAuth || !firestoreDb) {
    throw new Error('Firebase の設定が不足しています。');
  }

  const confirmedStudyHistory = createConfirmedStudyHistory();
  const legacyPlannerRepository = createFirebasePlannerRepository(firestoreDb, confirmedStudyHistory);
  const plannerRepository = createScheduleEventBackedPlannerRepository(
    legacyPlannerRepository,
    createFirebaseScheduleEventAuthority(firestoreDb, confirmedStudyHistory),
  );

  return {
    authRepository: createFirebaseAuthRepository(firebaseAuth, firestoreDb),
    classAttendanceRepository: createFirebaseClassAttendanceRepository(firestoreDb),
    studyStreakRepository: createFirebaseStudyStreakRepository(firestoreDb, confirmedStudyHistory),
    plannerRepository: createObservedPlannerRepository(invalidateStudyHistoryOnWrites(plannerRepository, confirmedStudyHistory)),
  };
}
