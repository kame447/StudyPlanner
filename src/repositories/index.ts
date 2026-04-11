import { isFirebaseEnabled } from '../lib/firebaseConfig';
import { createRepositories } from './createRepositories';
import {
  createLocalAuthStorageGateway,
  createLocalPlannerStorageGateway,
} from './localStorageGateway';
import { createFirebaseRepositories } from './firebaseRepositories';
import {
  createUnavailableAuthRepository,
  createUnavailablePlannerRepository,
} from './unavailableRepositories';

const localRepositoryBundle = createRepositories({
  authStorageGateway: createLocalAuthStorageGateway(),
  plannerStorageGateway: createLocalPlannerStorageGateway(),
});

function canUseLocalFallback(): boolean {
  if (import.meta.env.DEV) {
    return true;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  const host = window.location.hostname.trim().toLowerCase();
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host.endsWith('.local')
  );
}

const repositoryBundle = isFirebaseEnabled()
  ? createFirebaseRepositories()
  : canUseLocalFallback()
    ? localRepositoryBundle
    : {
        authRepository: createUnavailableAuthRepository(),
        plannerRepository: createUnavailablePlannerRepository(),
      };

export const { authRepository, plannerRepository } = repositoryBundle;
