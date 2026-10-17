import { describe, expect, it, vi } from 'vitest';
import { traceModelCache } from './cacheDiagnostics';

describe('public model cache diagnostics', () => {
  it('preserves native identity, receiver, misses, hits and puts without recording bodies/query strings', async () => {
    const response = new Response('public synthetic bytes');
    class FakeCache {
      match = vi.fn<Cache['match']>(async () => undefined);
      put = vi.fn<Cache['put']>(async () => {});
    }
    const cache = new FakeCache(); const report = vi.fn(); const traced = traceModelCache(cache, report);
    expect(traced).toBeInstanceOf(FakeCache);
    const key = 'https://huggingface.co/public/config.json?synthetic=never-log';
    expect(await traced.match(key)).toBeUndefined();
    cache.match.mockResolvedValueOnce(response);
    expect(await traced.match(key)).toBe(response);
    await traced.put(key, response);
    expect(cache.match.mock.contexts.every(context => context === cache)).toBe(true);
    expect(cache.put.mock.contexts[0]).toBe(cache);
    expect(cache.put).toHaveBeenCalledExactlyOnceWith(key, response);
    expect(report.mock.calls.map(([event]) => event.outcome)).toEqual(['miss', 'hit', 'stored']);
    expect(report.mock.calls[0][0]).toMatchObject({ origin: 'https://huggingface.co', path: '/public/config.json' });
    expect(JSON.stringify(report.mock.calls)).not.toContain('never-log');
    expect(JSON.stringify(report.mock.calls)).not.toContain('public synthetic bytes');
  });
  it('preserves cache access/quota failures for the owning runtime to classify', async () => {
    const quota = new DOMException('synthetic quota', 'QuotaExceededError');
    const denied = new DOMException('synthetic access', 'SecurityError');
    const cache = { match: vi.fn<Cache['match']>(async () => { throw denied; }), put: vi.fn<Cache['put']>(async () => { throw quota; }) };
    const report = vi.fn(); const traced = traceModelCache(cache, report);
    await expect(traced.match('https://huggingface.co/public/config.json')).rejects.toBe(denied);
    await expect(traced.put('https://huggingface.co/public/config.json', new Response('x'))).rejects.toBe(quota);
    expect(report.mock.calls.map(([event]) => event.errorName)).toEqual(['SecurityError', 'QuotaExceededError']);
  });
});
