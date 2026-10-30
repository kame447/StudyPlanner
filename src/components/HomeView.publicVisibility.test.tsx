import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { HomeView } from './HomeView';
import { PublicPageNavigationContext } from './PublicPageLink';

vi.mock('./home/HomeDisplayClockContext', () => ({ useHomeDisplayClock: () => new Date('2026-10-13T10:00:00Z') }));
vi.mock('./home/useHomeTextReflow', () => ({ useHomeTextReflow: () => 16 }));
vi.mock('../lib/homeDashboard', () => ({ buildHomeDashboardModel: ({ plans }: any) => ({ todayPlans: plans, upcomingPlans: [] }) }));
vi.mock('./home/HomeSections', () => ({
  DEFAULT_HOME_SECTION_ORDER: ['next-plan', 'today-schedule', 'attention'],
  AttentionSection: () => null, GettingStartedSection: () => null, MaterialProgressSection: () => null,
  NextPlanSection: () => null, TodayScheduleSection: () => null,
}));
vi.mock('./home/WeeklyProgressSection', () => ({ WeeklyProgressSection: () => null }));
let renderer: ReactTestRenderer | undefined;
let visible: boolean;
let frames: Map<number, () => void>;
let fontReady: Array<() => void>;
let core: Element;
let header: Element;
let nav: Element;
let dashboard: Element;
let materialProbe: Element;
let props: ComponentProps<typeof HomeView>;
class Element {
  dataset: Record<string, string> = {};
  values = new Map<string, string>();
  style = { [Symbol.iterator]: () => this.values.keys(), getPropertyValue: (key: string) => this.values.get(key) ?? '',
    setProperty: vi.fn((key: string, value: string) => { this.values.set(key, value); }),
    removeProperty: vi.fn((key: string) => { this.values.delete(key); }) };
  children: Element[] = [];
  offsetHeight = 100; clientHeight = 100; scrollHeight = 100;
  elements = new Map<string, Element>();
  constructor(private top = 100, private height = 100) {}
  getBoundingClientRect = vi.fn(() => ({ top: visible ? this.top : 0, height: visible ? this.height : 0 }));
  getClientRects = () => visible ? [this.getBoundingClientRect()] : [];
  querySelector = (query: string) => this.elements.get(query) ?? null;
  querySelectorAll = () => [];
  closest = () => dashboard;
}
function render(publicOpen: boolean, planCount = 1) {
  const element = <PublicPageNavigationContext.Provider value={{ isPublicPage: publicOpen, navigate: vi.fn() }}>
    <HomeView {...props} plans={Array.from({ length: planCount }, () => ({} as any))} />
  </PublicPageNavigationContext.Provider>;
  act(() => {
    if (renderer) renderer.update(element);
    else renderer = create(element, { createNodeMock: element => element.props.className === 'home-core-sections' ? core : element.props.className === 'home-material-measurement' ? materialProbe : null });
  });
}
function flush() {
  act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); });
}
beforeEach(() => {
  visible = true; frames = new Map(); fontReady = []; let frameId = 0;
  materialProbe = new Element(0, 100);
  core = new Element(); header = new Element(); nav = new Element(200); dashboard = new Element();
  const today = new Element(); today.elements.set('.home-schedule-list', new Element());
  core.elements.set('[data-home-section="today-schedule"]', today);
  core.elements.set('[data-home-section="next-plan"]', new Element());
  core.elements.set('[data-home-section="attention"]', new Element());
  header.elements.set('.home-topbar', new Element());
  props = { plans: [], actuals: [], todos: [], studyMaterials: [], primaryHeaderRef: { current: header as any },
    primaryBottomNavRef: { current: nav as any }, onOpenAiPlanning: vi.fn(), onOpenSchedule: vi.fn(),
    onAddEntry: vi.fn(), onOpenDay: vi.fn(), onOpenTodo: vi.fn(), onOpenBookshelf: vi.fn(), onOpenReport: vi.fn() };
  vi.stubGlobal('HTMLElement', Element);
  vi.stubGlobal('window', { innerWidth: 390, innerHeight: 844,
    requestAnimationFrame: (callback: () => void) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), getComputedStyle: () => ({ rowGap: '0' }),
  });
  vi.stubGlobal('document', { fonts: { ready: { then: (callback: () => void) => { fontReady.push(callback); } } } });
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

it.each([390, 1280])('does not measure hidden zero-sized geometry at %ipx', (width) => {
  window.innerWidth = width;
  visible = false; render(false); flush();
  expect(core.getBoundingClientRect).not.toHaveBeenCalled();
  expect(header.dataset.homeChromeViewport).toBeUndefined();
  expect(dashboard.style.setProperty).not.toHaveBeenCalled();
  expect(header.style.setProperty).not.toHaveBeenCalled();
});

it('retains layout while public content is open and measures again on return without resize', () => {
  render(false); flush();
  expect(header.dataset.homeChromeViewport).toBe('390x844');
  const instance = renderer!.root.findByType(HomeView);
  core.getBoundingClientRect.mockClear(); dashboard.style.setProperty.mockClear(); header.style.setProperty.mockClear();
  visible = false; render(true, 2); flush();
  expect(core.getBoundingClientRect).not.toHaveBeenCalled();
  expect(dashboard.style.setProperty).not.toHaveBeenCalled();
  expect(header.style.setProperty).not.toHaveBeenCalled();
  act(() => fontReady.forEach(callback => callback()));
  expect(frames.size).toBe(0); // A stale font-ready callback cannot restart hidden measurement.
  visible = true; render(false, 2); flush();
  expect(core.getBoundingClientRect).toHaveBeenCalled();
  expect(renderer!.root.findByType(HomeView)).toBe(instance);
  expect(header.dataset.homeChromeViewport).toBe('390x844');
  act(() => renderer!.unmount()); renderer = undefined;
  act(() => fontReady.forEach(callback => callback()));
  expect(frames.size).toBe(0);
});


it.each([1280, 1440, 1920])('uses desktop columns without the compact height fit at %ipx', (width) => {
  window.innerWidth = width;
  dashboard.values.set('--home-relax-hero', '90px');
  dashboard.values.set('--home-dynamic-schedule-max', '40px');
  dashboard.values.set('--unrelated-token', 'keep');
  header.values.set('--home-relax-topbar', '20px');
  header.dataset.homeChromeViewport = '390x844';
  render(false); flush();
  expect(dashboard.values.has('--home-relax-hero')).toBe(false);
  expect(dashboard.values.has('--home-dynamic-schedule-max')).toBe(false);
  expect(dashboard.values.get('--unrelated-token')).toBe('keep');
  expect(header.values.has('--home-relax-topbar')).toBe(false);
  expect(header.dataset.homeChromeViewport).toBeUndefined();
  expect(dashboard.style.setProperty).not.toHaveBeenCalled();
  expect(core.getBoundingClientRect).toHaveBeenCalledTimes(1); // Visibility only, no vertical stack arithmetic.
});

it('resumes the compact fit when a desktop Home returns to a phone viewport', () => {
  window.innerWidth = 1280;
  render(false); flush();
  const instance = renderer!.root.findByType(HomeView);
  window.innerWidth = 390;
  const resizeListeners = vi.mocked(window.addEventListener).mock.calls.filter(call => call[0] === 'resize');
  const onResize = resizeListeners[resizeListeners.length - 1][1] as () => void;
  act(() => onResize());
  flush(); // Retire the desktop supplemental row.
  flush(); // The next frame measures the restored compact structure.
  expect(renderer!.root.findByType(HomeView)).toBe(instance);
  expect(header.dataset.homeChromeViewport).toBe('390x844');
});

function pending() {
  return renderer!.root.findByType('section').props['data-initial-layout-pending'] === true;
}

it('keeps the measured DOM inert until the initial terminal pass, then never hides an update', () => {
  render(false);
  expect(pending()).toBe(true);
  expect(renderer!.root.findByType('section').props.inert).toBe('');
  expect(renderer!.root.findAllByProps({ className: 'home-core-sections' })).toHaveLength(1);
  flush();
  expect(pending()).toBe(false);
  expect(renderer!.root.findByType('section').props.inert).toBeUndefined();
  render(false, 2);
  expect(pending()).toBe(false);
  act(() => fontReady.forEach(callback => callback()));
  expect(pending()).toBe(false);
});

it('starts pending again on a real Home remount, including a cached route return', () => {
  render(false); flush();
  expect(pending()).toBe(false);
  act(() => renderer!.unmount()); renderer = undefined;
  render(false);
  expect(pending()).toBe(true);
  flush();
  expect(pending()).toBe(false);
});

it.each(['hidden', 'desktop', 'text-scroll', 'setup'])('releases the %s terminal path without a loading loop', (path) => {
  if (path === 'hidden') visible = false;
  if (path === 'desktop') window.innerWidth = 1280;
  if (path === 'text-scroll') dashboard.dataset.contentScroll = 'true';
  render(false, path === 'setup' ? 0 : 1);
  flush();
  expect(pending()).toBe(false);
});

it('does not reveal between existing relaxation passes', () => {
  nav.getBoundingClientRect.mockImplementation(() => ({ top: 700, height: 100 }));
  render(false);
  flush(); // Commit the existing zero-row supplemental candidate first.
  expect(pending()).toBe(true);
  flush();
  expect(dashboard.style.setProperty).toHaveBeenCalled();
  expect(frames.size).toBe(1);
  expect(pending()).toBe(true);
  // This fixture holds geometry fixed: exercise the existing bounded fit cap.
  for (let pass = 0; pass < 4; pass += 1) flush();
  expect(pending()).toBe(false);
  expect(frames.size).toBe(0);
});

it('does not let a cancelled inactive callback reveal pending Home', () => {
  render(false);
  const stale = [...frames.values()][0];
  render(true);
  act(() => stale());
  expect(pending()).toBe(true);
  render(false); flush();
  expect(pending()).toBe(false);
});

it('waits for the material-selection commit before revealing initial Home', () => {
  props.studyMaterials = [{ status: 'active', updatedAt: '2026-10-13' } as any];
  nav.getBoundingClientRect.mockImplementation(() => ({ top: 308, height: 100 }));
  render(false); flush();
  expect(materialProbe.getBoundingClientRect).toHaveBeenCalled();
  expect(pending()).toBe(true);
  expect(frames.size).toBe(1);
  flush();
  expect(pending()).toBe(false);
});

it('waits for an emergency material-removal commit instead of revealing a stale structure', () => {
  props.studyMaterials = [{ status: 'active', updatedAt: '2026-10-13' } as any];
  nav.getBoundingClientRect.mockImplementation(() => ({ top: 308, height: 100 }));
  render(false); flush(); // Select a material, still pending.
  expect(pending()).toBe(true);
  nav.getBoundingClientRect.mockImplementation(() => ({ top: 150, height: 100 }));
  flush(); // Remove material candidate, still pending.
  expect(pending()).toBe(true);
  flush(); // The committed no-material structure reaches emergency terminal.
  expect(pending()).toBe(false);
  expect(dashboard.values.get('--home-dynamic-schedule-max')).toBe('50px');
});

it('does not mistake an existing fixed calendar event for an unused account', () => {
  props.monthEvents = [{ id: 'appointment' } as any];
  render(false, 0);
  expect(renderer!.root.findAllByProps({ className: 'home-dashboard home-dashboard-default' })).toHaveLength(1);
  props.monthEvents = [];
  render(false, 0);
  expect(renderer!.root.findAllByProps({ className: 'home-dashboard home-dashboard-setup' })).toHaveLength(1);
});
