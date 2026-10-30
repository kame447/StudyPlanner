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
vi.mock('../hooks/useDialogFocus', () => ({ useDialogFocus: () => ({ dialogRef: { current: null } }) }));

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

  it('keeps the return action available while auth or access is pending, denied or signed out', () => {
    const onReturn = vi.fn(); const preventDefault = vi.fn();
    act(() => { renderer = create(<AdminApp authSession={fake.session} onReturnToApp={onReturn} />); });
    const clickReturn = () => renderer.root.findByProps({ className: 'admin-console-return-link' }).props.onClick({ button: 0, preventDefault });
    act(clickReturn); expect(onReturn).toHaveBeenCalledTimes(1);
    act(() => fake.emit(user)); act(() => emitAdmin(false));
    expect(hasText('アクセス権限がありません')).toBe(true); act(clickReturn);
    act(() => fake.emit(null)); act(clickReturn);
    expect(onReturn).toHaveBeenCalledTimes(3); expect(preventDefault).toHaveBeenCalledTimes(3);
    expect(fake.session.signOut).not.toHaveBeenCalled();
    act(() => renderer.root.findByProps({ className: 'admin-console-return-link' }).props.onClick({ button: 0, ctrlKey: true, preventDefault }));
    expect(onReturn).toHaveBeenCalledTimes(3);
  });
});


describe('AdminApp mobile navigation', () => {
  let changeViewport: () => void;
  let query: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    vi.clearAllMocks();
    query = { matches: true, addEventListener: vi.fn((_, listener) => { changeViewport = listener; }), removeEventListener: vi.fn() };
    vi.stubGlobal('window', { location: { pathname: '/admin' }, innerWidth: 390,
      matchMedia: () => query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      history: { pushState: vi.fn(), replaceState: vi.fn() } });
    vi.stubGlobal('document', { body: { style: { overflow: '' } } });
    fake = createFakeAuthSession();
    vi.mocked(subscribeAdminStatus).mockImplementation((_, listener) => { emitAdmin = listener; return unsubscribeAdmin; });
    mount(); act(() => fake.emit(user)); act(() => emitAdmin(true));
  });
  afterEach(() => { act(() => renderer.unmount()); vi.unstubAllGlobals(); });
  it('reuses one navigation, opens a modal drawer, closes on navigation and releases scrolling', () => {
    expect(renderer.root.findAllByType('nav')).toHaveLength(1);
    expect(renderer.root.findAllByType('select')).toHaveLength(0);
    act(() => renderer.root.findByProps({ 'aria-label': '管理メニューを開く' }).props.onClick());
    expect(renderer.root.findByType('aside').props.role).toBe('dialog');
    expect(document.body.style.overflow).toBe('hidden');
    expect(renderer.root.findByProps({ className: 'admin-console-main' }).props.inert).toBe('');
    const users = renderer.root.findAllByType('button').find(button => button.findAllByType('span').some(span => span.children.includes('Users')))!;
    act(() => users.props.onClick());
    expect(window.history.pushState).toHaveBeenCalledWith({}, '', '/admin/users');
    expect(renderer.root.findByType(AdminRoutes).props.path).toBe('/admin/users');
    expect(renderer.root.findByType('aside').props.role).toBeUndefined();
    expect(document.body.style.overflow).toBe('');
  });
  it('closes and restores desktop navigation when the viewport grows', () => {
    act(() => renderer.root.findByProps({ 'aria-label': '管理メニューを開く' }).props.onClick());
    act(() => { query.matches = false; changeViewport(); });
    expect(renderer.root.findByType('aside').props.inert).toBeUndefined();
    expect(renderer.root.findByType('aside').props.role).toBeUndefined();
    expect(document.body.style.overflow).toBe('');
  });
  it('does not retain the drawer after access is revoked', () => {
    act(() => renderer.root.findByProps({ 'aria-label': '管理メニューを開く' }).props.onClick());
    act(() => emitAdmin(false));
    expect(renderer.root.findAllByType('aside')).toHaveLength(0);
    expect(renderer.root.findAllByType(AdminRoutes)).toHaveLength(0);
    expect(document.body.style.overflow).toBe('');
    expect(hasText('アクセス権限がありません')).toBe(true);
  });
});
