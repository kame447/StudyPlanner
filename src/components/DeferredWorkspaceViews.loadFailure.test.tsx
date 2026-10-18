import { useState } from 'react';
import { PrimaryBottomNav } from './PrimaryBottomNav';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApplicationRouteRoot } from './ApplicationRouteRoot';
import { createFakeAuthSession } from '../test/fakeAuthSession';
import type { PlannerAppSnapshot } from './PlannerAppBootstrap';
import { createReadyPlannerDataAvailability } from '../features/weeklyPlanning/testUtils/plannerDataAvailabilityTest';
import { MemoryStorage } from '../repositories/localPersistenceConcurrency.testUtils';

const fixture = vi.hoisted(() => ({ snapshot: {} as PlannerAppSnapshot }));
vi.mock('./DayView', async () => { throw new Error('simulated Day module failure'); });
vi.mock('./TimetableView', async () => { throw new Error('simulated Timetable module failure'); });
vi.mock('./ReportView', async () => { throw new Error('simulated Report module failure'); });
vi.mock('../hooks/usePlannerAppState', () => ({ usePlannerAppState: () => { const [viewMode, setViewMode] = useState(fixture.snapshot.viewMode); return { ...fixture.snapshot, viewMode, setViewMode, openDay: () => setViewMode('day') }; } }));
vi.mock('../features/weeklyPlanning/trace/configureWeeklyPlanningTraceRepository', () => ({ isWeeklyPlanningTraceFeatureEnabled: () => false }));
vi.mock('../features/weeklyPlanning/application/useWeeklyPlanningApplication', () => ({ useWeeklyPlanningApplication: () => ({ pendingDraftBlocks: [], canEditDraftBlocks: false }) }));
vi.mock('./StudyStreakContext', () => ({ StudyStreakProvider: ({ children }: { children: import('react').ReactNode }) => children, useSharedStudyStreak: () => null }));
vi.mock('../lib/preloadAppViews', () => ({ scheduleAppViewPreload: () => () => undefined }));
vi.mock('../hooks/useThemePreference', () => ({ useThemePreference: () => ({ themeMode: 'light', themePalette: 'forest' }) }));
vi.mock('./HomeScheduleView', () => ({ HomeScheduleView: ({ onOpenDay, onOpenReport }: { onOpenDay: (date: string) => void; onOpenReport: () => void }) => <section aria-label="Home content"><button onClick={() => onOpenDay('2026-10-17')}>Open day</button><button onClick={onOpenReport}>Open report</button></section> }));
vi.mock('../services/announcementService', () => ({ listAnnouncements: vi.fn(async () => ({ items: [], nextCursor: null })), getAnnouncementReadState: vi.fn(async () => ({ through: null, items: {} })) }));
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }));
vi.mock('../lib/studySessionSwipeNavigation', () => ({ installStudySessionSwipeNavigation: () => () => {} }));
vi.mock('../lib/bottomSheetDragDismiss', () => ({ installBottomSheetDragDismiss: () => () => {} }));
let renderer: ReactTestRenderer;
let fake: ReturnType<typeof createFakeAuthSession>;
let win: ReturnType<typeof browser>;
const dialogNode = { showModal: vi.fn(), close: vi.fn() };
const backNode = { focus: vi.fn() };
function browser(initial: Record<string, unknown> = { foreign: true }) {
  const entries = [initial]; let index = 0;
  const history = { get state() { return entries[index]; }, get length() { return entries.length; },
    pushState: vi.fn((state: Record<string, unknown>) => { entries.splice(index + 1); entries.push(state); index++; }),
    replaceState: vi.fn((state: Record<string, unknown>) => { entries[index] = state; }), back: vi.fn() };
  const storage = new MemoryStorage();
  const browser = Object.assign(new EventTarget(), { location: { pathname: '/', reload: vi.fn(), assign: vi.fn() }, localStorage: storage, sessionStorage: storage,
    matchMedia: () => ({ matches: true }), requestAnimationFrame: () => 1, cancelAnimationFrame() {}, setTimeout, clearTimeout, performance, scrollTo() {}, history });
  return Object.assign(browser, { entries, pop(next: number) { act(() => { index = next; browser.dispatchEvent(new Event('popstate')); }); } });
}
function snapshot(owner = 'owner'): PlannerAppSnapshot {
  return { booting: false, user: { id: owner, username: `Fixture ${owner}`, email: `${owner}@example.test`, avatar: '', createdAt: '2026-10-17T00:00:00Z' },
    plans: [], actuals: [], monthEvents: [], todos: [], studySubjects: [], studyMaterials: [], scheduleTemplates: [], timetableTerms: [], timetablePeriods: [],
    plannerDataAvailability: createReadyPlannerDataAvailability(owner), viewMode: 'month', selectedDate: '2026-10-17', monthDate: '2026-10-01', notice: null, editorDraft: null, editingPlanId: null, editingPlan: null, pendingRecurringPlanAction: null, setViewMode: vi.fn(),
  } as unknown as PlannerAppSnapshot;
}
async function mount(initial?: Record<string, unknown>) {
  win = browser(initial); vi.stubGlobal('window', win);
  await act(async () => { renderer = create(<ApplicationRouteRoot authSession={fake.session} />, {
    createNodeMock: element => element.type === 'dialog' ? dialogNode : element.type === 'button' ? backNode : null,
  }); await vi.dynamicImportSettled(); });
}
type Entry = 'Day' | 'Timetable' | 'Report';
async function openView(entry: Entry) {
  await act(async () => {
    if (entry === 'Timetable') renderer.root.findByType(PrimaryBottomNav).props.onOpenTimetable();
    else renderer.root.findAllByType('button').find(button => button.children.includes(entry === 'Day' ? 'Open day' : 'Open report'))!.props.onClick();
    await vi.dynamicImportSettled();
  });
}
beforeEach(() => {
  vi.clearAllMocks(); fixture.snapshot = snapshot(); fake = createFakeAuthSession();
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('document', Object.assign(new EventTarget(), { documentElement: { dataset: {}, style: {} }, body: { style: {} }, visibilityState: 'visible' }));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network forbidden'); }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const failure = (entry: Entry) => ({ Day: 'この日の予定', Timetable: '時間割', Report: '学習レポート' })[entry] + 'を読み込めませんでした。';
it.each(['Day', 'Timetable', 'Report'] as const)('retains app/auth/history owners after %s rejection and cached reentry', async entry => {
  await mount();
  const navigation = renderer.root.findByType(PrimaryBottomNav);
  const remove = vi.spyOn(win, 'removeEventListener');
  const before = JSON.stringify(fixture.snapshot);
  for (let visit = 0; visit < 2; visit++) {
    await openView(entry);
    expect(renderer.root.findByType(PrimaryBottomNav)).toBe(navigation);
    expect(renderer.root.findByProps({ role: 'alert' }).children).toEqual([failure(entry)]);
    expect(renderer.root.findAllByType('button').some(node => node.children.includes('再読み込み'))).toBe(false);
    act(() => navigation.props.onOpenHome());
    expect(renderer.root.findByProps({ 'aria-label': 'Home content' })).toBeDefined();
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  }
  win.pop(0);
  expect(renderer.root.findByProps({ 'aria-label': 'Home content' })).toBeDefined();
  expect(win.history.state).toEqual({ foreign: true });
  expect(remove.mock.calls.some(([type]) => type === 'popstate')).toBe(false);
  expect(fake.session.subscribe).toHaveBeenCalledOnce();
  expect(fake.unsubscribe).not.toHaveBeenCalled();
  expect(fake.session.signOut).not.toHaveBeenCalled();
  expect(win.location.reload).not.toHaveBeenCalled();
  expect(win.location.assign).not.toHaveBeenCalled();
  expect(JSON.stringify(fixture.snapshot)).toBe(before);
});

it('keeps independent failure states while navigating between views and replacing the owner', async () => {
  await mount(); await openView('Report');
  const navigation = renderer.root.findByType(PrimaryBottomNav);
  await act(async () => { navigation.props.onOpenTimetable(); await vi.dynamicImportSettled(); });
  expect(renderer.root.findByProps({ role: 'alert' }).children).toEqual([failure('Timetable')]);
  fixture.snapshot = snapshot('other');
  await act(async () => fake.emit({ id: 'other', requiresEmailVerification: false }));
  expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  expect(renderer.root.findByProps({ 'aria-label': 'Home content' })).toBeDefined();
  await openView('Day');
  expect(renderer.root.findByProps({ role: 'alert' }).children).toEqual([failure('Day')]);
  fixture.snapshot = { ...fixture.snapshot, user: null };
  await act(async () => fake.emit(null));
  expect(renderer.root.findAllByType(PrimaryBottomNav)).toHaveLength(0);
  expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  expect(renderer.root.findByProps({ type: 'email' })).toBeDefined();
  expect(fake.unsubscribe).not.toHaveBeenCalled();
  expect(win.location.reload).not.toHaveBeenCalled();
});
