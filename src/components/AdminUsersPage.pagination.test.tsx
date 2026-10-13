import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ getIdToken: vi.fn() }));
vi.mock('../lib/aiConfig', () => ({ getCloudflareAiProxyUrl: () => 'https://proxy.example/chat/completions' }));
vi.mock('../lib/firebaseClient', () => ({
  getFirebaseAuth: () => ({ currentUser: { getIdToken: platform.getIdToken } }),
}));

import * as service from '../services/adminObservabilityService';
import { AdminUsersPage } from './AdminUsersPage';

const initialTrend = { daily: [{ localDate: '2026-10-01', activeActorCount: 7 }], activeUsers: null };
const laterTrend = { daily: [{ localDate: '2026-10-02', activeActorCount: 99 }], activeUsers: null };
const fetchMock = vi.fn();
const replaceState = vi.fn();
let renderer: ReactTestRenderer | undefined;

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}
function user(id: string) {
  return {
    profileSubjectId: `profile-${id}`, actorSubjectId: `actor-${id}`,
    registeredAt: null, firstActivityAt: null, lastActivityAt: null,
    eventCount: 0, productActivityCount: 0, aiRequestCount: 0, planningOutcomeCount: 0,
  };
}
function page(shape: 'current' | 'legacy', id: string, nextCursor: string | null) {
  return {
    ok: true, users: [user(id)], nextCursor,
    ...(shape === 'current' ? { enrichmentReady: true, trend: id === 'first' ? initialTrend : laterTrend } : {}),
  };
}
function deferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
async function show() {
  await act(async () => { renderer = create(<AdminUsersPage navigate={vi.fn()} />); });
}
function loadMore() {
  return renderer!.root.findAllByType('button').find((node) =>
    node.children.includes('次の25件を読み込む') || node.children.includes('読み込み中…'));
}
function visibleActors() {
  return renderer!.root.findAllByProps({ className: 'admin-user-card panel' })
    .map((node) => node.findByType('code').children.join(''));
}
function trendTitles() {
  return renderer!.root.findByProps({ className: 'admin-users-trend-bars' })
    .findAllByType('span').map((node) => node.props.title);
}
function paths() { return fetchMock.mock.calls.map(([url]) => new URL(url).pathname); }

beforeEach(() => {
  fetchMock.mockReset();
  replaceState.mockReset();
  platform.getIdToken.mockReset().mockResolvedValue('synthetic-admin-token');
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('window', {
    location: { search: '', pathname: '/admin/users' }, history: { replaceState },
  });
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each(['legacy', 'current'] as const)('Users pagination with %s Worker', (shape) => {
  it('uses the page API, appends users, and preserves the initial trend and identity query', async () => {
    const initial = vi.spyOn(service, 'getAdminObservabilityUsers');
    const append = vi.spyOn(service, 'getAdminObservabilityUsersPage');
    const next = deferredResponse();
    fetchMock.mockImplementation((value: string) => {
      const url = new URL(value);
      if (url.pathname.endsWith('/overview')) return Promise.resolve(response({ ok: true, result: initialTrend }));
      expect(url.pathname).toBe('/observability/admin/users');
      return url.searchParams.has('cursor') ? next.promise : Promise.resolve(response(page(shape, 'first', 'cursor-2')));
    });
    await show();
    expect(initial).toHaveBeenCalledOnce();
    expect(initial).toHaveBeenCalledWith({ environment: 'production', limit: 25 });
    expect(visibleActors()).toEqual(['actor-first']);
    const titles = trendTitles();
    expect(titles).toEqual(['10/1: 7人']);
    expect(paths()).toEqual(shape === 'legacy'
      ? ['/observability/admin/users', '/observability/admin/overview']
      : ['/observability/admin/users']);

    const field = renderer!.root.findByProps({ placeholder: 'email / UID / ユーザー名' });
    await act(async () => { field.props.onChange({ target: { value: 'private@example.test' } }); });
    let pending!: Promise<void>;
    await act(async () => { pending = loadMore()!.props.onClick(); });
    expect(loadMore()!.props.disabled).toBe(true);
    expect(append).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledWith({ environment: 'production', cursor: 'cursor-2', limit: 25 });
    await act(async () => { next.resolve(response(page(shape, 'second', null))); await pending; });

    expect(initial).toHaveBeenCalledOnce();
    expect(visibleActors()).toEqual(['actor-first', 'actor-second']);
    expect(trendTitles()).toEqual(titles);
    expect(loadMore()).toBeUndefined();
    expect(paths().filter((path) => path.endsWith('/users'))).toHaveLength(2);
    expect(paths().filter((path) => path.endsWith('/overview'))).toHaveLength(shape === 'legacy' ? 1 : 0);
    expect(field.props.value).toBe('private@example.test');
    expect(replaceState.mock.calls.map((call) => call[2])).toEqual(['/admin/users']);
    expect(platform.getIdToken).toHaveBeenCalledTimes(fetchMock.mock.calls.length);
    for (const [url, options] of fetchMock.mock.calls) {
      expect(options).toEqual({ method: 'GET', headers: { Authorization: 'Bearer synthetic-admin-token' } });
      expect(new URL(url).searchParams.get('environment')).toBe('production');
      expect(url).not.toContain('private');
    }
  });

  it('retains the users, trend and cursor after page failure and retries without another Overview', async () => {
    const cursors: string[] = [];
    fetchMock.mockImplementation((value: string) => {
      const url = new URL(value);
      if (url.pathname.endsWith('/overview')) return Promise.resolve(response({ ok: true, result: initialTrend }));
      const cursor = url.searchParams.get('cursor');
      if (!cursor) return Promise.resolve(response(page(shape, 'first', 'cursor-2')));
      cursors.push(cursor);
      return Promise.resolve(cursors.length === 1
        ? response({ error: 'page unavailable' }, 503)
        : response(page(shape, 'second', null)));
    });
    await show();
    const titles = trendTitles();
    await act(async () => { await loadMore()!.props.onClick(); });
    expect(visibleActors()).toEqual(['actor-first']);
    expect(trendTitles()).toEqual(titles);
    expect(renderer!.root.findByProps({ role: 'alert' }).children).toEqual(['page unavailable']);
    expect(loadMore()!.props.disabled).toBe(false);
    await act(async () => { await loadMore()!.props.onClick(); });
    expect(cursors).toEqual(['cursor-2', 'cursor-2']);
    expect(visibleActors()).toEqual(['actor-first', 'actor-second']);
    expect(trendTitles()).toEqual(titles);
    expect(renderer!.root.findAllByProps({ role: 'alert' })).toEqual([]);
    expect(loadMore()).toBeUndefined();
    expect(paths().filter((path) => path.endsWith('/users'))).toHaveLength(3);
    expect(paths().filter((path) => path.endsWith('/overview'))).toHaveLength(shape === 'legacy' ? 1 : 0);
  });
});
