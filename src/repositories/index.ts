import { createRepositories } from './createRepositories';
import {
  createLocalAuthStorageGateway,
  createLocalPlannerStorageGateway,
} from './localStorageGateway';

export const { authRepository, plannerRepository } = createRepositories({
  authStorageGateway: createLocalAuthStorageGateway(),
  plannerStorageGateway: createLocalPlannerStorageGateway(),
});
