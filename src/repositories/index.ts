import { createLocalClassAttendanceRepository, createUnavailableClassAttendanceRepository } from './classAttendanceRepository';
import { isFirebaseEnabled } from '../lib/firebaseConfig';
import { createAuthRepository } from './authRepository';
import { createLocalPlannerRepository } from './createLocalPlannerRepository';
import { createLocalAuthStorageGateway } from './localStorageGateway';
import { createFirebaseRepositories } from './firebaseRepositories';
import {
  createUnavailableAuthRepository,
  createUnavailablePlannerRepository,
} from './unavailableRepositories';

function canUseLocalFallback(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  if (import.meta.env.DEV) {
    return true;
  }

  const host = window.location.hostname.trim().toLowerCase();
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host.endsWith('.local')
  );
}

function createLocalRepositoryBundle() {
  const plannerRepository = createLocalPlannerRepository();
  return {
    authRepository: createAuthRepository(createLocalAuthStorageGateway()),
    plannerRepository,
    classAttendanceRepository: createLocalClassAttendanceRepository(window.localStorage, plannerRepository),
  };
}

const repositoryBundle = isFirebaseEnabled()
  ? createFirebaseRepositories()
  : canUseLocalFallback()
    ? createLocalRepositoryBundle()
    : {
        authRepository: createUnavailableAuthRepository(),
        plannerRepository: createUnavailablePlannerRepository(),
        classAttendanceRepository: createUnavailableClassAttendanceRepository(),
      };

export const { authRepository, plannerRepository, classAttendanceRepository } = repositoryBundle;
