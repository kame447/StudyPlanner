import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationRouteRoot } from './ApplicationRouteRoot';
import { APP_HISTORY_CHANGE } from '../lib/appHistory';
import { createFakeAuthSession } from '../test/fakeAuthSession';
import type { AuthSessionService } from '../services/authSession';

const mocks = vi.hoisted(() => ({ normal: vi.fn(), createAuth: vi.fn(), requested: vi.fn() }));
vi.mock('../services/authSession', () => ({ createAuthSessionService: mocks.createAuth }));
vi.mock('./AdminApp', async () => { mocks.requested(); throw new Error('simulated Admin chunk delivery failure'); });
vi.mock('./LaplanceAppRoot', () => ({ LaplanceAppRoot: ({ authSession }: { authSession?: AuthSessionService }) => {
  mocks.normal(authSession); return <main>Normal</main>;
} }));
vi.mock('../lib/studySessionSwipeNavigation', () => ({ installStudySessionSwipeNavigation: () => () => {} }));
vi.mock('../lib/bottomSheetDragDismiss', () => ({ installBottomSheetDragDismiss: () => () => {} }));
let renderer: ReactTestRenderer;
let listeners: Map<string, () => void>;
const location = { pathname: '/', reload: vi.fn(), assign: vi.fn() };
const pushState = vi.fn((_state: unknown, _title: string, path: string) => { location.pathname = path; });
const text = () => JSON.stringify(renderer.toJSON());
const returnAction = () => renderer.root.findAllByType('button').find(node => node.children.includes('通常画面へ戻る'))!;
async function navigate(path: string, event = 'popstate') {
  await act(async () => { location.pathname = path; listeners.get(event)!(); await vi.dynamicImportSettled(); });
}
beforeEach(() => {
  vi.clearAllMocks();
  listeners = new Map();
  location.pathname = '/';
  vi.stubGlobal('window', { location, history: { pushState },
    addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type) });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Admin delivery failure recovery', () => {
  it.each(['/', '/admin/users'])('retains return, auth and Back/Forward after failure from %s', async (initialPath) => {
    location.pathname = initialPath;
    const { session } = createFakeAuthSession();
    mocks.createAuth.mockReturnValue(session);
    await act(async () => { renderer = create(<ApplicationRouteRoot />); await vi.dynamicImportSettled(); });
    if (initialPath === '/') {
      expect(text()).toContain('Normal');
      expect(mocks.createAuth).not.toHaveBeenCalled();
      await navigate('/admin/users', APP_HISTORY_CHANGE);
    }
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('管理者画面を読み込めませんでした');
    expect(listeners.size).toBe(2);
    expect(mocks.createAuth).toHaveBeenCalledOnce();
    expect(location.reload).not.toHaveBeenCalled();
    const retainedReturn = returnAction().props.onClick;
    act(() => { retainedReturn(); retainedReturn(); });
    expect(pushState).toHaveBeenCalledExactlyOnceWith({}, '', '/');
    expect(text()).toContain('Normal');
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
    expect(mocks.normal).toHaveBeenLastCalledWith(session);
    await navigate('/admin/users');
    expect(renderer.root.findByProps({ role: 'alert' })).toBeDefined();
    await navigate('/');
    expect(text()).toContain('Normal');
    expect(listeners.size).toBe(2);
    expect(mocks.createAuth).toHaveBeenCalledOnce();
    expect(location.assign).not.toHaveBeenCalled();
    expect(location.reload).not.toHaveBeenCalled();
    expect(session.signOut).not.toHaveBeenCalled();
  });

  it('offers explicit reload for the cached rejection without an automatic or pretend retry', async () => {
    location.pathname = '/admin';
    const { session } = createFakeAuthSession();
    await act(async () => { renderer = create(<ApplicationRouteRoot authSession={session} />); await vi.dynamicImportSettled(); });
    const imports = mocks.requested.mock.calls.length;
    expect(location.reload).not.toHaveBeenCalled();
    const reload = renderer.root.findAllByType('button').find(node => node.children.includes('再読み込み'))!;
    act(() => reload.props.onClick());
    expect(location.reload).toHaveBeenCalledOnce();
    expect(location.pathname).toBe('/admin');
    expect(mocks.requested).toHaveBeenCalledTimes(imports);
    expect(pushState).not.toHaveBeenCalled();
    expect(session.signOut).not.toHaveBeenCalled();
  });

  it('uses the current auth session after a failure, without showing old-owner content', async () => {
    location.pathname = '/admin';
    const old = createFakeAuthSession().session;
    const current = createFakeAuthSession({ available: false }).session;
    await act(async () => { renderer = create(<ApplicationRouteRoot authSession={old} />); await vi.dynamicImportSettled(); });
    act(() => renderer.update(<ApplicationRouteRoot authSession={current} />));
    act(() => returnAction().props.onClick());
    expect(mocks.normal).toHaveBeenLastCalledWith(current);
    expect(old.signOut).not.toHaveBeenCalled();
    expect(current.signOut).not.toHaveBeenCalled();
  });
});
