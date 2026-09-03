import { isFirebaseEnabled } from '../lib/firebaseConfig';
import { createRepositories } from './createRepositories';
import {
  createLocalAuthStorageGateway,
  createLocalPlannerStorageGateway,
} from './localStorageGateway';
import { createFirebaseRepositories } from './firebaseRepositories';
import { createLocalScheduleEventAuthority } from './localScheduleEventAuthority';
import { createScheduleEventBackedPlannerRepository } from './scheduleEventAuthorityRepository';
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
  const plannerStorageGateway = createLocalPlannerStorageGateway();
  const bundle = createRepositories({
    authStorageGateway: createLocalAuthStorageGateway(),
    plannerStorageGateway,
  });

  return {
    ...bundle,
    plannerRepository: createScheduleEventBackedPlannerRepository(
      bundle.plannerRepository,
      createLocalScheduleEventAuthority(plannerStorageGateway),
    ),
  };
}

const repositoryBundle = isFirebaseEnabled()
  ? createFirebaseRepositories()
  : canUseLocalFallback()
    ? createLocalRepositoryBundle()
    : {
        authRepository: createUnavailableAuthRepository(),
        plannerRepository: createUnavailablePlannerRepository(),
      };

export const { authRepository, plannerRepository } = repositoryBundle;
