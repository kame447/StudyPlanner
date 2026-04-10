import { isFirebaseEnabled } from '../lib/firebaseConfig';
import { createRepositories } from './createRepositories';
import {
  createLocalAuthStorageGateway,
  createLocalPlannerStorageGateway,
} from './localStorageGateway';
import { createFirebaseRepositories } from './firebaseRepositories';

const localRepositoryBundle = createRepositories({
  authStorageGateway: createLocalAuthStorageGateway(),
  plannerStorageGateway: createLocalPlannerStorageGateway(),
});

const repositoryBundle = isFirebaseEnabled()
  ? createFirebaseRepositories()
  : localRepositoryBundle;

export const { authRepository, plannerRepository } = repositoryBundle;
