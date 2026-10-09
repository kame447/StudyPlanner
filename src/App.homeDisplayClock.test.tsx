import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { PrimaryBottomNav } from './components/PrimaryBottomNav';
import { PlanEditorPanel } from './components/PlanEditorPanel';
import { ScheduleToolbar } from './components/ScheduleToolbar';
import type { PlannerAppSnapshot } from './components/PlannerAppBootstrap';
import { usePlannerDataState, type UsePlannerDataStateResult } from './hooks/usePlannerDataState';
import { createLocalFixture, MemoryStorage, plan } from './repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from './repositories/repositoryContracts';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository,
  weeklyPlanning: vi.fn(() => ({ pendingDraftBlocks: [], canEditDraftBlocks: false })) }));
vi.mock('./repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
}) }));
vi.mock('./features/weeklyPlanning/application/useWeeklyPlanningApplication', () => ({ useWeeklyPlanningApplication: boundary.weeklyPlanning }));
vi.mock('./lib/preloadAppViews', () => ({ scheduleAppViewPreload: () => () => undefined }));
vi.mock('./hooks/useThemePreference', () => ({ useThemePreference: () => ({ themeMode: 'light', themePalette: 'forest' }) }));
vi.mock('./components/MyPageDialog', () => ({ MyPageDialog: () => null }));
vi.mock('./components/AppSettingsDialog', () => ({ AppSettingsDialog: () => null }));

let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer | undefined;
let storage: MemoryStorage;
let browserDocument: EventTarget & { visibilityState: string };
function Harness() {
  state = usePlannerDataState({ userId: 'owner', showNotice: () => {} });
  const unused = async (): Promise<never> => { throw new Error('outside display-clock test'); };
  const snapshot: PlannerAppSnapshot = {
    ...state, user: { id: 'owner', username: 'Clock', email: 'clock@example.test', avatar: '', createdAt: '' }, booting: false, notice: null, dismissNotice() {},
    signUpWithPassword: unused, signInWithPassword: unused, signInWithGoogle: unused,
    sendPasswordReset: unused, saveUserProfile: unused, signOut: unused,
    saveWeeklyApprovedPlan: unused, completeWeeklyApprovalOperation: unused,
  };
  return <App state={snapshot} />;
}
beforeEach(async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-07T23:59:30'));
  storage = new MemoryStorage();
  const browserWindow = Object.assign(new EventTarget(), {
    location: { pathname: '/' }, localStorage: storage,
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false }), setTimeout, clearTimeout,
  });
  browserDocument = Object.assign(new EventTarget(), { documentElement: { dataset: {} }, visibilityState: 'visible', fonts: { ready: Promise.resolve() },
    body: { style: { overflow: '', overscrollBehavior: '' } } });
  vi.stubGlobal('window', browserWindow); vi.stubGlobal('document', browserDocument);
  vi.stubGlobal('HTMLElement', class {}); vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network forbidden'); }));
  const fixture = createLocalFixture(storage);
  await fixture.repository.upsertPlan(plan({ id: 'late', seriesId: 'late', date: '2026-10-07', title: 'Yesterday', startTime: '23:00', endTime: '24:00' }));
  await fixture.repository.upsertPlan(plan({ id: 'morning', seriesId: 'morning', date: '2026-10-08', title: 'Today', startTime: '08:00', endTime: '09:00' }));
  boundary.repository = fixture.repository;
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner'); state.selectDate('2027-02-16'); });
});
afterEach(() => {
  act(() => renderer?.unmount()); renderer = undefined;
  expect(vi.getTimerCount()).toBe(0);
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

it('keeps selected planner month/date and an open unsaved draft while Home and its persistent header advance', async () => {
  await act(async () => renderer!.root.findByType(PrimaryBottomNav).props.onOpenSchedule());
  act(() => state.openCreatePlan());
  act(() => renderer!.root.findByType(PlanEditorPanel).props.onChange({ ...state.editorDraft!, title: 'Unsaved future plan' }));
  const draft = state.editorDraft;
  const storedPlans = await boundary.repository.getPlans('owner');
  const plansReference = state.plans;
  const write = vi.spyOn(storage, 'setItem');
  boundary.weeklyPlanning.mockClear();

  act(() => { vi.advanceTimersByTime(30_000); });
  expect(renderer!.root.findByProps({ className: 'home-date-display' }).props.dateTime).toBe('2026-10-08');
  expect(state.selectedDate).toBe('2027-02-16');
  expect(state.monthDate).toBe('2027-02-01');
  expect(renderer!.root.findByType(ScheduleToolbar).props.selectedDate).toBe('2027-02-16');
  expect(state.editorDraft).toBe(draft);
  expect(renderer!.root.findByType(PlanEditorPanel).props.draft).toBe(draft);
  expect(state.plans).toBe(plansReference);
  expect(write).not.toHaveBeenCalled();
  expect(boundary.weeklyPlanning).not.toHaveBeenCalled();

  // The shell stays mounted when Home is re-entered. Its display and header must agree.
  act(() => renderer!.root.findByType(PlanEditorPanel).props.onCancel());
  await act(async () => renderer!.root.findByType(PrimaryBottomNav).props.onOpenHome());
  expect(renderer!.root.findByProps({ className: 'home-date-display' }).props.dateTime).toBe('2026-10-08');
  expect(renderer!.root.findByProps({ 'data-home-section': 'next-plan' }).findByProps({ className: 'home-plan-title' }).findByType('span').children.join('')).toBe('Today');
  expect(state.selectedDate).toBe('2027-02-16');
  expect(state.monthDate).toBe('2027-02-01');
  expect(await boundary.repository.getPlans('owner')).toEqual(storedPlans);

  browserDocument.visibilityState = 'hidden';
  act(() => { browserDocument.dispatchEvent(new Event('visibilitychange')); });
  expect(vi.getTimerCount()).toBe(0);
  vi.setSystemTime(new Date('2026-10-09T08:00:00'));
  browserDocument.visibilityState = 'visible';
  act(() => { browserDocument.dispatchEvent(new Event('visibilitychange')); });
  expect(renderer!.root.findByProps({ className: 'home-date-display' }).props.dateTime).toBe('2026-10-09');
  expect(state.selectedDate).toBe('2027-02-16');
  expect(state.monthDate).toBe('2027-02-01');
  expect(write).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(1);
});
