import { forwardRef, useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { StartupSurface } from './components/StartupSurface';
import { SplashScreen } from './components/SplashScreen';
import { RootStartupReadyProvider } from './components/RootStartupReadyContext';
import { AuthScreen } from './components/AuthScreen';
import { PrimaryAppHeader } from './components/PrimaryAppHeader';
import { AppSettingsDialog } from './components/AppSettingsDialog';
import { PlannerDataRecoveryNotice } from './components/PlannerDataRecoveryNotice';
import { HomeScheduleView } from './components/HomeScheduleView';
import { HomeAddFlow } from './components/HomeAddFlow';
import { PrimaryBottomNav } from './components/PrimaryBottomNav';
import { usePlannerAppState } from './hooks/usePlannerAppState';
import type { User } from './types/domain';

const fixture = vi.hoisted(() => ({
  state: {} as Partial<ReturnType<typeof usePlannerAppState>>,
  homeEntryMount: vi.fn(),
  homeSurfaceMount: vi.fn(),
  schedulePreload: vi.fn(() => vi.fn()),
  application: vi.fn(() => ({ pendingDraftBlocks: [], canEditDraftBlocks: false })),
}));
vi.mock('./lib/preloadAppViews', () => ({ scheduleAppViewPreload: fixture.schedulePreload }));
vi.mock('./hooks/usePlannerAppState', () => ({ usePlannerAppState: vi.fn(() => fixture.state) }));
vi.mock('./features/weeklyPlanning/application/useWeeklyPlanningApplication', () => ({ useWeeklyPlanningApplication: fixture.application }));
vi.mock('./hooks/useThemePreference', () => ({ useThemePreference: () => ({ themeMode: 'light', themePalette: 'forest' }) }));
vi.mock('./lib/appAccessGate', () => ({ isAppAccessGateEnabled: () => false, hasStoredAppAccessGrant: () => true, verifyAndStoreAppAccessKey: () => true }));
vi.mock('./components/PrimaryAppHeader', () => ({ PrimaryAppHeader: forwardRef(() => <header />) }));
vi.mock('./components/HomeScheduleView', () => ({ HomeScheduleView: () => { useEffect(() => { fixture.homeSurfaceMount(); }, []); return <div className="home-dashboard home-dashboard-default" />; } }));
vi.mock('./components/AiPlanningView', () => ({ AiPlanningView: () => <div className="ai-planning-view home-dashboard" /> }));
vi.mock('./components/MonthView', () => ({ MonthView: () => <div className="schedule-month-view" /> }));
vi.mock('./components/ScheduleToolbar', () => ({ ScheduleToolbar: () => <div className="schedule-toolbar" /> }));
vi.mock('./components/HomeAddFlow', () => ({ HomeAddFlow: () => { useEffect(() => { fixture.homeEntryMount(); }, []); return <div data-home-add-flow />; } }));
vi.mock('./components/QuickAddMenu', () => ({ QuickAddMenu: () => null }));
vi.mock('./components/PlanEditorPanel', () => ({ PlanEditorPanel: () => null }));
vi.mock('./components/MyPageDialog', () => ({ MyPageDialog: () => null }));
vi.mock('./components/AppSettingsDialog', () => ({ AppSettingsDialog: () => null }));

let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal('window', { matchMedia: () => ({ matches: true }), location: { pathname: '/' } });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network forbidden by fixture'); }));
  vi.mocked(usePlannerAppState).mockClear();
  fixture.application.mockClear();
  fixture.homeEntryMount.mockClear();
  fixture.homeSurfaceMount.mockClear();
  fixture.schedulePreload.mockClear();
  fixture.state = {
    booting: false, user: { id: 'owner-a' } as User,
    plans: [], actuals: [], monthEvents: [], todos: [], studySubjects: [], studyMaterials: [],
    scheduleTemplates: [], timetableTerms: [], timetablePeriods: [],
    plannerDataAvailability: { status: 'stale', ownerId: 'owner-a', observedAt: '2026-07-14T00:02:00Z', lastSuccessfulAt: '2026-07-14T00:01:00Z' },
    plannerDataRecovery: { ownerId: 'owner-a', reason: 'actual-material', phase: 'failed', canRetry: true },
    isPlannerDataSnapshotCurrent: () => false,
    retryPlannerData: vi.fn(async () => undefined),
    viewMode: 'month', selectedDate: '2026-07-14', monthDate: '2026-07-01', notice: null,
    editorDraft: null, editingPlanId: null, editingPlan: null, pendingRecurringPlanAction: null,
    setViewMode: vi.fn(),
  };
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

it('keeps recovery inside main across actual App navigation and forwards the captured lease', async () => {
  await act(async () => { renderer = create(<App />); });
  const main = () => renderer!.root.findByType('main');
  const notice = () => renderer!.root.findByType(PlannerDataRecoveryNotice);
  expect(notice().parent?.type).toBe('main');
  expect(main().props.className).toBe('home-main planner-data-recovery-main');
  expect(fixture.application).toHaveBeenLastCalledWith(expect.objectContaining({
    plannerDataAvailability: fixture.state.plannerDataAvailability,
    isPlannerDataSnapshotCurrent: fixture.state.isPlannerDataSnapshotCurrent,
  }));
  await act(async () => { renderer!.root.findByType(PrimaryBottomNav).props.onOpenAiPlanning(); });
  expect(renderer!.root.findAllByProps({ className: 'ai-planning-view home-dashboard' })).toHaveLength(1);
  expect(main().props.className).toBe('home-main planner-data-recovery-main');
  expect(notice().parent?.type).toBe('main');
  await act(async () => { renderer!.root.findByType(PrimaryBottomNav).props.onOpenSchedule(); });
  expect(main().props.className).toBe('section-stack schedule-main planner-data-recovery-main');
  expect(notice().parent?.type).toBe('main');
  await act(async () => { notice().findByType('button').props.onClick(); });
  expect(fixture.state.retryPlannerData).toHaveBeenCalledTimes(1);
  fixture.state = { ...fixture.state, notice: { text: '別の通知', tone: 'info' } };
  act(() => { renderer!.update(<App />); });
  expect(renderer!.root.findAllByProps({ role: 'status' })).toHaveLength(1);
  fixture.state = { ...fixture.state, notice: null };
  act(() => { renderer!.update(<App />); });
  expect(renderer!.root.findAllByProps({ role: 'status' })).toHaveLength(1);
});

it('hides the previous owner recovery on the first render and removes the recovery layout when cleared', () => {
  act(() => { renderer = create(<App />); });
  fixture.state = { ...fixture.state, user: { id: 'owner-b' } as User };
  renderer!.update(<App />);
  expect(renderer!.root.findAllByProps({ role: 'status' })).toHaveLength(0);
  expect(renderer!.root.findByType('main').props.className).toBe('home-main');
  fixture.state = { ...fixture.state, user: { id: 'owner-a' } as User, plannerDataRecovery: null };
  act(() => { renderer!.update(<App />); });
  expect(renderer!.root.findAllByProps({ role: 'status' })).toHaveLength(0);
  expect(renderer!.root.findByType('main').props.className).toBe('home-main');
});


it('starts optional preloads only for a ready owner and cancels on reload, owner change and unmount', () => {
  act(() => { renderer = create(<App />); });
  expect(fixture.schedulePreload).not.toHaveBeenCalled();
  const renderState = (changes: Partial<ReturnType<typeof usePlannerAppState>>) => {
    fixture.state = { ...fixture.state, ...changes };
    act(() => { renderer!.update(<App />); });
  };
  const ready = { status: 'ready' as const, ownerId: 'owner-a', observedAt: 'now', lastSuccessfulAt: 'now' };
  renderState({ booting: true, plannerDataAvailability: ready });
  expect(fixture.schedulePreload).not.toHaveBeenCalled();
  renderState({ booting: false });
  expect(fixture.schedulePreload).toHaveBeenCalledTimes(1);
  const cancelFirst = fixture.schedulePreload.mock.results[0].value;
  renderState({ notice: { text: 'unrelated render', tone: 'info' } });
  expect(fixture.schedulePreload).toHaveBeenCalledTimes(1);
  renderState({ plannerDataAvailability: { ...ready, status: 'loading' } });
  expect(cancelFirst).toHaveBeenCalledOnce();
  renderState({ plannerDataAvailability: ready });
  expect(fixture.schedulePreload).toHaveBeenCalledTimes(2);
  renderState({ user: { id: 'owner-b' } as User });
  expect(fixture.schedulePreload.mock.results[1].value).toHaveBeenCalledOnce();
  expect(fixture.schedulePreload).toHaveBeenCalledTimes(2);
  renderState({ plannerDataAvailability: { ...ready, ownerId: 'owner-b' } });
  expect(fixture.schedulePreload).toHaveBeenCalledTimes(3);
  act(() => { renderer!.unmount(); });
  expect(fixture.schedulePreload.mock.results[2].value).toHaveBeenCalledOnce();
  renderer = undefined;
});

it('consumes supplied bootstrap state without launching a second hydration', () => {
  const onReady = vi.fn();
  act(() => { renderer = create(<App state={fixture.state as ReturnType<typeof usePlannerAppState>} onReady={onReady} />); });
  expect(usePlannerAppState).not.toHaveBeenCalled();
  expect(onReady).toHaveBeenCalledOnce();
  expect(fixture.application).toHaveBeenCalled();
});


it('opens Home creation without navigation, clears prior edits and fences old close callbacks', async () => {
  const closePlanEditor = vi.fn();
  fixture.state.closePlanEditor = closePlanEditor;
  await act(async () => { renderer = create(<App />); });
  const open = () => renderer!.root.findByType(HomeScheduleView).props.onAddEntry();
  await act(async () => { open(); });
  expect(closePlanEditor).toHaveBeenCalledOnce();
  expect(fixture.state.setViewMode).not.toHaveBeenCalled();
  expect(renderer!.root.findByType('main').props.className).toBe('home-main planner-data-recovery-main');
  const oldClose = renderer!.root.findByType(HomeAddFlow).props.onClose;
  await act(async () => { oldClose(); open(); });
  await act(async () => { oldClose(); });
  expect(fixture.homeEntryMount).toHaveBeenCalledTimes(2);
  expect(renderer!.root.findAllByType(HomeAddFlow)).toHaveLength(1);
  await act(async () => { renderer!.root.findByType(PrimaryBottomNav).props.onOpenSchedule(); });
  expect(renderer!.root.findAllByType(HomeAddFlow)).toHaveLength(0);
  await act(async () => { renderer!.root.findByType(PrimaryBottomNav).props.onOpenHome(); });
  expect(renderer!.root.findAllByType(HomeAddFlow)).toHaveLength(0);
  await act(async () => { open(); });
  fixture.state = { ...fixture.state, user: { id: 'owner-b' } as User };
  await act(async () => { renderer!.update(<App />); });
  expect(renderer!.root.findAllByType(HomeAddFlow)).toHaveLength(0);
});


it('retains the previous App view and Home entry instance while settings owns the visible screen', async () => {
  let historyState: Record<string, unknown> | null = null;
  let pop: (() => void) | undefined;
  vi.stubGlobal('window', { matchMedia: () => ({ matches: true }), location: { pathname: '/' }, scrollX: 0, scrollY: 0, scrollTo: vi.fn(),
    history: { get state() { return historyState; }, length: 2,
      pushState: (value: Record<string, unknown>) => { historyState = value; }, back: vi.fn() },
    addEventListener: (_type: string, listener: () => void) => { pop = listener; }, removeEventListener: vi.fn(),
  });
  fixture.state.closePlanEditor = vi.fn();
  await act(async () => { renderer = create(<App />); });
  await act(async () => renderer!.root.findByType(HomeScheduleView).props.onAddEntry());
  const homeInstance = renderer!.root.findByType(HomeScheduleView);
  const entryInstance = renderer!.root.findByType(HomeAddFlow);
  act(() => renderer!.root.findByType(PrimaryAppHeader).props.onOpenSettings());
  expect(renderer!.root.findByType(AppSettingsDialog).props.open).toBe(true);
  expect(renderer!.root.findByProps({ className: 'app-shell home-app-shell' }).props.hidden).toBe(true);
  expect(renderer!.root.findByType(HomeScheduleView)).toBe(homeInstance);
  expect(renderer!.root.findByType(HomeAddFlow)).toBe(entryInstance);
  act(() => { historyState = null; pop!(); });
  expect(renderer!.root.findByProps({ className: 'app-shell home-app-shell' }).props.hidden).toBe(false);
  expect(renderer!.root.findByType(HomeAddFlow)).toBe(entryInstance);
  expect(fixture.homeEntryMount).toHaveBeenCalledTimes(1);
  await act(async () => renderer!.root.findByType(PrimaryBottomNav).props.onOpenSchedule());
  act(() => renderer!.root.findByType(PrimaryAppHeader).props.onOpenSettings());
  act(() => { historyState = null; pop!(); });
  expect(renderer!.root.findByProps({ className: 'app-shell schedule-workspace-shell' }).props.hidden).toBe(false);
  expect(renderer!.root.findByType('main').props.className).toBe('section-stack schedule-main planner-data-recovery-main');
});


it('standalone and trace-disabled App retain a healthy intro after boot while suppressing notice dismissal and preload', () => {
  vi.stubGlobal('window', { ...window, matchMedia: () => ({ matches: false }) });
  fixture.state.booting = true;
  fixture.state.plannerDataAvailability = { status: 'ready', ownerId: 'owner-a', observedAt: 'now', lastSuccessfulAt: 'now' };
  act(() => { renderer = create(<App />); });
  expect(renderer!.root.findAllByType('video')).toHaveLength(1);
  const clip = renderer!.root.findByType('video');
  expect(renderer!.root.findByType(StartupSurface).props.loading).toBe(true);
  expect(usePlannerAppState).toHaveBeenLastCalledWith({ noticeAutoDismiss: false });
  expect(fixture.schedulePreload).not.toHaveBeenCalled();
  act(() => renderer!.root.findByType('button').props.onClick());
  expect(renderer!.root.findByType('video')).toBe(clip);
  fixture.state = { ...fixture.state, booting: false };
  act(() => renderer!.update(<App />));
  expect(renderer!.root.findByType('video')).toBe(clip);
  expect(renderer!.root.findByProps({ className: 'startup-video' }).props.disabled).toBe(false);
  expect(fixture.schedulePreload).not.toHaveBeenCalled();
  expect(usePlannerAppState).toHaveBeenLastCalledWith({ noticeAutoDismiss: false });
  // Home geometry and scene effects must not start in a display:none ancestor.
  expect(renderer!.root.findAllByType(HomeScheduleView)).toHaveLength(0);
  expect(fixture.homeSurfaceMount).not.toHaveBeenCalled();
  act(() => clip.props.onEnded());
  expect(renderer!.root.findAllByType(SplashScreen)).toHaveLength(0);
  expect(usePlannerAppState).toHaveBeenLastCalledWith({ noticeAutoDismiss: true });
  expect(fixture.schedulePreload).toHaveBeenCalledOnce();
  expect(fixture.homeSurfaceMount).toHaveBeenCalledOnce();
});

it('standalone App can reveal sign-in by a ready skip without creating a second movie', () => {
  vi.stubGlobal('window', { ...window, matchMedia: () => ({ matches: false }) });
  fixture.state.user = null;
  act(() => { renderer = create(<App />); });
  expect(renderer!.root.findAllByType('video')).toHaveLength(1);
  expect(renderer!.root.findAllByType(AuthScreen)).toHaveLength(0);
  act(() => renderer!.root.findByProps({ className: 'startup-video' }).props.onClick());
  expect(renderer!.root.findAllByType(SplashScreen)).toHaveLength(0);
  expect(renderer!.root.findAllByType(AuthScreen)).toHaveLength(1);
});

it('root-owned standalone App delegates presentation and reports boot readiness without playing an inner movie', () => {
  vi.stubGlobal('window', { ...window, matchMedia: () => ({ matches: false }) });
  fixture.state.booting = true;
  const ready = vi.fn();
  const tree = () => <RootStartupReadyProvider onReady={ready}><App /></RootStartupReadyProvider>;
  act(() => { renderer = create(tree()); });
  expect(renderer!.root.findAllByType('video')).toHaveLength(0);
  expect(ready).not.toHaveBeenCalled();
  fixture.state = { ...fixture.state, booting: false };
  act(() => renderer!.update(tree()));
  expect(ready).toHaveBeenCalledOnce();
  expect(renderer!.root.findAllByType(StartupSurface)).toHaveLength(0);
});
