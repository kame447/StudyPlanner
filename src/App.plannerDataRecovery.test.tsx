import { forwardRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { PlannerDataRecoveryNotice } from './components/PlannerDataRecoveryNotice';
import { PrimaryBottomNav } from './components/PrimaryBottomNav';
import type { usePlannerAppState } from './hooks/usePlannerAppState';
import type { User } from './types/domain';

const fixture = vi.hoisted(() => ({
  state: {} as Partial<ReturnType<typeof usePlannerAppState>>,
  application: vi.fn(() => ({ pendingDraftBlocks: [], canEditDraftBlocks: false })),
}));
vi.mock('./hooks/usePlannerAppState', () => ({ usePlannerAppState: () => fixture.state }));
vi.mock('./features/weeklyPlanning/application/useWeeklyPlanningApplication', () => ({ useWeeklyPlanningApplication: fixture.application }));
vi.mock('./hooks/useThemePreference', () => ({ useThemePreference: () => ({ themeMode: 'light', themePalette: 'forest' }) }));
vi.mock('./lib/appAccessGate', () => ({ isAppAccessGateEnabled: () => false, hasStoredAppAccessGrant: () => true, verifyAndStoreAppAccessKey: () => true }));
vi.mock('./components/PrimaryAppHeader', () => ({ PrimaryAppHeader: forwardRef(() => <header />) }));
vi.mock('./components/HomeScheduleView', () => ({ HomeScheduleView: () => <div className="home-dashboard home-dashboard-default" /> }));
vi.mock('./components/AiPlanningView', () => ({ AiPlanningView: () => <div className="ai-planning-view home-dashboard" /> }));
vi.mock('./components/MonthView', () => ({ MonthView: () => <div className="schedule-month-view" /> }));
vi.mock('./components/ScheduleToolbar', () => ({ ScheduleToolbar: () => <div className="schedule-toolbar" /> }));
vi.mock('./components/QuickAddMenu', () => ({ QuickAddMenu: () => null }));
vi.mock('./components/PlanEditorPanel', () => ({ PlanEditorPanel: () => null }));
vi.mock('./components/MyPageDialog', () => ({ MyPageDialog: () => null }));
vi.mock('./components/AppSettingsDialog', () => ({ AppSettingsDialog: () => null }));

let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal('window', { location: { pathname: '/' } });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network forbidden by fixture'); }));
  fixture.application.mockClear();
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
