import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthSessionService } from '../services/authSession';
import { subscribeAdminStatus } from '../services/adminService';
import { createFakeAuthSession } from '../test/fakeAuthSession';
import { AdminApp } from './AdminApp';
import { AdminRoutes } from './AdminViews';

vi.mock('../services/authSession', () => ({ createAuthSessionService: vi.fn() }));
vi.mock('../services/adminService', () => ({ subscribeAdminStatus: vi.fn() }));
vi.mock('./AdminViews', () => ({ AdminRoutes: () => null }));

const user = { id: 'admin-user', requiresEmailVerification: false };
let renderer: ReactTestRenderer;
let fake: ReturnType<typeof createFakeAuthSession>;
let emitAdmin: (allowed: boolean) => void;
const unsubscribeAdmin = vi.fn();

function mount() {
  act(() => { renderer = create(<AdminApp authSession={fake.session} />); });
}

function hasText(text: string) {
  return JSON.stringify(renderer.toJSON()).includes(text);
}

describe('AdminApp auth session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('window', {
      location: { pathname: '/admin' },
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    });
    fake = createFakeAuthSession();
    vi.mocked(createAuthSessionService).mockReturnValue(fake.session);
    vi.mocked(subscribeAdminStatus).mockImplementation((_, listener) => {
      emitAdmin = listener;
      return unsubscribeAdmin;
    });
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    vi.unstubAllGlobals();
  });

  it('waits for a session notification even when a current user is cached', () => {
    fake = createFakeAuthSession({ currentUser: user });
    mount();
    expect(hasText('認証状態を確認しています')).toBe(true);
    expect(subscribeAdminStatus).not.toHaveBeenCalled();
    act(() => fake.emit(null));
    expect(hasText('ログインが必要です')).toBe(true);
    expect(renderer.root.findAllByType(AdminRoutes)).toHaveLength(0);
    expect(createAuthSessionService).not.toHaveBeenCalled();
  });

  it('resolves unavailable authentication to the existing sign-in screen', () => {
    fake = createFakeAuthSession({ available: false });
    mount();
    expect(hasText('ログインが必要です')).toBe(true);
    expect(fake.session.subscribe).not.toHaveBeenCalled();
  });

  it('uses the Laplance initial and product name in the admin brand', () => {
    mount();
    act(() => fake.emit(user));
    act(() => emitAdmin(true));
    expect(hasText('Laplance')).toBe(true);
    expect(renderer.root.findByProps({ className: 'admin-console-brand-mark' }).children).toEqual(['L']);
  });

  it('preserves the independent admin access check and live access revocation', () => {
    mount();
    // Admin auth has never applied the planner email-verification gate.
    act(() => fake.emit({ ...user, requiresEmailVerification: true }));
    expect(subscribeAdminStatus).toHaveBeenCalledWith(user.id, expect.any(Function));
    expect(hasText('管理者権限を確認しています')).toBe(true);
    expect(renderer.root.findAllByType(AdminRoutes)).toHaveLength(0);
    act(() => emitAdmin(false));
    expect(hasText('アクセス権限がありません')).toBe(true);
    act(() => emitAdmin(true));
    expect(renderer.root.findAllByType(AdminRoutes)).toHaveLength(1);
    expect(renderer.root.findByType(AdminRoutes).props.path).toBe('/admin');
    act(() => emitAdmin(false));
    expect(renderer.root.findAllByType(AdminRoutes)).toHaveLength(0);
  });

  it('rechecks a changed user and releases admin access on sign-out', () => {
    mount();
    act(() => fake.emit(user));
    act(() => emitAdmin(true));
    act(() => fake.emit({ ...user, id: 'another-user' }));
    expect(unsubscribeAdmin).toHaveBeenCalledTimes(1);
    expect(subscribeAdminStatus).toHaveBeenLastCalledWith('another-user', expect.any(Function));
    expect(hasText('管理者権限を確認しています')).toBe(true);
    act(() => fake.emit(null));
    expect(unsubscribeAdmin).toHaveBeenCalledTimes(2);
    expect(hasText('ログインが必要です')).toBe(true);
  });

  it('releases both subscriptions on unmount', () => {
    mount();
    act(() => fake.emit(user));
    act(() => renderer.unmount());
    expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
    expect(unsubscribeAdmin).toHaveBeenCalledTimes(1);
  });

  it('creates the default service only once without injection', () => {
    act(() => { renderer = create(<AdminApp />); });
    act(() => fake.emit(null));
    act(() => renderer.update(<AdminApp />));
    expect(createAuthSessionService).toHaveBeenCalledTimes(1);
    expect(fake.session.subscribe).toHaveBeenCalledTimes(1);
  });
});
