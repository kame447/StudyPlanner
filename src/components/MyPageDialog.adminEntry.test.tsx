import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MyPageDialog } from './MyPageDialog';
import { ApplicationRouteRoot } from './ApplicationRouteRoot';
import { createFakeAuthSession } from '../test/fakeAuthSession';
import { APP_HISTORY_CHANGE } from '../lib/appHistory';
import { deferred } from '../repositories/localPersistenceConcurrency.testUtils';
import type { User } from '../types/domain';

const mocks = vi.hoisted(() => ({ allowed: true, before: vi.fn(), close: vi.fn(), save: vi.fn(),
  normal: vi.fn(), admin: vi.fn(), createAuth: vi.fn(), removeSwipe: vi.fn(), removeDismiss: vi.fn() }));
vi.mock('../hooks/useAdminStatus', () => ({ useAdminStatus: () => ({ isAdmin: mocks.allowed, status: mocks.allowed ? 'allowed' : 'denied' }) }));
vi.mock('../services/authSession', () => ({ createAuthSessionService: mocks.createAuth }));
vi.mock('../lib/studySessionSwipeNavigation', () => ({ installStudySessionSwipeNavigation: () => mocks.removeSwipe }));
vi.mock('../lib/bottomSheetDragDismiss', () => ({ installBottomSheetDragDismiss: () => mocks.removeDismiss }));
vi.mock('./LaplanceAppRoot', () => ({ LaplanceAppRoot: (props: unknown) => { mocks.normal(props); return dialog(); } }));
vi.mock('./AdminApp', () => ({ AdminApp: (props: unknown) => { mocks.admin(props); return <section>Admin root</section>; } }));

const user: User = { id: 'owner-a', email: 'owner@example.test', username: 'Owner', avatar: '', createdAt: '' };
let renderer: ReactTestRenderer;
let browser: EventTarget;
let location: { pathname: string; assign: ReturnType<typeof vi.fn> };
let pushState: ReturnType<typeof vi.fn>;
function dialog(open = true, owner = user) {
  return <MyPageDialog open={open} user={owner} onSaveProfile={mocks.save} onSignOut={async () => undefined}
    onClose={mocks.close} onBeforeOpenAdmin={mocks.before} />;
}
function adminButton() { return renderer.root.findAllByType('button').find(button => button.children.includes('管理者画面'))!; }
function nameInput() { return renderer.root.findByProps({ placeholder: '未入力ならメールアドレスを使います' }); }
beforeEach(() => {
  vi.clearAllMocks(); mocks.allowed = true; mocks.before.mockReset().mockReturnValue(true);
  browser = new EventTarget(); location = { pathname: '/', assign: vi.fn() };
  pushState = vi.fn((_state, _title, path) => { location.pathname = path; });
  vi.stubGlobal('window', Object.assign(browser, { location, history: { state: {}, pushState } }));
});
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); });

it('keeps the profile and edited input intact when the existing leave warning is declined', () => {
  mocks.before.mockReturnValue(false);
  act(() => { renderer = create(dialog()); });
  act(() => nameInput().props.onChange({ target: { value: 'Unsaved profile' } }));
  act(() => adminButton().props.onClick());
  expect(mocks.before).toHaveBeenCalledOnce();
  expect(mocks.close).not.toHaveBeenCalled(); expect(pushState).not.toHaveBeenCalled();
  expect(location.assign).not.toHaveBeenCalled(); expect(nameInput().props.value).toBe('Unsaved profile');
});

it('navigates once in the same document and retires repeated clicks after acceptance', () => {
  const changed = vi.fn(); browser.addEventListener(APP_HISTORY_CHANGE, changed);
  act(() => { renderer = create(dialog()); });
  const open = adminButton().props.onClick;
  act(() => { open(); open(); });
  expect(mocks.before).toHaveBeenCalledOnce(); expect(mocks.close).toHaveBeenCalledOnce();
  expect(pushState).toHaveBeenCalledExactlyOnceWith({}, '', '/admin/users');
  expect(changed).toHaveBeenCalledOnce(); expect(location.assign).not.toHaveBeenCalled();
});

it.each(['closed', 'owner', 'revoked', 'unmounted'] as const)('rejects a retained entry after the dialog is %s', boundary => {
  act(() => { renderer = create(dialog()); });
  const open = adminButton().props.onClick;
  act(() => {
    if (boundary === 'closed') renderer.update(dialog(false));
    if (boundary === 'owner') renderer.update(dialog(true, { ...user, id: 'owner-b' }));
    if (boundary === 'revoked') { mocks.allowed = false; renderer.update(dialog()); }
    if (boundary === 'unmounted') renderer.unmount();
  });
  act(() => open());
  expect(mocks.before).not.toHaveBeenCalled(); expect(pushState).not.toHaveBeenCalled();
  expect(mocks.close).not.toHaveBeenCalled(); expect(location.assign).not.toHaveBeenCalled();
});

it('rejects an old owner callback after an A to B to A round trip', () => {
  act(() => { renderer = create(dialog()); }); const open = adminButton().props.onClick;
  act(() => renderer.update(dialog(true, { ...user, id: 'owner-b' })));
  act(() => renderer.update(dialog()));
  act(() => open());
  expect(mocks.before).not.toHaveBeenCalled(); expect(pushState).not.toHaveBeenCalled();
  act(() => adminButton().props.onClick()); expect(pushState).toHaveBeenCalledOnce();
});

it('rechecks the committed dialog after the synchronous confirmation callback', () => {
  act(() => { renderer = create(dialog()); });
  // Flush the replacement inside the confirmation, before returning approval.
  mocks.before.mockImplementationOnce(() => { act(() => renderer.update(dialog(false))); return true; });
  adminButton().props.onClick();
  expect(pushState).not.toHaveBeenCalled(); expect(location.assign).not.toHaveBeenCalled();
});

it('does not put a late save completion into a reopened profile after accepted navigation', async () => {
  const saving = deferred<User>(); mocks.save.mockReturnValueOnce(saving.promise);
  act(() => { renderer = create(dialog()); });
  act(() => renderer.root.findAllByType('button').find(button => button.children.includes('プロフィールを保存'))!.props.onClick());
  act(() => adminButton().props.onClick());
  act(() => renderer.update(dialog(false))); act(() => renderer.update(dialog()));
  act(() => nameInput().props.onChange({ target: { value: 'New draft' } }));
  await act(async () => { saving.resolve({ ...user, username: 'Old saved profile' }); });
  expect(nameInput().props.value).toBe('New draft');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('保存しました。');
});

it('uses the real root history listener and preserves injected auth through entry, return, Back and Forward', async () => {
  const { session } = createFakeAuthSession({ currentUser: { id: user.id, requiresEmailVerification: false } });
  await act(async () => { renderer = create(<ApplicationRouteRoot authSession={session} />); });
  const normalProps = mocks.normal.mock.lastCall![0]; expect(normalProps.authSession).toBe(session);
  await act(async () => adminButton().props.onClick());
  expect(mocks.admin.mock.lastCall![0].authSession).toBe(session);
  expect(location.pathname).toBe('/admin/users'); expect(location.assign).not.toHaveBeenCalled();
  expect(mocks.removeSwipe).toHaveBeenCalledOnce(); expect(mocks.removeDismiss).toHaveBeenCalledOnce();
  act(() => mocks.admin.mock.lastCall![0].onReturnToApp());
  expect(location.pathname).toBe('/'); expect(mocks.normal.mock.lastCall![0].authSession).toBe(session);
  await act(async () => { location.pathname = '/admin/users'; browser.dispatchEvent(new Event('popstate')); });
  expect(JSON.stringify(renderer.toJSON())).toContain('Admin root');
  act(() => { location.pathname = '/'; browser.dispatchEvent(new Event('popstate')); });
  expect(renderer.root.findAllByType(MyPageDialog)).toHaveLength(1);
  expect(pushState).toHaveBeenCalledTimes(2); expect(session.signOut).not.toHaveBeenCalled();
  expect(mocks.createAuth).not.toHaveBeenCalled();
});
