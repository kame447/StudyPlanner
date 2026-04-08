import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from './supabaseConfig';

let supabaseClient: SupabaseClient | null | undefined;

export function getSupabaseClient(): SupabaseClient | null {
  if (supabaseClient !== undefined) {
    return supabaseClient;
  }

  const config = getSupabaseConfig();

  if (!config.enabled) {
    supabaseClient = null;
    return supabaseClient;
  }

  supabaseClient = createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return supabaseClient;
}
