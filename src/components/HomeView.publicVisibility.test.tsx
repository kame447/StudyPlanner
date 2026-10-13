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
let props: ComponentProps<typeof HomeView>;
class Element {
  dataset: Record<string, string> = {};
  values = new Map<string, string>();
  style = { getPropertyValue: (key: string) => this.values.get(key) ?? '',
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
    else renderer = create(element, { createNodeMock: element => element.props.className === 'home-core-sections' ? core : null });
  });
}
function flush() {
  act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); });
}
beforeEach(() => {
  visible = true; frames = new Map(); fontReady = []; let frameId = 0;
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

it('does not measure, write layout variables or lock chrome from hidden zero-sized geometry', () => {
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
