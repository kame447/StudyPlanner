import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationRouteRoot } from './ApplicationRouteRoot';
import { createFakeAuthSession } from '../test/fakeAuthSession';
import type { PlannerAppSnapshot } from './PlannerAppBootstrap';
import { createReadyPlannerDataAvailability } from '../features/weeklyPlanning/testUtils/plannerDataAvailabilityTest';
import { getAnnouncementReadState, listAnnouncements } from '../services/announcementService';
import { MemoryStorage } from '../repositories/localPersistenceConcurrency.testUtils';

const fixture = vi.hoisted(() => ({ snapshot: {} as PlannerAppSnapshot }));
vi.mock('./AnnouncementsPage', async () => { throw new Error('simulated announcement module failure'); });
vi.mock('../hooks/usePlannerAppState', () => ({ usePlannerAppState: () => fixture.snapshot }));
vi.mock('../features/weeklyPlanning/trace/configureWeeklyPlanningTraceRepository', () => ({ isWeeklyPlanningTraceFeatureEnabled: () => false }));
vi.mock('../features/weeklyPlanning/application/useWeeklyPlanningApplication', () => ({ useWeeklyPlanningApplication: () => ({ pendingDraftBlocks: [], canEditDraftBlocks: false }) }));
vi.mock('./StudyStreakContext', () => ({ StudyStreakProvider: ({ children }: { children: import('react').ReactNode }) => children, useSharedStudyStreak: () => null }));
vi.mock('../lib/preloadAppViews', () => ({ scheduleAppViewPreload: () => () => undefined }));
vi.mock('../hooks/useThemePreference', () => ({ useThemePreference: () => ({ themeMode: 'light', themePalette: 'forest' }) }));
vi.mock('./HomeScheduleView', () => ({ HomeScheduleView: () => <section aria-label="Home content" /> }));
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
async function open() {
  await act(async () => { renderer.root.findByProps({ 'aria-label': 'お知らせを開く' }).props.onClick({ currentTarget: backNode }); await vi.dynamicImportSettled(); });
}
const back = () => renderer.root.findByType('dialog').findByType('button');
const home = () => renderer.root.findByProps({ 'aria-label': 'Home content' });
beforeEach(() => {
  vi.clearAllMocks(); fixture.snapshot = snapshot(); fake = createFakeAuthSession();
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('document', Object.assign(new EventTarget(), { documentElement: { dataset: {}, style: {} }, body: { style: {} }, visibilityState: 'visible' }));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network forbidden'); }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('announcement delivery failure under the actual application root', () => {
  it('keeps Home mounted, closes once through history and remains recoverable on cached Forward/reopen', async () => {
    await mount(); const retainedHome = home();
    await open();
    expect(home()).toBe(retainedHome);
    expect(renderer.root.findByProps({ role: 'alert' }).children).toEqual(['お知らせを読み込めませんでした。']);
    expect(dialogNode.showModal).toHaveBeenCalledOnce();
    expect(backNode.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(back().children).toEqual(['ホームへ戻る']);
    expect(win.history.state).toEqual({ foreign: true, laplanceAnnouncements: { owner: 'owner', detailId: null } });
    act(() => { back().props.onClick(); back().props.onClick(); });
    expect(win.history.back).toHaveBeenCalledOnce();
    expect(renderer.root.findAllByType('dialog')).toHaveLength(1);
    win.pop(0);
    expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
    expect(dialogNode.close).toHaveBeenCalledOnce();
    expect(home()).toBe(retainedHome);
    await act(async () => win.pop(1));
    expect(renderer.root.findByProps({ role: 'alert' })).toBeDefined();
    const preventDefault = vi.fn();
    act(() => renderer.root.findByType('dialog').props.onCancel({ preventDefault }));
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(win.history.back).toHaveBeenCalledTimes(2);
    win.pop(0); await open();
    expect(home()).toBe(retainedHome);
    expect(renderer.root.findAllByType('dialog')).toHaveLength(1);
    expect(listAnnouncements).toHaveBeenCalledOnce();
    expect(getAnnouncementReadState).toHaveBeenCalledOnce();
    expect(fake.unsubscribe).not.toHaveBeenCalled();
    expect(fake.session.signOut).not.toHaveBeenCalled();
    expect(win.location.reload).not.toHaveBeenCalled();
    expect(win.location.assign).not.toHaveBeenCalled();
  });

  it('drops the failed old-owner surface and prevents its retained Back action closing a new owner', async () => {
    await mount(); await open(); const oldBack = back().props.onClick;
    fixture.snapshot = snapshot('other');
    await act(async () => { fake.emit({ id: 'other', requiresEmailVerification: false }); await vi.dynamicImportSettled(); });
    expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
    expect(dialogNode.close).toHaveBeenCalledOnce();
    await open();
    expect(win.history.state).toEqual({ foreign: true, laplanceAnnouncements: { owner: 'other', detailId: null } });
    act(() => oldBack());
    expect(renderer.root.findAllByType('dialog')).toHaveLength(1);
    expect(win.history.back).not.toHaveBeenCalled();
    win.pop(1);
    expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
    expect(home()).toBeDefined();
  });

  it('clears an orphaned restored detail entry without navigating away or losing foreign history', async () => {
    await mount({ foreign: true, laplanceAnnouncements: { owner: 'owner', detailId: 'notice' } });
    expect(back().children).toEqual(['お知らせ一覧へ戻る']);
    act(() => back().props.onClick());
    expect(win.history.state).toEqual({ foreign: true });
    expect(win.history.back).not.toHaveBeenCalled();
    expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
    expect(home()).toBeDefined();
  });
});
