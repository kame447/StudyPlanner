import { forwardRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { AiPlanningView } from './components/AiPlanningView';
import type { PlannerAppSnapshot } from './components/PlannerAppBootstrap';
import { PrimaryBottomNav } from './components/PrimaryBottomNav';
import { PrimaryAppHeader } from './components/PrimaryAppHeader';
import { AppSettingsDialog } from './components/AppSettingsDialog';
import { MyPageDialog } from './components/MyPageDialog';
import { createMemoryStorageHarness } from './features/weeklyPlanning/testUtils/weeklyPlanningApplicationTestHarness';
import { createReadyPlannerDataAvailability } from './features/weeklyPlanning/testUtils/plannerDataAvailabilityTest';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from './features/weeklyPlanning/application/weeklyPlanningStableV5RuntimeSession';
import type { TodoTask, User } from './types/domain';

const boundary = vi.hoisted(() => ({ todos: vi.fn(async () => []), materials: vi.fn(async () => []) }));
// This suite isolates planner/navigation behavior; streak persistence has its own provider integration tests.
vi.mock('./components/StudyStreakContext', () => ({
  StudyStreakProvider: ({ children }: { children: import('react').ReactNode }) => children,
  useSharedStudyStreak: () => null,
}));
vi.mock('./repositories', () => ({ plannerRepository: { getTodos: boundary.todos, getStudyMaterials: boundary.materials } }));
vi.mock('./lib/preloadAppViews', () => ({ scheduleAppViewPreload: () => () => undefined }));
vi.mock('./hooks/useThemePreference', () => ({ useThemePreference: () => ({ themeMode: 'light', themePalette: 'forest' }) }));
vi.mock('./components/PrimaryAppHeader', () => ({ PrimaryAppHeader: forwardRef(() => <header />) }));
vi.mock('./components/HomeScheduleView', () => ({ HomeScheduleView: () => <section aria-label="Home" /> }));
vi.mock('./components/MonthView', () => ({ MonthView: () => <section aria-label="Schedule" /> }));
vi.mock('./components/ScheduleToolbar', () => ({ ScheduleToolbar: () => null }));
vi.mock('./components/PlanEditorPanel', () => ({ PlanEditorPanel: () => null }));
vi.mock('./components/MyPageDialog', () => ({ MyPageDialog: () => null }));
vi.mock('./components/AppSettingsDialog', () => ({ AppSettingsDialog: () => null }));

let renderer: ReactTestRenderer | undefined;
let state: PlannerAppSnapshot;
const nav = () => renderer!.root.findByType(PrimaryBottomNav).props;
const input = () => renderer!.root.findByType('textarea');
const aiShellActive = () => renderer!.root.findAllByType('div')
  .some(node => String(node.props.className ?? '').split(' ').includes('ai-planning-active'));
const application = () => renderer!.root.findByType(AiPlanningView).props.application;
beforeEach(() => {
  const { storage } = createMemoryStorageHarness();
  vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { pathname: '/' }, localStorage: storage, sessionStorage: storage,
    matchMedia: () => ({ matches: true }), requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    setTimeout, clearTimeout, performance, scrollTo() {},
    history: { state: {}, length: 1, pushState() {}, replaceState() {} } }));
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('document', Object.assign(new EventTarget(), {
    documentElement: { dataset: {}, style: {} }, body: { style: {} }, visibilityState: 'visible',
  }));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network forbidden'); }));
  vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'false');
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:navigation-draft');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  boundary.todos.mockClear(); boundary.materials.mockClear();
  state = {
    booting: false, user: { id: 'owner-a' } as User,
    plans: [], actuals: [], monthEvents: [], todos: [], studySubjects: [], studyMaterials: [],
    scheduleTemplates: [], timetableTerms: [], timetablePeriods: [],
    plannerDataAvailability: createReadyPlannerDataAvailability('owner-a'), isPlannerDataSnapshotCurrent: () => true,
    viewMode: 'month', selectedDate: '2026-07-14', monthDate: '2026-07-01', notice: null,
    editorDraft: null, editingPlanId: null, editingPlan: null, pendingRecurringPlanAction: null,
    setViewMode: vi.fn(), saveWeeklyApprovedPlan: vi.fn(),
  } as unknown as PlannerAppSnapshot;
});
afterEach(() => {
  act(() => renderer?.unmount()); renderer = undefined;
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

it('preserves the same AI composer and attachment across repeated Home/Schedule visits without catalog rereads', async () => {
  await act(async () => { renderer = create(<App state={state} />); });
  expect(renderer!.root.findAllByType(AiPlanningView)).toHaveLength(0);
  await act(async () => { nav().onOpenAiPlanning(); });
  const firstInput = input();
  expect(aiShellActive()).toBe(true);
  const chat = application().chat;
  await act(async () => {
    input().props.onChange({ target: { value: '  入力途中の計画\n' } });
    renderer!.root.findByProps({ type: 'file' }).props.onChange({ target: { files: [{ name: 'notes.png', type: 'image/png', size: 20 }] } });
  });
  for (const destination of ['onOpenHome', 'onOpenSchedule', 'onOpenHome']) {
    await act(async () => { nav()[destination](); });
    expect(aiShellActive()).toBe(false);
    await act(async () => { nav().onOpenAiPlanning(); });
    expect(aiShellActive()).toBe(true);
    expect(input() === firstInput).toBe(true);
    expect(input().props.value).toBe('  入力途中の計画\n');
    expect(renderer!.root.findByProps({ 'aria-label': '添付画像 notes.png' })).toBeDefined();
    expect(application().chat).toBe(chat);
  }
  expect(boundary.todos).not.toHaveBeenCalled();
  expect(boundary.materials).not.toHaveBeenCalled();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
});

it('uses the existing unsaved-chat warning condition for Admin entry and clears it after checkpoint recovery', async () => {
  const confirm = vi.fn(() => false);
  Object.assign(window, { confirm });
  const warnsBeforeUnload = () => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  await act(async () => { renderer = create(<App state={state} />); });
  await act(async () => { nav().onOpenAiPlanning(); });
  await act(async () => { input().props.onChange({ target: { value: 'Retained composer' } }); });
  await act(async () => { renderer!.root.findByType(PrimaryAppHeader).props.onOpenProfile(); });
  const myPage = () => renderer!.root.findByType(MyPageDialog).props;
  const chat = application().chat;
  expect(chat.dirty).toBe(false);
  expect(warnsBeforeUnload()).toBe(false);
  expect(myPage().onBeforeOpenAdmin()).toBe(true);
  expect(confirm).not.toHaveBeenCalled();

  const write = window.localStorage.setItem.bind(window.localStorage);
  const storageFailure = vi.spyOn(window.localStorage, 'setItem').mockImplementation((key, value) => {
    if (key.includes('.chat.v1.')) throw new Error('injected checkpoint write failure');
    write(key, value);
  });
  await act(async () => {
    expect(chat.checkpoint()).toEqual({ status: 'blocked', reason: 'snapshot-write-failed' });
  });
  expect(chat.dirty).toBe(true);
  expect(warnsBeforeUnload()).toBe(true);
  expect(myPage().onBeforeOpenAdmin()).toBe(false);
  expect(confirm).toHaveBeenCalledOnce();
  expect(myPage().open).toBe(true);
  expect(input().props.value).toBe('Retained composer');
  confirm.mockReturnValueOnce(true);
  expect(myPage().onBeforeOpenAdmin()).toBe(true);
  expect(chat.dirty).toBe(true);

  storageFailure.mockRestore();
  await act(async () => { expect(chat.retry()).toEqual({ status: 'saved' }); });
  expect(chat.dirty).toBe(false);
  expect(warnsBeforeUnload()).toBe(false);
  expect(myPage().onBeforeOpenAdmin()).toBe(true);
  expect(confirm).toHaveBeenCalledTimes(2);
});

it('pauses the retained surface during settings and drops it for owner changes and sign-out', async () => {
  await act(async () => { renderer = create(<App state={state} />); });
  await act(async () => { nav().onOpenAiPlanning(); });
  await act(async () => { input().props.onChange({ target: { value: 'owner-a draft' } }); });
  await act(async () => { renderer!.root.findByType(PrimaryAppHeader).props.onOpenSettings(); });
  expect(renderer!.root.findByType(AiPlanningView).props.active).toBe(false);
  expect(aiShellActive()).toBe(false);
  await act(async () => { renderer!.root.findByType(AppSettingsDialog).props.onClose(); });
  expect(renderer!.root.findByType(AiPlanningView).props.active).toBe(true);
  expect(aiShellActive()).toBe(true);
  const render = async (user: User | null) => {
    state = { ...state, user, plannerDataAvailability: createReadyPlannerDataAvailability(user?.id ?? '') };
    await act(async () => { renderer!.update(<App state={state} />); });
  };
  await render({ id: 'owner-b' } as User);
  expect(aiShellActive()).toBe(false);
  expect(renderer!.root.findAllByType(AiPlanningView)).toHaveLength(0);
  await act(async () => { nav().onOpenAiPlanning(); });
  expect(input().props.value).toBe('');
  const subscribe = vi.spyOn(document, 'addEventListener');
  const unsubscribe = vi.spyOn(document, 'removeEventListener');
  await render(null);
  expect(renderer!.root.findAllByType(AiPlanningView)).toHaveLength(0);
  expect(renderer!.root.findByProps({ className: 'auth-stars' })).toBeDefined();
  expect(subscribe).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  await render({ id: 'owner-a' } as User);
  expect(unsubscribe).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  expect(renderer!.root.findAllByType(AiPlanningView)).toHaveLength(0);
  await act(async () => { nav().onOpenAiPlanning(); });
  expect(input().props.value).toBe('');
});


it('refreshes retained starter suggestions from the owned planner snapshot and hides unavailable targets', async () => {
  await act(async () => { renderer = create(<App state={state} />); });
  await act(async () => { nav().onOpenAiPlanning(); });
  const firstInput = input();
  await act(async () => { nav().onOpenHome(); });
  state = { ...state, todos: [{ id: 'new-todo', userId: 'owner-a', title: '追加した課題',
    status: 'open', dueDate: null, createdAt: '2026-07-14T00:00:00Z' } as TodoTask] };
  await act(async () => { renderer!.update(<App state={state} />); });
  await act(async () => { nav().onOpenAiPlanning(); });
  expect(input() === firstInput).toBe(true);
  const starters = () => renderer!.root.findByProps({ 'aria-label': '入力例' });
  expect(JSON.stringify(starters().findAllByType('span').map(node => node.children))).toContain('追加した課題');
  state = { ...state, plannerDataAvailability: { status: 'loading', ownerId: 'owner-a', observedAt: 'now', lastSuccessfulAt: null } };
  await act(async () => { renderer!.update(<App state={state} />); });
  expect(JSON.stringify(starters().findAllByType('span').map(node => node.children))).not.toContain('追加した課題');
  expect(boundary.todos).not.toHaveBeenCalled(); expect(boundary.materials).not.toHaveBeenCalled();
});
