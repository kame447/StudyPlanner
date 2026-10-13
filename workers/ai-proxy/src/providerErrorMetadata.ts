const ERROR_NAMES = ['Error', 'TypeError', 'SyntaxError', 'RangeError', 'AbortError', 'TimeoutError'] as const;
const ERROR_CODES = ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT'] as const;

/** Ordinary logs retain classifications, never message/stack/cause or arbitrary
 * provider-authored name/code strings. Unknown diagnostics remain unknown.
 */
export function safeProviderErrorMetadata(error: unknown): { name: string; code: string | null } {
  try {
    const name = error instanceof Error && ERROR_NAMES.some(value => value === error.name)
      ? error.name : 'unknown';
    const code = typeof error === 'object' && error !== null
      ? (error as { code?: unknown }).code : undefined;
    return { name, code: typeof code === 'string' && ERROR_CODES.some(value => value === code) ? code : null };
  } catch { return { name: 'unknown', code: null }; }
}
