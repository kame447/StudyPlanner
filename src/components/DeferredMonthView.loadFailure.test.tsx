import { forwardRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../App';
import { PrimaryBottomNav } from './PrimaryBottomNav';
import type { PlannerAppSnapshot } from './PlannerAppBootstrap';
import { createReadyPlannerDataAvailability } from '../features/weeklyPlanning/testUtils/plannerDataAvailabilityTest';
import { MemoryStorage } from '../repositories/localPersistenceConcurrency.testUtils';

vi.mock('./MonthView', async () => { throw new Error('simulated chunk delivery failure'); });
vi.mock('../repositories', () => ({ plannerRepository: {} }));
vi.mock('./StudyStreakContext', () => ({ StudyStreakProvider: ({ children }: { children: import('react').ReactNode }) => children, useSharedStudyStreak: () => null }));
vi.mock('../features/weeklyPlanning/application/useWeeklyPlanningApplication', () => ({ useWeeklyPlanningApplication: () => ({ pendingDraftBlocks: [], canEditDraftBlocks: false }) }));
vi.mock('../lib/preloadAppViews', () => ({ scheduleAppViewPreload: () => () => undefined }));
vi.mock('../hooks/useThemePreference', () => ({ useThemePreference: () => ({ themeMode: 'light', themePalette: 'forest' }) }));
vi.mock('./PrimaryAppHeader', () => ({ PrimaryAppHeader: forwardRef(() => <header />) }));
vi.mock('./HomeScheduleView', () => ({ HomeScheduleView: () => <section aria-label="Home content" /> }));
vi.mock('./ScheduleToolbar', () => ({ ScheduleToolbar: () => null }));
vi.mock('./PlanEditorPanel', () => ({ PlanEditorPanel: () => null }));
vi.mock('./MyPageDialog', () => ({ MyPageDialog: () => null }));
vi.mock('./AppSettingsDialog', () => ({ AppSettingsDialog: () => null }));
let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('keeps the actual app Home navigation after chunk rejection without reloading or mutating data', async () => {
  const reload = vi.fn(), save = vi.fn();
  vi.stubGlobal('window', { location: { pathname: '/', reload }, localStorage: new MemoryStorage(),
    matchMedia: () => ({ matches: true }), requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout, performance,
    history: { state: {}, length: 1, pushState() {}, replaceState() {} } });
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('document', Object.assign(new EventTarget(), { documentElement: { dataset: {}, style: {} }, body: { style: {} }, visibilityState: 'visible' }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const snapshot = { booting: false, user: { id: 'owner' }, plans: [], actuals: [], monthEvents: [], todos: [], studySubjects: [], studyMaterials: [],
    scheduleTemplates: [], timetableTerms: [], timetablePeriods: [], plannerDataAvailability: createReadyPlannerDataAvailability('owner'),
    viewMode: 'month', selectedDate: '2026-10-16', monthDate: '2026-10-01', notice: null, editorDraft: null, editingPlanId: null,
    editingPlan: null, pendingRecurringPlanAction: null, setViewMode: vi.fn(), saveMonthEvent: save, deleteMonthEvent: save,
  } as unknown as PlannerAppSnapshot;
  await act(async () => { renderer = create(<App state={snapshot} />); });
  const navigation = renderer.root.findByType(PrimaryBottomNav);
  await act(async () => { navigation.props.onOpenSchedule(); await vi.dynamicImportSettled(); });
  expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toBe('月の予定を読み込めませんでした。');
  expect(renderer.root.findAllByType('button').some(node => node.children.includes('再読み込み'))).toBe(false);
  act(() => navigation.props.onOpenHome());
  expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  expect(renderer.root.findByProps({ 'aria-label': 'Home content' })).toBeDefined();
  expect(reload).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});
