import { describe, expect, it, vi } from 'vitest';
import { queryHyMemoryCandidateIds } from './hyMemoryCandidateService';

const env = {
  HY_MEMORY_CANDIDATE_MODE: 'shadow',
  HY_MEMORY_BRIDGE_BASE_URL: 'https://memory-bridge.example.test',
  HY_MEMORY_BRIDGE_TOKEN: 'a'.repeat(40),
};

describe('Hy Memory private transport', () => {
  it('stays dormant without explicit shadow mode or HTTPS service configuration', async () => {
    const fetcher = vi.fn();
    for (const configuration of [
      {},
      { ...env, HY_MEMORY_CANDIDATE_MODE: 'off' },
      { ...env, HY_MEMORY_BRIDGE_BASE_URL: 'http://memory-bridge.example.test' },
      { ...env, HY_MEMORY_BRIDGE_TOKEN: 'too-short' },
    ]) {
      expect(await queryHyMemoryCandidateIds({
        env: configuration, ownerId: 'owner-a', sourceRevision: 3,
        query: '数学はいつ勉強したい？', fetcher,
      })).toEqual({ status: 'unavailable' });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('forwards only exact source scope and hides credentials from the result', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer ' + env.HY_MEMORY_BRIDGE_TOKEN });
      expect(JSON.parse(String(init?.body))).toEqual({
        ownerId: 'owner-a',
        sourceRevision: 5,
        query: '数学',
      });
      return new Response(JSON.stringify({
        status: 'ready', ownerId: 'owner-a', sourceRevision: 5, recordIds: ['r1', 'r2'],
      }), { status: 200 });
    });
    const result = await queryHyMemoryCandidateIds({
      env, ownerId: 'owner-a', sourceRevision: 5, query: '数学', fetcher: fetcher as typeof fetch,
    });
    expect(result).toEqual({ status: 'ready', ownerId: 'owner-a', sourceRevision: 5, recordIds: ['r1', 'r2'] });
    expect(fetcher).toHaveBeenCalledWith('https://memory-bridge.example.test/v1/search', expect.any(Object));
  });

  it('drops wrong-user, stale, malformed and upstream error results', async () => {
    const base = { env, ownerId: 'owner-a', sourceRevision: 5, query: '数学' };
    for (const result of [
      { status: 'ready', ownerId: 'owner-b', sourceRevision: 5, recordIds: ['r1'] },
      { status: 'ready', ownerId: 'owner-a', sourceRevision: 4, recordIds: ['r1'] },
      { status: 'ready', ownerId: 'owner-a', sourceRevision: 5, recordIds: ['r1', 'r1'] },
      { status: 'ready', ownerId: 'owner-a', sourceRevision: 5, recordIds: Array(11).fill('r') },
    ]) {
      const fetcher = vi.fn(async () => new Response(JSON.stringify(result)));
      expect(await queryHyMemoryCandidateIds({ ...base, fetcher: fetcher as typeof fetch }))
        .toEqual({ status: 'unavailable' });
    }
    const fetcher = vi.fn(async () => new Response('failure', { status: 503 }));
    expect(await queryHyMemoryCandidateIds({ ...base, fetcher: fetcher as typeof fetch }))
      .toEqual({ status: 'unavailable' });
  });

  it('returns a distinct successful no-match', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      status: 'ready', ownerId: 'owner-a', sourceRevision: 1, recordIds: [],
    })));
    expect(await queryHyMemoryCandidateIds({
      env, ownerId: 'owner-a', sourceRevision: 1, query: 'unknown',
      fetcher: fetcher as typeof fetch,
    })).toEqual({ status: 'ready', ownerId: 'owner-a', sourceRevision: 1, recordIds: [] });
  });
});
