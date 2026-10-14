import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ getIdToken: vi.fn(), authenticated: true }));
vi.mock('../lib/aiConfig', () => ({ getCloudflareAiProxyUrl: () => 'https://proxy.example/chat/completions' }));
vi.mock('../lib/firebaseClient', () => ({ getFirebaseAuth: () => ({
  currentUser: platform.authenticated ? { getIdToken: platform.getIdToken } : null,
}) }));

import { getAdminObservabilityUsers, getAdminObservabilityUsersPage } from './adminObservabilityService';

const fetchMock = vi.fn();
const trend = {
  daily: [{ localDate: '2026-10-01', activeActorCount: 7 }],
  activeUsers: null,
};
const user = {
  profileSubjectId: 'profile-example', actorSubjectId: 'actor-example',
  registeredAt: '2026-10-01T00:00:00.000Z', firstActivityAt: null, lastActivityAt: null,
  eventCount: 0, productActivityCount: 0, aiRequestCount: 0, planningOutcomeCount: 0,
};

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function page(shape: 'current' | 'legacy' | 'page-only', nextCursor: string | null = 'next-page') {
  return { ok: true, users: [user], nextCursor,
    ...(shape === 'legacy' ? {} : { enrichmentReady: true }),
    ...(shape === 'current' ? { trend } : {}) };
}

function routeResponses(shape: 'current' | 'legacy' | 'page-only') {
  fetchMock.mockImplementation(async (value: string) => {
    const url = new URL(value);
    if (url.pathname.endsWith('/overview')) return response({ ok: true, result: trend });
    return response(page(shape === 'page-only' && url.searchParams.get('includeTrend') !== 'false'
      ? 'current' : shape));
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  platform.authenticated = true;
  platform.getIdToken.mockReset().mockResolvedValue('synthetic-admin-token');
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe.each(['current', 'legacy', 'page-only'] as const)('%s Worker Users response', shape => {
  it('keeps the initial trend and fetches only Users for the next page', async () => {
    routeResponses(shape);
    const initial = await getAdminObservabilityUsers({ environment: 'preview', limit: 25 });
    const initialRequestCount = fetchMock.mock.calls.length;
    const next = await getAdminObservabilityUsersPage({ environment: 'preview', cursor: initial.nextCursor, limit: 25 });

    expect(initial.trend).toEqual(trend);
    expect(next.users).toEqual(initial.users);
    expect(next.nextCursor).toBe('next-page');
    expect(next.enrichmentReady).toBe(shape !== 'legacy');
    expect(next).not.toHaveProperty('trend');
    expect(next.users[0]).toMatchObject({ activeDayCount: null, recentErrorState: 'unknown' });
    expect(initialRequestCount).toBe(shape === 'legacy' ? 2 : 1);
    expect(fetchMock.mock.calls.length - initialRequestCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(shape === 'legacy' ? 3 : 2);
    expect(platform.getIdToken).toHaveBeenCalledTimes(fetchMock.mock.calls.length);

    const [url, options] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    expect(new URL(url).pathname).toBe('/observability/admin/users');
    expect(new URL(url).searchParams.get('environment')).toBe('preview');
    expect(new URL(url).searchParams.get('cursor')).toBe('next-page');
    expect(new URL(url).searchParams.get('limit')).toBe('25');
    expect(new URL(url).searchParams.get('includeTrend')).toBe('false');
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.has('includeTrend')).toBe(false);
    expect(options).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer synthetic-admin-token' } });

    if (shape === 'legacy') {
      const overview = new URL(fetchMock.mock.calls[1][0]);
      expect(overview.pathname).toBe('/observability/admin/overview');
      expect(overview.searchParams.get('environment')).toBe('preview');
      expect((Date.parse(overview.searchParams.get('to')!) - Date.parse(overview.searchParams.get('from')!)) / 86_400_000).toBe(29);
    }
  });

  it('refreshes the initial trend without opting out or reusing a cached value', async () => {
    routeResponses(shape);
    expect((await getAdminObservabilityUsers()).trend).toEqual(trend);
    const updatedTrend = { daily: [], activeUsers: null };
    fetchMock.mockImplementation(async (url: string) => new URL(url).pathname.endsWith('/overview')
      ? response({ ok: true, result: updatedTrend })
      : response(shape === 'legacy' ? page('legacy') : { ...page('current'), trend: updatedTrend }));
    expect((await getAdminObservabilityUsers()).trend).toEqual(updatedTrend);
    expect(fetchMock.mock.calls.every(([url]) => !new URL(url).searchParams.has('includeTrend'))).toBe(true);
  });

  it('keeps a terminal cursor and does not cache a page across requests', async () => {
    fetchMock.mockResolvedValueOnce(response(page(shape, null)))
      .mockResolvedValueOnce(response({ ...page(shape, null), users: [] }));
    expect((await getAdminObservabilityUsersPage()).nextCursor).toBeNull();
    expect((await getAdminObservabilityUsersPage()).users).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(platform.getIdToken).toHaveBeenCalledTimes(2);
  });
});

describe.each([
  ['initial', getAdminObservabilityUsers],
  ['page', getAdminObservabilityUsersPage],
] as const)('%s Users request safety', (_scope, load) => {
  it.each([
    { daily: [null], activeUsers: null },
    { daily: [], activeUsers: {} },
    { daily: [{ localDate: '2026-10-01', activeActorCount: '7' }], activeUsers: null },
  ])('rejects a malformed current trend without fallback: %j', async invalidTrend => {
    fetchMock.mockResolvedValueOnce(response({ ...page('current'), trend: invalidTrend }));
    await expect(load()).rejects.toThrow('Observability Users response was invalid.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed current readiness without fallback', async () => {
    fetchMock.mockResolvedValueOnce(response({ ...page('current'), enrichmentReady: 'yes' }));
    await expect(load()).rejects.toThrow('Observability Users response was invalid.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('requires an authenticated user before sending a request', async () => {
    platform.authenticated = false;
    await expect(load()).rejects.toThrow('Admin authentication is required.');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(platform.getIdToken).not.toHaveBeenCalled();
  });

  it('does not send a request or fallback after token failure', async () => {
    platform.getIdToken.mockRejectedValueOnce(new Error('token unavailable'));
    await expect(load()).rejects.toThrow('token unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 403, 500, 503])('propagates HTTP %i without fallback', async status => {
    fetchMock.mockResolvedValueOnce(response({ error: 'users unavailable' }, status));
    await expect(load()).rejects.toThrow('users unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('propagates transport and JSON failures without fallback', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(load()).rejects.toThrow('offline');
    fetchMock.mockResolvedValueOnce(new Response('{invalid', { status: 200 }));
    await expect(load()).rejects.toBeInstanceOf(SyntaxError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

it.each(['trend', 'enrichmentReady'] as const)('preserves initial legacy fallback when %s is missing', async missing => {
  const payload: Record<string, unknown> = page('current');
  delete payload[missing];
  fetchMock.mockResolvedValueOnce(response(payload))
    .mockResolvedValueOnce(response({ ok: true, result: trend }))
    .mockResolvedValueOnce(response(payload));
  expect((await getAdminObservabilityUsers()).trend).toEqual(trend);
  const next = await getAdminObservabilityUsersPage({ cursor: 'next-page' });
  expect(next.enrichmentReady).toBe(missing === 'trend');
  expect(next).not.toHaveProperty('trend');
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('does not hide initial legacy Overview failure', async () => {
  fetchMock.mockResolvedValueOnce(response(page('legacy')))
    .mockResolvedValueOnce(response({ error: 'overview unavailable' }, 503));
  await expect(getAdminObservabilityUsers()).rejects.toThrow('overview unavailable');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('rejects malformed readiness in a trend-free page response', async () => {
  fetchMock.mockResolvedValueOnce(response({ ...page('page-only'), enrichmentReady: 'yes' }));
  await expect(getAdminObservabilityUsersPage()).rejects.toThrow('Observability Users response was invalid.');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
