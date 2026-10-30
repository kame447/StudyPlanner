import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApplicationRouteRoot } from './ApplicationRouteRoot';
import { LaplanceAppRoot } from './LaplanceAppRoot';
import { SplashScreen } from './SplashScreen';
import { APP_HISTORY_CHANGE } from '../lib/appHistory';
import { createAuthSessionService } from '../services/authSession';
import { createFakeAuthSession } from '../test/fakeAuthSession';
import type { StartupSessionCapability } from '../lib/startupSessionScope';

const evidence = vi.hoisted(() => ({ boot: vi.fn(), dispose: vi.fn(), adminMount: vi.fn(), adminDispose: vi.fn(), scopes: [] as StartupSessionCapability[] }));
vi.mock('../services/authSession', () => ({ createAuthSessionService: vi.fn() }));
vi.mock('../hooks/useAppearancePreference', () => ({ useAppearancePreference: () => ({ appearance: 'standard' }) }));
vi.mock('../hooks/useThemePreference', () => ({ useThemePreference: () => ({}) }));
vi.mock('../features/weeklyPlanning/trace/configureWeeklyPlanningTraceRepository', () => ({ isWeeklyPlanningTraceFeatureEnabled: () => true }));
vi.mock('../features/weeklyPlanning/trace/useWeeklyPlanningTracePolicy', () => ({ useWeeklyPlanningTracePolicy: () => ({ status: 'accepted' }) }));
vi.mock('../features/weeklyPlanning/personalization/useWeeklyPlanningPersonalizationProfile', () => ({
  useWeeklyPlanningPersonalizationProfile: () => ({ loading: false, error: '', profile: { weekStartsOn: { value: 'monday' } } }),
}));
vi.mock('../features/userPlanningContext/UserPlanningContextContext', () => ({ UserPlanningContextProvider: ({ children }: any) => children }));
vi.mock('./PlannerAppBootstrap', async () => {
  const { useEffect } = await import('react');
  return { PlannerAppBootstrap: ({ children, startupScope }: any) => {
    useEffect(() => { evidence.boot(); evidence.scopes.push(startupScope); return evidence.dispose; }, []);
    return children({}, () => {});
  } };
});
vi.mock('../App', async () => {
  const { useEffect, useState } = await import('react');
  const { useRootStartupReady } = await import('./RootStartupReadyContext');
  return { default: () => {
    const [draft, setDraft] = useState('initial');
    const ready = useRootStartupReady();
    useEffect(() => { ready?.(); }, [ready]);
    return <><header className="primary-app-header"><button>Profile</button></header>
      <button aria-label="edit retained draft" onClick={() => setDraft('edited')}>{draft}</button></>;
  } };
});
vi.mock('./SplashScreen', () => ({ SplashScreen: () => <p>Startup video</p> }));
vi.mock('./AdminApp', async () => {
  const { useEffect } = await import('react');
  return { AdminApp: ({ onReturnToApp }: any) => {
    useEffect(() => { evidence.adminMount(); return evidence.adminDispose; }, []);
    return <button onClick={onReturnToApp}>Return</button>;
  } };
});
vi.mock('../lib/studySessionSwipeNavigation', () => ({ installStudySessionSwipeNavigation: () => () => {} }));
vi.mock('../lib/bottomSheetDragDismiss', () => ({ installBottomSheetDragDismiss: () => () => {} }));
let renderer: ReactTestRenderer;
let fake: ReturnType<typeof createFakeAuthSession>;
let browser: EventTarget & { location: { pathname: string }; history: { state: unknown; pushState: ReturnType<typeof vi.fn> } };
const focus = vi.fn();
const scrollTo = vi.fn();
const user = { id: 'owner', requiresEmailVerification: false };
beforeEach(() => {
  vi.clearAllMocks(); evidence.scopes = [];
  fake = createFakeAuthSession({ currentUser: user });
  vi.mocked(createAuthSessionService).mockReturnValue(fake.session);
  const location = { pathname: '/' };
  browser = Object.assign(new EventTarget(), { location, scrollX: 0, scrollY: 240, scrollTo, history: { state: {}, pushState: vi.fn((state, _title, path) => { browser.history.state = state; location.pathname = path; }) } });
  vi.stubGlobal('window', browser);
});
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); });
async function mount() {
  await act(async () => { renderer = create(<ApplicationRouteRoot />, { createNodeMock: element => element.props.className === 'application-planner' ? { querySelector: () => ({ focus }) } : null }); });
}
async function navigate(path: string) {
  await act(async () => { browser.location.pathname = path; browser.dispatchEvent(new Event('popstate')); await vi.dynamicImportSettled(); });
}
const draft = () => renderer.root.findByProps({ 'aria-label': 'edit retained draft' });

it('retains the real startup outcome, owner scope and draft through repeated Admin visits', async () => {
  await mount();
  act(() => renderer.root.findByType(SplashScreen).props.onVideoComplete('completed'));
  expect(renderer.root.findAllByType(SplashScreen)).toHaveLength(0);
  act(() => draft().props.onClick());
  const normal = renderer.root.findByType(LaplanceAppRoot);
  const scope = evidence.scopes[0];
  const historyNotice = vi.fn(); browser.addEventListener(APP_HISTORY_CHANGE, historyNotice);
  for (let visit = 1; visit <= 2; visit++) {
    await navigate('/admin/users');
    expect(renderer.root.findByType(LaplanceAppRoot)).toBe(normal);
    expect(renderer.root.findByProps({ className: 'application-planner' }).props.hidden).toBe(true);
    expect(evidence.boot).toHaveBeenCalledOnce();
    expect(evidence.dispose).not.toHaveBeenCalled();
    expect(fake.unsubscribe).not.toHaveBeenCalled();
    expect(scope.isCurrent()).toBe(true);
    act(() => renderer.root.findAllByType('button').find(node => node.children.includes('Return'))!.props.onClick());
    expect(historyNotice).toHaveBeenCalledTimes(visit);
    expect(evidence.adminDispose).toHaveBeenCalledTimes(visit);
    expect(renderer.root.findAllByType(SplashScreen)).toHaveLength(0);
    expect(draft().children).toEqual(['edited']);
    expect(focus).toHaveBeenCalledTimes(visit);
    expect(scrollTo).toHaveBeenLastCalledWith(0, 240);
  }
  expect(evidence.adminMount).toHaveBeenCalledTimes(2);
  expect(fake.session.signOut).not.toHaveBeenCalled();
  // One normal wrapper plus one Admin wrapper; no normal service replacement.
  expect(createAuthSessionService).toHaveBeenCalledTimes(2);
});

it.each(['owner', 'other'])('keeps auth revocation alive while hidden before %s signs in', async (nextOwner) => {
  await mount(); act(() => renderer.root.findByType(SplashScreen).props.onVideoComplete('completed'));
  act(() => draft().props.onClick()); const oldScope = evidence.scopes[0];
  await navigate('/admin');
  act(() => { fake.emit(null); fake.emit({ ...user, id: nextOwner }); });
  expect(oldScope.isCurrent()).toBe(false);
  expect(evidence.dispose).toHaveBeenCalledOnce();
  await navigate('/');
  expect(draft().children).toEqual(['initial']);
  expect(evidence.boot).toHaveBeenCalledTimes(2);
});

it('does not initialize the planner on direct Admin entry, and starts it once on first return', async () => {
  browser.location.pathname = '/admin'; await mount(); await act(async () => { await vi.dynamicImportSettled(); });
  expect(renderer.root.findAllByType(LaplanceAppRoot)).toHaveLength(0);
  expect(evidence.boot).not.toHaveBeenCalled();
  await navigate('/');
  expect(evidence.boot).toHaveBeenCalledOnce();
  expect(renderer.root.findAllByType(SplashScreen)).toHaveLength(1);
});
