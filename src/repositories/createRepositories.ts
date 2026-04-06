import { createAuthRepository } from './authRepository';
import { createPlannerRepository } from './plannerRepository';
import type {
  AuthRepository,
  AuthStorageGateway,
  PlannerRepository,
  PlannerStorageGateway,
} from './repositoryContracts';

export interface RepositoryDependencies {
  authStorageGateway: AuthStorageGateway;
  plannerStorageGateway: PlannerStorageGateway;
}

export interface RepositoryBundle {
  authRepository: AuthRepository;
  plannerRepository: PlannerRepository;
}

export function createRepositories(
  dependencies: RepositoryDependencies,
): RepositoryBundle {
  return {
    authRepository: createAuthRepository(dependencies.authStorageGateway),
    plannerRepository: createPlannerRepository(
      dependencies.plannerStorageGateway,
    ),
  };
}
