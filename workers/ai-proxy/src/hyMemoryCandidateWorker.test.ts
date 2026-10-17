import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './worker';

const uid = 'firebase-owner-1';
const bridgeSecret = 's'.repeat(40);

function env(overrides: Record<string, unknown> = {}) {
  return {
    FIREBASE_WEB_API_KEY: 'fixture-web-key',
    OPENAI_API_KEY: 'unused',
    ALLOWED_ORIGIN: 'https://app.fixture',
    HY_MEMORY_CANDIDATE_MODE: 'shadow',
    HY_MEMORY_BRIDGE_BASE_URL: 'https://bridge.fixture',
    HY_MEMORY_BRIDGE_TOKEN: bridgeSecret,
    AI_QUOTA: {
      getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 1 }) }),
    },
    ...overrides,
  };
}

function request(body = { query: '数学', sourceRevision: 5 }, bearer = 'owner-id-token') {
  return new Request('https://proxy.fixture/user-context/hy-memory/search', {
    method: 'POST',
    headers: {
      Origin: 'https://app.fixture', 'Content-Type': 'application/json',
      ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}),
    },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Worker Hy Memory candidate route', () => {
  it('requires Firebase authentication and never calls the bridge anonymously', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const response = await worker.fetch(request(undefined, ''), env() as never);
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses verified Firebase identity rather than a client-supplied owner', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('identitytoolkit.googleapis.com')) {
        return Response.json({ users: [{ localId: uid, emailVerified: true }] });
      }
      expect(url).toBe('https://bridge.fixture/v1/search');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer ' + bridgeSecret);
      expect(JSON.parse(String(init?.body))).toEqual({
        ownerId: uid, sourceRevision: 5, query: '数学',
      });
      return Response.json({
        status: 'ready', ownerId: uid, sourceRevision: 5, recordIds: ['canonical-id'],
      });
    });
    vi.stubGlobal('fetch', fetcher);
    const response = await worker.fetch(request(), env() as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ready', ownerId: uid, sourceRevision: 5, recordIds: ['canonical-id'],
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps disabled configuration private and emits unavailable', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ users: [{ localId: uid, emailVerified: true }] }));
    vi.stubGlobal('fetch', fetcher);
    const response = await worker.fetch(request(), env({ HY_MEMORY_CANDIDATE_MODE: 'off' }) as never);
    expect(await response.json()).toEqual({ status: 'unavailable' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
