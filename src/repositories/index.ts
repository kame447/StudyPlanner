import { isSupabaseEnabled } from '../lib/supabaseConfig';
import { isDevTestLoginEnabled } from '../lib/devAuthShortcut';
import { createRepositories } from './createRepositories';
import {
  createLocalAuthStorageGateway,
  createLocalPlannerStorageGateway,
} from './localStorageGateway';
import { createSupabaseRepositories } from './supabaseRepositories';

const localRepositoryBundle = createRepositories({
  authStorageGateway: createLocalAuthStorageGateway(),
  plannerStorageGateway: createLocalPlannerStorageGateway(),
});

const repositoryBundle = isSupabaseEnabled() && !isDevTestLoginEnabled()
  ? createSupabaseRepositories()
  : localRepositoryBundle;

export const { authRepository, plannerRepository } = repositoryBundle;
