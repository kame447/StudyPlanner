import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ getIdToken: vi.fn(), proxyUrl: vi.fn() }));
vi.mock('../lib/aiConfig', () => ({ getCloudflareAiProxyUrl: platform.proxyUrl }));
vi.mock('../lib/firebaseClient', () => ({
  getFirebaseAuth: () => ({ currentUser: { getIdToken: platform.getIdToken } }),
}));
import { AdminUsersPage } from './AdminUsersPage';
import { AdminGuard } from './AdminGuard';

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status, headers: { 'content-type': 'application/json' },
  });
}
function deferred(query: string) {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((yes) => { resolve = yes; });
  return { query, promise, resolve };
}
function match(id: string) {
  return { firebaseUid: `uid-${id}`, email: `${id}@example.test`, username: `name-${id}`, registeredAt: null, actorSubjectId: `actor-${id}` };
}
const requests: ReturnType<typeof deferred>[] = [];
const navigate = vi.fn();
const fetchMock = vi.fn();
let renderer: ReactTestRenderer | undefined;
async function show(status: 'allowed' | 'checking' | 'denied' = 'allowed') {
  await act(async () => {
    const view = <AdminGuard status={status}><AdminUsersPage navigate={navigate} /></AdminGuard>;
    if (renderer) renderer.update(view);
    else renderer = create(view);
  });
}
function input() { return renderer!.root.findByProps({ placeholder: 'email / UID / ユーザー名' }); }
function button() {
  return renderer!.root.findAllByType('button').find((node) => node.children.includes('照合') || node.children.includes('検索中…'))!;
}
async function query(value: string) { await act(async () => { input().props.onChange({ target: { value } }); }); }
async function enter() { await act(async () => { input().props.onKeyDown({ key: 'Enter' }); }); }
async function resolve(index: number, ids: string[]) {
  await act(async () => { requests[index].resolve(response({ ok: true, matches: ids.map(match) })); });
}
async function fail(index: number, message: string) {
  await act(async () => { requests[index].resolve(response({ error: message }, 503)); });
}
function names() {
  return renderer!.root.findAllByProps({ className: 'admin-identity-result' }).map((node) => node.findByType('strong').children.join(''));
}
function text() { return JSON.stringify(renderer!.toJSON()); }

beforeEach(() => {
  requests.length = 0;
  navigate.mockReset();
  platform.getIdToken.mockReset().mockResolvedValue('admin-token');
  platform.proxyUrl.mockReset().mockReturnValue('https://proxy.example/chat/completions');
  vi.stubGlobal('window', { location: { search: '', pathname: '/admin/users' }, history: { replaceState: vi.fn() } });
  fetchMock.mockReset().mockImplementation((value: string, init: RequestInit) => {
    expect(init.headers).toEqual({ Authorization: 'Bearer admin-token' });
    const url = new URL(value);
    if (url.pathname === '/observability/admin/users') {
      return Promise.resolve(response({ ok: true, users: [], nextCursor: null, enrichmentReady: true, trend: { daily: [], activeUsers: null } }));
    }
    expect(url.pathname).toBe('/observability/admin/user-identity');
    const request = deferred(url.searchParams.get('q')!);
    requests.push(request);
    return request.promise;
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe('Admin exact-profile search ownership', () => {
  it('labels verified email and explains that the display name is self-reported', async () => {
    await show();
    await query('A@example.test'); await enter(); await resolve(0, ['A']);
    expect(text()).toContain('確認済みメール: A@example.test');
    expect(text()).toContain('ユーザー名は自己申告の表示名です。');
  });

  it('shows an explicit missing-verified-email state while preserving UID and actor navigation', async () => {
    await show();
    await query('uid-A'); await enter();
    await act(async () => { requests[0].resolve(response({ ok: true, matches: [{ ...match('A'), email: '' }] })); });
    expect(text()).toContain('確認済みメールなし');
    expect(text()).toContain('uid-A');
    await act(async () => {
      renderer!.root.findByProps({ className: 'admin-identity-result' }).findByType('button').props.onClick();
    });
    expect(navigate).toHaveBeenCalledWith('/admin/users/actor-A');
  });

  it.each(['A@example.test', 'Uid-CaseSensitive', 'ユーザー名'])('preserves the exact lookup identity for %s and opens its actor history', async (value) => {
    await show();
    await query(`  ${value}  `);
    await enter();
    expect(requests.map((request) => request.query)).toEqual([value]);
    await resolve(0, ['A']);
    expect(names()).toEqual(['name-A']);
    await act(async () => {
      renderer!.root.findByProps({ className: 'admin-identity-result' }).findByType('button').props.onClick();
    });
    expect(navigate).toHaveBeenCalledWith('/admin/users/actor-A');
  });

  it('sends one request for same-tick repeated Enter and click', async () => {
    await show();
    await query('A');
    const key = input().props.onKeyDown;
    const click = button().props.onClick;
    await act(async () => { key({ key: 'Enter' }); key({ key: 'Enter' }); click(); });
    expect(requests).toHaveLength(1);
    await resolve(0, ['A']);
    expect(names()).toEqual(['name-A']);
  });

  it.each(['success', 'failure'] as const)('ignores an old %s after a newer lookup succeeds', async (outcome) => {
    await show();
    await query('A'); await enter();
    await query('B'); await enter();
    expect(requests.map((request) => request.query)).toEqual(['A', 'B']);
    await resolve(1, ['B']);
    if (outcome === 'success') await resolve(0, ['A']);
    else await fail(0, 'old A failed');
    expect(names()).toEqual(['name-B']);
    expect(text()).not.toContain('old A failed');
    expect(button().props.disabled).toBe(false);
  });

  it.each(['success', 'failure'] as const)('keeps newer loading ownership after an old %s', async (outcome) => {
    await show();
    await query('A'); await enter();
    await query('B'); await enter();
    if (outcome === 'success') await resolve(0, ['A']);
    else await fail(0, 'old A failed');
    expect(names()).toEqual([]);
    expect(text()).not.toContain('old A failed');
    expect(button().props.disabled).toBe(true);
    await enter();
    expect(requests).toHaveLength(2);
    await resolve(1, ['B']);
    expect(names()).toEqual(['name-B']);
  });

  it('removes old results when edited and enables the new lookup before the old one completes', async () => {
    await show();
    await query('A'); await enter(); await resolve(0, ['A']);
    await query('B');
    expect(names()).toEqual([]);
    await enter();
    await query('C');
    expect(button().props.disabled).toBe(false);
    await resolve(1, ['B']);
    expect(names()).toEqual([]);
    expect(button().props.disabled).toBe(false);
  });

  it('clearing a pending query invalidates its result and does not submit an empty query', async () => {
    await show();
    await query('A'); await enter();
    await query('  '); await enter();
    await resolve(0, ['A']);
    expect(names()).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(text()).not.toContain('一致するプロフィールはありません。');
    expect(button().props.disabled).toBe(false);
  });

  it('takes a same-tick edited identity instead of the previous render value', async () => {
    await show();
    await query('A');
    const field = input();
    await act(async () => { field.props.onChange({ target: { value: 'B' } }); field.props.onKeyDown({ key: 'Enter' }); });
    expect(requests.map((request) => request.query)).toEqual(['B']);
  });

  it('can retry current failure and explicitly refresh the same query after completion', async () => {
    await show();
    await query('A'); await enter(); await fail(0, 'current failed');
    expect(text()).toContain('current failed');
    expect(button().props.disabled).toBe(false);
    await enter(); await resolve(1, []);
    expect(text()).not.toContain('current failed');
    expect(text()).toContain('一致するプロフィールはありません。');
    await enter(); await resolve(2, ['A']);
    expect(names()).toEqual(['name-A']);
  });

  it('does not resurrect old A results after A → B → A without a new search', async () => {
    await show();
    await query('A'); await enter();
    await query('B'); await query('A');
    await resolve(0, ['A']);
    expect(names()).toEqual([]);
    await enter(); await resolve(1, ['A-new']);
    expect(names()).toEqual(['name-A-new']);
  });

  it('preserves normalized whitespace without changing a pending exact lookup', async () => {
    await show();
    await query('CaseSensitive'); await enter();
    await query('  CaseSensitive  '); await enter();
    expect(requests.map((request) => request.query)).toEqual(['CaseSensitive']);
    await resolve(0, ['same']);
    expect(names()).toEqual(['name-same']);
  });

  it('invalidates a changed lookup kind or letter case without normalizing identity', async () => {
    await show();
    await query('Uid-CaseSensitive'); await enter();
    await query('uid-casesensitive'); await enter();
    await query('mail@example.test'); await enter();
    expect(requests.map((request) => request.query)).toEqual(['Uid-CaseSensitive', 'uid-casesensitive', 'mail@example.test']);
    await resolve(2, ['mail']);
    await resolve(0, ['original-uid']);
    await fail(1, 'old lowercase UID failure');
    expect(names()).toEqual(['name-mail']);
    expect(text()).not.toContain('old lowercase UID failure');
  });

  it('does not send a request from a callback retained past unmount', async () => {
    await show();
    await query('A');
    const submit = input().props.onKeyDown;
    await act(async () => { renderer!.unmount(); });
    await act(async () => { submit({ key: 'Enter' }); });
    expect(requests).toHaveLength(0);
  });

  it.each(['checking', 'denied'] as const)('ignores an old response after auth becomes %s and a fresh view opens', async (status) => {
    await show();
    await query('A'); await enter();
    await show(status); await show();
    await query('B'); await enter();
    await resolve(0, ['A']);
    expect(names()).toEqual([]);
    expect(button().props.disabled).toBe(true);
    await resolve(1, ['B']);
    expect(names()).toEqual(['name-B']);
  });
});
