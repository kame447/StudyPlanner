import { forwardRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { FirstRunTutorial } from './components/FirstRunTutorial';
import { HomeScheduleView } from './components/HomeScheduleView';
import { PrimaryAppHeader } from './components/PrimaryAppHeader';
import { PrimaryBottomNav } from './components/PrimaryBottomNav';
import { AppSettingsDialog } from './components/AppSettingsDialog';
import type { PlannerAppSnapshot } from './components/PlannerAppBootstrap';
import { createMemoryStorageHarness } from './features/weeklyPlanning/testUtils/weeklyPlanningApplicationTestHarness';
import { createReadyPlannerDataAvailability } from './features/weeklyPlanning/testUtils/plannerDataAvailabilityTest';
import type { User } from './types/domain';

vi.mock('./components/StudyStreakContext', () => ({ StudyStreakProvider: ({ children }: { children: import('react').ReactNode }) => children, useSharedStudyStreak: () => null }));
vi.mock('./repositories', () => ({ plannerRepository: { getTodos: async () => [], getStudyMaterials: async () => [] } }));
vi.mock('./lib/preloadAppViews', () => ({ scheduleAppViewPreload: () => () => undefined }));
vi.mock('./hooks/useThemePreference', () => ({ useThemePreference: () => ({ themeMode: 'light', themePalette: 'forest' }) }));
vi.mock('./components/PrimaryAppHeader', () => ({ PrimaryAppHeader: forwardRef(() => <header />) }));
vi.mock('./components/HomeScheduleView', () => ({ HomeScheduleView: () => <section aria-label="Home" /> }));
vi.mock('./components/ScheduleToolbar', () => ({ ScheduleToolbar: () => null }));
vi.mock('./components/PlanEditorPanel', () => ({ PlanEditorPanel: () => null }));
vi.mock('./components/MyPageDialog', () => ({ MyPageDialog: () => null }));
vi.mock('./components/AppSettingsDialog', () => ({ AppSettingsDialog: () => null }));

let renderer: ReactTestRenderer | undefined;
let state: PlannerAppSnapshot;
const tour = () => renderer!.root.findAllByType(FirstRunTutorial);
const render = async () => { await act(async () => { if (renderer) renderer.update(<App state={state} />); else renderer = create(<App state={state} />); }); };

beforeEach(() => {
  const { storage } = createMemoryStorageHarness();
  vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { pathname: '/' }, localStorage: storage, sessionStorage: storage,
    matchMedia: () => ({ matches: true }), requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    setTimeout, clearTimeout, performance, scrollTo() {},
    history: { state: {}, length: 1, pushState() {}, replaceState() {} } }));
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('document', Object.assign(new EventTarget(), { documentElement: { dataset: {}, style: {} }, body: { style: {} }, visibilityState: 'visible' }));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network forbidden'); }));
  vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'false');
  state = {
    booting: false, user: { id: 'first-owner' } as User,
    plans: [], actuals: [], monthEvents: [], todos: [], studySubjects: [], studyMaterials: [],
    scheduleTemplates: [], timetableTerms: [], timetablePeriods: [],
    plannerDataAvailability: createReadyPlannerDataAvailability('first-owner'), isPlannerDataSnapshotCurrent: () => true,
    viewMode: 'month', selectedDate: '2026-10-30', monthDate: '2026-10-01', notice: null,
    editorDraft: null, editingPlanId: null, editingPlan: null, pendingRecurringPlanAction: null,
    setViewMode: vi.fn(), saveWeeklyApprovedPlan: vi.fn(),
  } as unknown as PlannerAppSnapshot;
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('waits for a successful owned data read, then lets a new user dismiss the introduction without creating data', async () => {
  state = { ...state, plannerDataAvailability: { status: 'loading', ownerId: 'first-owner', observedAt: '2026-10-30T00:00:00Z', lastSuccessfulAt: null } };
  await render();
  expect(tour()).toHaveLength(0);
  state = { ...state, plannerDataAvailability: createReadyPlannerDataAvailability('first-owner') };
  await render();
  expect(tour()).toHaveLength(1);
  await act(async () => { tour()[0].props.onFinish(); });
  expect(tour()).toHaveLength(0);
  expect(renderer!.root.findByType(HomeScheduleView)).toBeDefined();
  expect(state.plans).toHaveLength(0);
  await render();
  expect(tour()).toHaveLength(0);
});

it('does not interrupt existing users, even if they later clear their data', async () => {
  state = { ...state, monthEvents: [{ id: 'fixed-schedule' }] as PlannerAppSnapshot['monthEvents'] };
  await render();
  expect(tour()).toHaveLength(0);
  state = { ...state, monthEvents: [] };
  await render();
  expect(tour()).toHaveLength(0);
});

it('shows the tour even when the loader has generated an empty default timetable term', async () => {
  state = { ...state, timetableTerms: [{ id: 'default-term', kind: 'fullYear' }] as PlannerAppSnapshot['timetableTerms'] };
  await render();
  expect(tour()).toHaveLength(1);
});

it('treats user-configured timetable data as an existing account', async () => {
  state = { ...state, timetableTerms: [{ id: 'custom-term', kind: 'custom' }] as PlannerAppSnapshot['timetableTerms'] };
  await render();
  expect(tour()).toHaveLength(0);
  state = { ...state, timetableTerms: [] };
  await render();
  expect(tour()).toHaveLength(0);
});

it('keeps completion account-specific, and permits replay from settings without resetting progress', async () => {
  await render();
  await act(async () => { tour()[0].props.onFinish(); });
  await act(async () => { renderer!.root.findByType(PrimaryAppHeader).props.onOpenSettings(); });
  await act(async () => { renderer!.root.findByType(AppSettingsDialog).props.onShowTutorial(); });
  expect(tour()).toHaveLength(1);
  await act(async () => { tour()[0].props.onFinish(); });
  expect(tour()).toHaveLength(0);
  state = { ...state, user: { id: 'another-owner' } as User,
    plannerDataAvailability: createReadyPlannerDataAvailability('another-owner') };
  await render();
  expect(tour()).toHaveLength(1);
});

it('lets users finish with AI planning without needing a study record', async () => {
  await render();
  await act(async () => { tour()[0].props.onOpenAiPlanning(); });
  expect(tour()).toHaveLength(0);
  expect(renderer!.root.findByType(PrimaryBottomNav).props.active).toBe('ai-planning');
  expect(state.actuals).toHaveLength(0);
});
