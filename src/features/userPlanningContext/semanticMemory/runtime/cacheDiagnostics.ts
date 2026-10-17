/** Public-artifact diagnostics only; never request text, response bodies or query strings. */
export interface ModelCacheDiagnostic {
  operation: 'match' | 'put';
  origin: string;
  path: string;
  outcome: 'hit' | 'miss' | 'stored' | 'error';
  responseStatus?: number;
  contentLength?: string | null;
  errorName?: string;
  message?: string;
}

/**
 * Debug-only transparent proxy. Keep native Cache instanceof/prototype checks,
 * invoke native methods with their actual receiver, and preserve misses/errors.
 */
export function traceModelCache<T extends Pick<Cache, 'match' | 'put'>>(cache: T, report: (event: ModelCacheDiagnostic) => void): T {
  const describe = (key: RequestInfo | URL) => {
    const raw = typeof key === 'string' ? key : key instanceof URL ? key.href : key.url;
    const url = new URL(raw, 'https://local.invalid/');
    return { origin: url.origin, path: url.pathname };
  };
  return new Proxy(cache, {
    get(target, property) {
      if (property === 'match') return async (key: RequestInfo | URL, options?: CacheQueryOptions) => {
        try {
          const result = await target.match(key, options);
          report({ operation: 'match', ...describe(key), outcome: result ? 'hit' : 'miss' });
          return result;
        } catch (error) {
          report({ operation: 'match', ...describe(key), outcome: 'error', errorName: error instanceof Error ? error.name : 'unknown', message: error instanceof Error ? error.message : undefined });
          throw error;
        }
      };
      if (property === 'put') return async (key: RequestInfo | URL, response: Response) => {
        try {
          await target.put(key, response);
          report({ operation: 'put', ...describe(key), outcome: 'stored', responseStatus: response.status, contentLength: response.headers.get('content-length') });
        } catch (error) {
          report({ operation: 'put', ...describe(key), outcome: 'error', errorName: error instanceof Error ? error.name : 'unknown', message: error instanceof Error ? error.message : undefined });
          throw error;
        }
      };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
