import { isSupabaseEnabled } from '../lib/supabaseConfig';
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

const repositoryBundle = isSupabaseEnabled()
  ? createSupabaseRepositories()
  : localRepositoryBundle;

export const { authRepository, plannerRepository } = repositoryBundle;
