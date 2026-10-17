import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationRouteRoot } from './ApplicationRouteRoot';
import { subscribeAdminStatus } from '../services/adminService';
import { createFakeAuthSession } from '../test/fakeAuthSession';

const view = vi.hoisted(() => ({ fail: false, rendered: vi.fn() }));
vi.mock('../services/adminService', () => ({ subscribeAdminStatus: vi.fn() }));
vi.mock('./AdminViews', () => ({ AdminRoutes: () => {
  view.rendered(); if (view.fail) throw new Error('Admin view render failure');
  return <section>Protected content</section>;
} }));
vi.mock('./LaplanceAppRoot', () => ({ LaplanceAppRoot: () => <main>Normal</main> }));
vi.mock('../lib/studySessionSwipeNavigation', () => ({ installStudySessionSwipeNavigation: () => () => {} }));
vi.mock('../lib/bottomSheetDragDismiss', () => ({ installBottomSheetDragDismiss: () => () => {} }));
let renderer: ReactTestRenderer;
let fake: ReturnType<typeof createFakeAuthSession>;
let emitAccess: (allowed: boolean) => void;
let listeners: Map<string, Set<() => void>>;
const location = { pathname: '/admin/users', reload: vi.fn(), assign: vi.fn() };
const user = { id: 'admin-owner', requiresEmailVerification: false };
const text = () => JSON.stringify(renderer.toJSON());
async function mount() {
  await act(async () => { renderer = create(<ApplicationRouteRoot authSession={fake.session} />); await vi.dynamicImportSettled(); });
}
beforeEach(() => {
  vi.clearAllMocks(); view.fail = false; location.pathname = '/admin/users';
  fake = createFakeAuthSession(); listeners = new Map();
  vi.mocked(subscribeAdminStatus).mockImplementation((_id, listener) => { emitAccess = listener; return () => {}; });
  vi.stubGlobal('window', { location,
    history: { pushState: vi.fn((_state, _title, path) => { location.pathname = path; }) },
    addEventListener: (type: string, fn: () => void) => { const group = listeners.get(type) ?? new Set(); group.add(fn); listeners.set(type, group); },
    removeEventListener: (type: string, fn: () => void) => listeners.get(type)?.delete(fn) });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Admin failure boundary preserves actual authorization', () => {
  it.each(['signed-out', 'denied'])('keeps %s guard and its ordinary return action', async state => {
    await mount();
    expect(text()).toContain('認証状態を確認しています');
    act(() => fake.emit(state === 'signed-out' ? null : user));
    if (state === 'denied') act(() => emitAccess(false));
    expect(text()).toContain(state === 'signed-out' ? 'ログインが必要です' : 'アクセス権限がありません');
    expect(text()).not.toContain('読み込めませんでした');
    expect(view.rendered).not.toHaveBeenCalled();
    const preventDefault = vi.fn();
    act(() => renderer.root.findByProps({ className: 'admin-console-return-link' }).props.onClick({ button: 0, preventDefault }));
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(location.pathname).toBe('/');
    expect(text()).toContain('Normal');
    expect(fake.session.signOut).not.toHaveBeenCalled();
    expect(location.reload).not.toHaveBeenCalled();
  });

  it('resets only after leaving Admin and rechecks auth before remounting a recovered view', async () => {
    view.fail = true;
    await mount();
    act(() => fake.emit(user));
    act(() => emitAccess(true));
    expect(text()).toContain('読み込めませんでした');
    expect(text()).not.toContain('Protected content');
    expect(fake.unsubscribe).toHaveBeenCalledOnce();
    view.fail = false;
    act(() => renderer.root.findAllByType('button').find(node => node.children.includes('通常画面へ戻る'))!.props.onClick());
    expect(text()).toContain('Normal');
    await act(async () => { location.pathname = '/admin/users'; listeners.get('popstate')!.forEach(listener => listener()); });
    expect(text()).toContain('認証状態を確認しています');
    expect(text()).not.toContain('Protected content');
    act(() => fake.emit(user));
    expect(text()).toContain('管理者権限を確認しています');
    act(() => emitAccess(true));
    expect(text()).toContain('Protected content');
    expect(text()).not.toContain('読み込めませんでした');
    expect(fake.session.subscribe).toHaveBeenCalledTimes(2);
    expect(fake.session.signOut).not.toHaveBeenCalled();
    expect(location.reload).not.toHaveBeenCalled();
  });
});
