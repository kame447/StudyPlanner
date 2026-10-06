export function resolveStartupDiagnosticChoice<T extends string>(
  search: string, key: string, choices: readonly T[], fallback: T,
): T {
  try {
    const query = new URLSearchParams(search);
    if (query.getAll('startupTiming').length !== 1 || query.get('startupTiming') !== '1'
      || query.getAll(key).length !== 1) return fallback;
    return choices.find(choice => choice === query.get(key)) ?? fallback;
  } catch { return fallback; }
}

export function readStartupSearch(): string {
  try { return typeof window === 'undefined' ? '' : window.location.search; }
  catch { return ''; }
}
