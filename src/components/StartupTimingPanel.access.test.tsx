import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StartupTimingPanel } from './StartupTimingPanel';
import { AppSettingsSupportPanel } from './AppSettingsSupportPanel';
import type { AuthSessionUser } from '../services/authSession';

const boundary = vi.hoisted(() => ({ enabled: true, available: true, rows: [],
  auth: vi.fn(), admin: vi.fn(), unsubscribeAuth: vi.fn(), unsubscribes: [] as ReturnType<typeof vi.fn>[],
  userChanged: null as null | ((user: AuthSessionUser | null) => void),
  admins: new Map<string, (allowed: boolean) => void>(),
}));
vi.mock('../lib/startupTiming', () => ({ startupTiming: {
  get enabled() { return boundary.enabled; }, subscribe: () => () => {}, getSnapshot: () => boundary.rows, markOnce() {},
} }));
vi.mock('../services/authSession', () => ({ createAuthSessionService: () => ({
  get available() { return boundary.available; },
  subscribe: (listener: (user: AuthSessionUser | null) => void) => {
    boundary.auth(); boundary.userChanged = listener; return boundary.unsubscribeAuth;
  },
}) }));
vi.mock('../services/adminService', () => ({ subscribeAdminStatus: (uid: string, callback: (allowed: boolean) => void) => {
  boundary.admin(uid); boundary.admins.set(uid, callback);
  const stop = vi.fn(); boundary.unsubscribes.push(stop); return stop;
} }));
let renderer: ReactTestRenderer | undefined;
const user = (id: string, requiresEmailVerification = false) => ({ id, requiresEmailVerification });
const details = () => renderer!.root.findAllByType('details');
beforeEach(() => {
  vi.stubEnv('DEV', false);
  boundary.enabled = true; boundary.available = true;
  boundary.auth.mockClear(); boundary.admin.mockClear(); boundary.unsubscribeAuth.mockClear();
  boundary.admins.clear(); boundary.unsubscribes = [];
  vi.stubGlobal('document', { body: {}, querySelector: () => null });
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('removes start/stop diagnostics from ordinary Support independently of query opt-in', () => {
  act(() => { renderer = create(<AppSettingsSupportPanel />); });
  const output = JSON.stringify(renderer!.toJSON());
  expect(output).not.toMatch(/起動時間の診断|計測.*再読み込み/);
  expect(output).toContain('お問い合わせ');
  expect(boundary.auth).not.toHaveBeenCalled(); expect(boundary.admin).not.toHaveBeenCalled();
});
it('does not check identity or render controls without opt-in', () => {
  boundary.enabled = false;
  act(() => { renderer = create(<StartupTimingPanel />); });
  expect(renderer!.toJSON()).toBeNull();
  expect(boundary.auth).not.toHaveBeenCalled(); expect(boundary.admin).not.toHaveBeenCalled();
});
it('keeps query-enabled production diagnostics hidden for unresolved, signed-out, unverified and ordinary users', () => {
  act(() => { renderer = create(<StartupTimingPanel />); });
  expect(details()).toHaveLength(0);
  act(() => boundary.userChanged!(null)); expect(details()).toHaveLength(0);
  act(() => boundary.userChanged!(user('unverified', true))); expect(details()).toHaveLength(0);
  expect(boundary.admin).not.toHaveBeenCalled();
  act(() => boundary.userChanged!(user('ordinary'))); expect(details()).toHaveLength(0);
  act(() => boundary.admins.get('ordinary')!(false)); expect(details()).toHaveLength(0);
});
it('uses the existing administrator verdict and drops it before another owner is checked', () => {
  act(() => { renderer = create(<StartupTimingPanel />); });
  act(() => boundary.userChanged!(user('admin')));
  act(() => boundary.admins.get('admin')!(true)); expect(details()).toHaveLength(1);
  act(() => boundary.userChanged!(user('ordinary'))); expect(details()).toHaveLength(0);
  expect(boundary.unsubscribes[0]).toHaveBeenCalledOnce();
  // Even a late prior-owner listener cannot grant the current owner's panel.
  act(() => boundary.admins.get('admin')!(true)); expect(details()).toHaveLength(0);
  act(() => boundary.admins.get('ordinary')!(true)); expect(details()).toHaveLength(1);
  act(() => boundary.admins.get('ordinary')!(false)); expect(details()).toHaveLength(0);
  act(() => boundary.userChanged!(null)); expect(details()).toHaveLength(0);
  act(() => renderer!.unmount()); renderer = undefined;
  expect(boundary.unsubscribeAuth).toHaveBeenCalledOnce();
});
it('retains explicit local development diagnostics without production admin requests', () => {
  vi.stubEnv('DEV', true);
  act(() => { renderer = create(<StartupTimingPanel />); });
  expect(details()).toHaveLength(1);
  expect(boundary.auth).not.toHaveBeenCalled(); expect(boundary.admin).not.toHaveBeenCalled();
});
it('has no production diagnostics for a local-only auth service', () => {
  boundary.available = false;
  act(() => { renderer = create(<StartupTimingPanel />); });
  expect(details()).toHaveLength(0); expect(boundary.auth).not.toHaveBeenCalled();
});
