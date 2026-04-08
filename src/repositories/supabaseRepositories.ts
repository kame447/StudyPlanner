import { getSupabaseClient } from '../lib/supabaseClient';
import type { RepositoryBundle } from './createRepositories';
import { createSupabaseAuthRepository } from './supabaseAuthRepository';
import { createSupabasePlannerRepository } from './supabasePlannerRepository';

export function createSupabaseRepositories(): RepositoryBundle {
  const supabaseClient = getSupabaseClient();

  if (!supabaseClient) {
    throw new Error('Supabase の設定が不足しています。');
  }

  return {
    authRepository: createSupabaseAuthRepository(supabaseClient),
    plannerRepository: createSupabasePlannerRepository(supabaseClient),
  };
}
