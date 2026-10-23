import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationRouteRoot } from './ApplicationRouteRoot';
import { createFakeAuthSession } from '../test/fakeAuthSession';
const mocks = vi.hoisted(() => ({ admin: vi.fn(), normal: vi.fn(), swipe: vi.fn(), dismiss: vi.fn(), removeSwipe: vi.fn(), removeDismiss: vi.fn(), createAuth: vi.fn() }));
vi.mock('../services/authSession', () => ({ createAuthSessionService: mocks.createAuth }));
vi.mock('./AdminApp', () => ({ AdminApp: (props: unknown) => { mocks.admin(props); return <div>Admin</div>; } }));
vi.mock('./LaplanceAppRoot', () => ({ LaplanceAppRoot: (props: unknown) => { mocks.normal(props); return <div>Normal</div>; } }));
vi.mock('../lib/studySessionSwipeNavigation', () => ({ installStudySessionSwipeNavigation: mocks.swipe }));
vi.mock('../lib/bottomSheetDragDismiss', () => ({ installBottomSheetDragDismiss: mocks.dismiss }));
let renderer: ReactTestRenderer;
let listeners: Map<string, () => void>;
const location = { pathname: '/admin/announcements', assign: vi.fn() };
const pushState = vi.fn((_state, _title, path) => { location.pathname = path; });
beforeEach(() => {
  vi.clearAllMocks(); listeners = new Map(); location.pathname = '/admin/announcements';
  mocks.swipe.mockReturnValue(mocks.removeSwipe); mocks.dismiss.mockReturnValue(mocks.removeDismiss);
  vi.stubGlobal('window', { location, history: { pushState }, addEventListener: (type: string, fn: () => void) => listeners.set(type, fn), removeEventListener: (type: string) => listeners.delete(type) });
});
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); });
describe('application root return navigation', () => {
  it('returns without reload or logout, shares auth, and respects browser Back/Forward', async () => {
    const { session } = createFakeAuthSession();
    await act(async () => { renderer = create(<ApplicationRouteRoot authSession={session} />); });
    expect(mocks.normal).not.toHaveBeenCalled(); expect(mocks.swipe).not.toHaveBeenCalled();
    const adminProps = mocks.admin.mock.lastCall![0]; expect(adminProps.authSession).toBe(session);
    act(() => { adminProps.onReturnToApp(); adminProps.onReturnToApp(); });
    expect(pushState).toHaveBeenCalledExactlyOnceWith({}, '', '/');
    expect(mocks.normal.mock.lastCall![0].authSession).toBe(session);
    expect(location.assign).not.toHaveBeenCalled(); expect(session.signOut).not.toHaveBeenCalled();
    expect(mocks.swipe).toHaveBeenCalledTimes(1); expect(mocks.dismiss).toHaveBeenCalledTimes(1);
    await act(async () => { location.pathname = '/admin/announcements'; listeners.get('popstate')!(); });
    expect(JSON.stringify(renderer.toJSON())).toContain('Admin');
    expect(mocks.removeSwipe).toHaveBeenCalledTimes(1); expect(mocks.removeDismiss).toHaveBeenCalledTimes(1);
    act(() => { location.pathname = '/'; listeners.get('popstate')!(); });
    expect(JSON.stringify(renderer.toJSON())).toContain('Normal');
    expect(mocks.swipe).toHaveBeenCalledTimes(2);
  });
  it('starts ordinary/public paths without mounting admin and cleans listeners on exit', async () => {
    location.pathname = '/privacy'; const { session } = createFakeAuthSession();
    await act(async () => { renderer = create(<ApplicationRouteRoot authSession={session} />); });
    expect(mocks.admin).not.toHaveBeenCalled(); expect(mocks.normal).toHaveBeenCalled();
    act(() => renderer.unmount());
    expect(listeners.size).toBe(0); expect(mocks.removeSwipe).toHaveBeenCalledTimes(1);
  });
  it('leaves initial auth creation to the existing normal/public boundary until admin is opened', async () => {
    location.pathname = '/privacy'; const { session } = createFakeAuthSession(); mocks.createAuth.mockReturnValue(session);
    await act(async () => { renderer = create(<ApplicationRouteRoot />); });
    expect(mocks.createAuth).not.toHaveBeenCalled();
    expect(mocks.normal.mock.lastCall![0].authSession).toBeUndefined();
    await act(async () => { location.pathname = '/admin'; listeners.get('popstate')!(); });
    expect(mocks.createAuth).toHaveBeenCalledTimes(1);
    expect(mocks.admin.mock.lastCall![0].authSession).toBe(session);
    act(() => mocks.admin.mock.lastCall![0].onReturnToApp());
    expect(mocks.normal.mock.lastCall![0].authSession).toBe(session);
    expect(mocks.createAuth).toHaveBeenCalledTimes(1);
  });
});
