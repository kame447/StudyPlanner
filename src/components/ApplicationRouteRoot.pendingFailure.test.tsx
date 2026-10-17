import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { ApplicationRouteRoot } from './ApplicationRouteRoot';
import { APP_HISTORY_CHANGE } from '../lib/appHistory';
import { createFakeAuthSession } from '../test/fakeAuthSession';

const delivery = vi.hoisted(() => {
  let start!: () => void, fail!: () => void;
  return { starting: new Promise<void>(resolve => { start = resolve; }), start: () => start(),
    pending: new Promise<void>(resolve => { fail = resolve; }), fail: () => fail() };
});
vi.mock('./AdminApp', async () => {
  delivery.start(); await delivery.pending; throw new Error('late Admin module failure');
});
vi.mock('./LaplanceAppRoot', () => ({ LaplanceAppRoot: () => <main>Normal</main> }));
vi.mock('../lib/studySessionSwipeNavigation', () => ({ installStudySessionSwipeNavigation: () => () => {} }));
vi.mock('../lib/bottomSheetDragDismiss', () => ({ installBottomSheetDragDismiss: () => () => {} }));
let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('ignores a failed delivery after Back and retains recovery if Forward revisits the cached rejection', async () => {
  const listeners = new Map<string, () => void>();
  const location = { pathname: '/', reload: vi.fn(), assign: vi.fn() };
  vi.stubGlobal('window', { location, history: { pushState: vi.fn() },
    addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type) });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const { session } = createFakeAuthSession();
  await act(async () => { renderer = create(<ApplicationRouteRoot authSession={session} />); });
  await act(async () => { location.pathname = '/admin/users'; listeners.get(APP_HISTORY_CHANGE)!(); await delivery.starting; });
  expect(renderer.root.findByProps({ role: 'status' }).children).toEqual(['管理者画面を開いています']);
  act(() => { location.pathname = '/'; listeners.get('popstate')!(); });
  expect(JSON.stringify(renderer.toJSON())).toContain('Normal');
  await act(async () => { delivery.fail(); await vi.dynamicImportSettled(); });
  expect(JSON.stringify(renderer.toJSON())).toContain('Normal');
  expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  await act(async () => { location.pathname = '/admin/users'; listeners.get('popstate')!(); });
  expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('読み込めませんでした');
  act(() => { location.pathname = '/'; listeners.get('popstate')!(); });
  expect(JSON.stringify(renderer.toJSON())).toContain('Normal');
  expect(listeners.size).toBe(2);
  expect(location.reload).not.toHaveBeenCalled();
  expect(location.assign).not.toHaveBeenCalled();
  expect(session.signOut).not.toHaveBeenCalled();
});
