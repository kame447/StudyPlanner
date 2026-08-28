export const PROFILE_REGISTERED_AT_FIELD = 'registeredAt' as const;

export function normalizeProfileRegistrationTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  const timestamp = new Date(normalized);
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null;
}
