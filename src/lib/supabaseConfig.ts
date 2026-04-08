export interface SupabaseConfig {
  url: string;
  anonKey: string;
  enabled: boolean;
}

function normalizeEnvValue(value: string | undefined): string {
  return value?.trim() ?? '';
}

export function getSupabaseConfig(): SupabaseConfig {
  const url = normalizeEnvValue(import.meta.env.VITE_SUPABASE_URL);
  const anonKey = normalizeEnvValue(import.meta.env.VITE_SUPABASE_ANON_KEY);

  return {
    url,
    anonKey,
    enabled: Boolean(url && anonKey),
  };
}

export function isSupabaseEnabled(): boolean {
  return getSupabaseConfig().enabled;
}
