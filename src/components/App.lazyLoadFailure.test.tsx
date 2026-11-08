import { forwardRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../App';
import { PrimaryAppHeader } from './PrimaryAppHeader';
import type { PlannerAppSnapshot } from './PlannerAppBootstrap';
import { createReadyPlannerDataAvailability } from '../features/weeklyPlanning/testUtils/plannerDataAvailabilityTest';
import { MemoryStorage } from '../repositories/localPersistenceConcurrency.testUtils';

vi.mock('../repositories', () => ({ plannerRepository: {} }));
vi.mock('./StudyStreakContext', () => ({ StudyStreakProvider: ({ children }: { children: import('react').ReactNode }) => children, useSharedStudyStreak: () => null }));
vi.mock('../features/weeklyPlanning/application/useWeeklyPlanningConversationApplication', () => ({ useWeeklyPlanningConversationApplication: () => ({ pendingDraftBlocks: [], canEditDraftBlocks: false }) }));
vi.mock('../lib/preloadAppViews', () => ({ scheduleAppViewPreload: () => () => undefined }));
vi.mock('../hooks/useThemePreference', () => ({ useThemePreference: () => ({ themeMode: 'light', themePalette: 'forest' }) }));
vi.mock('./PrimaryAppHeader', () => ({ PrimaryAppHeader: forwardRef(() => <header />) }));
vi.mock('./HomeScheduleView', () => ({ HomeScheduleView: () => <section aria-label="Home content" /> }));
vi.mock('./ScheduleToolbar', () => ({ ScheduleToolbar: () => null }));
vi.mock('./PlanEditorPanel', async () => { throw new Error('simulated chunk delivery failure'); });
vi.mock('./MyPageDialog', () => ({ MyPageDialog: () => null }));
vi.mock('./AppSettingsDialog', async () => { throw new Error('simulated chunk delivery failure'); });
let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function stubBrowser() {
  vi.stubGlobal('window', { location: { pathname: '/', reload: vi.fn() }, localStorage: new MemoryStorage(),
    matchMedia: () => ({ matches: true }), requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    addEventListener() {}, removeEventListener() {}, scrollTo() {}, setTimeout, clearTimeout, performance,
    history: { state: {}, length: 1, pushState() {}, replaceState() {} } });
  window.localStorage.setItem('laplance-first-run-tour-v1:owner', 'done');
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('document', Object.assign(new EventTarget(), { documentElement: { dataset: {}, style: {} }, body: { style: {} }, visibilityState: 'visible' }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
}

function snapshotWith(overrides: Record<string, unknown>) {
  return { booting: false, user: { id: 'owner' }, plans: [], actuals: [], monthEvents: [], todos: [], studySubjects: [], studyMaterials: [],
    scheduleTemplates: [], timetableTerms: [], timetablePeriods: [], plannerDataAvailability: createReadyPlannerDataAvailability('owner'),
    viewMode: 'month', selectedDate: '2026-10-16', monthDate: '2026-10-01', notice: null, editorDraft: null, editingPlanId: null,
    editingPlan: null, pendingRecurringPlanAction: null, setViewMode: vi.fn(), closePlanEditor: vi.fn(), ...overrides,
  } as unknown as PlannerAppSnapshot;
}

it('keeps the app and guides a reload when the plan editor chunk fails to load', async () => {
  stubBrowser();
  const closePlanEditor = vi.fn();
  const draft = { title: '', date: '2026-10-16', startTime: '09:00', endTime: '10:00' };
  await act(async () => { renderer = create(<App state={snapshotWith({ editorDraft: draft, closePlanEditor })} />); await vi.dynamicImportSettled(); });
  expect(renderer.toJSON()).not.toBeNull();
  expect(renderer.root.findByProps({ role: 'alert' }).findByType('p').children.join('')).toContain('再読み込み');
  expect(renderer.root.findByProps({ 'aria-label': 'Home content' })).toBeDefined();
  act(() => renderer.root.findByProps({ role: 'alert' }).findByType('button').props.onClick());
  expect(closePlanEditor).toHaveBeenCalledTimes(1);
});

it('keeps the app and guides a reload when the settings chunk fails to load', async () => {
  stubBrowser();
  await act(async () => { renderer = create(<App state={snapshotWith({})} />); });
  await act(async () => { renderer.root.findByType(PrimaryAppHeader).props.onOpenSettings(); await vi.dynamicImportSettled(); });
  expect(renderer.toJSON()).not.toBeNull();
  expect(renderer.root.findByProps({ role: 'alert' }).findByType('p').children.join('')).toContain('再読み込み');
  act(() => renderer.root.findByProps({ role: 'alert' }).findByType('button').props.onClick());
  expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
});
