import { createConfirmedStudyHistory, invalidateStudyHistoryOnWrites } from './confirmedStudyHistory';
import { createFirebaseClassAttendanceRepository } from './firebaseClassAttendanceRepository';
import type { ClassAttendanceRepository } from './classAttendanceRepository';
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

  // Share one lazy implementation per repository bundle, including its owner-
  // scoped evidence/cache. A failed import/construction remains retryable.
  let streakInstance: StudyStreakRepository | undefined;
  let streakLoading: Promise<StudyStreakRepository> | undefined;
  const loadStreak = () => streakLoading ??= import('./firebaseStudyStreakRepository')
    .then(module => {
      streakInstance = module.createFirebaseStudyStreakRepository(firestoreDb, confirmedStudyHistory);
      return streakInstance;
    }).catch(error => { streakLoading = undefined; throw error; });
  const studyStreakRepository: StudyStreakRepository = {
    canUseRestDays: true,
    peek: (owner, hint) => streakInstance?.peek?.(owner, hint) ?? null,
    read: async (owner, options) => (await loadStreak()).read(owner, options),
    useRestDay: async (history, date, today, options) => (await loadStreak()).useRestDay(history, date, today, options),
  };

  return {
    authRepository: createFirebaseAuthRepository(firebaseAuth, firestoreDb),
    classAttendanceRepository: createFirebaseClassAttendanceRepository(firestoreDb),
    studyStreakRepository,
    plannerRepository: createObservedPlannerRepository(invalidateStudyHistoryOnWrites(plannerRepository, confirmedStudyHistory)),
  };
}
