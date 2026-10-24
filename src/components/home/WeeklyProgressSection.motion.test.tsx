import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeDashboardModel } from '../../lib/homeDashboard';
import { installFakeMotionEnvironment } from '../../lib/motionPreference.testUtils';
import { WeeklyProgressSection } from './WeeklyProgressSection';

// Persistent bars like retained DOM nodes: layout height from data, drawn
// height including a running growth's scale.
type Bar = {
  dataset: Record<string, string>; layout: number; scale: number; starts: number[];
  getBoundingClientRect: () => { height: number };
};
let env: ReturnType<typeof installFakeMotionEnvironment>;
let renderer: ReactTestRenderer | undefined;
const bars = new Map<string, Bar>();
const ringSettles: number[] = [];

function barFor(key: string) {
  let bar = bars.get(key);
  if (!bar) {
    const created = {
      dataset: {} as Record<string, string>, layout: 0, scale: 1, starts: [] as number[],
      get offsetHeight() { return created.layout; },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 6, height: created.layout * created.scale }),
      animate: (frames: Keyframe[]) => {
        created.scale = Number(String(frames[0].scale ?? '1 1').split(' ')[1]);
        created.starts.push(created.scale);
        return { cancel: () => { created.scale = 1; }, addEventListener: vi.fn() };
      },
    };
    bar = created;
    bars.set(key, bar);
  }
  return bar;
}

const section = {
  querySelectorAll: (selector: string) => {
    if (!renderer) return [];
    if (selector === '[data-bar-key]') {
      return renderer.root.findAll(node => typeof node.props['data-bar-key'] === 'string').map(node => {
        const bar = barFor(node.props['data-bar-key']);
        bar.layout = Number(node.props['data-bar-height']);
        bar.dataset = { barKey: node.props['data-bar-key'] };
        return bar;
      });
    }
    return renderer.root.findAll(node => node.props['data-progress-value'] === 'week').map(node => ({
      dataset: { progressValue: 'week' },
      textContent: [node.props.children].flat().filter(child => typeof child === 'number' || typeof child === 'string').join('') + '%',
      animate: () => { ringSettles.push(1); return { cancel: vi.fn(), addEventListener: vi.fn() }; },
    }));
  },
};

const dashboard = (actual: number, week = '2026-10-12', tuesday = 0) => ({
  weekDays: [
    { date: week, label: '月', plannedMinutes: 180, actualMinutes: actual },
    { date: `${week}:tue`, label: '火', plannedMinutes: 0, actualMinutes: tuesday },
  ],
  weekProgressPercent: Math.round((actual / 180) * 100),
  weekDeltaMinutesByNow: actual - 180, weekExpectedMinutesByNow: 180, weekActualMinutesByNow: actual,
}) as unknown as HomeDashboardModel;

function show(actual: number, week?: string, tuesday?: number) {
  act(() => {
    const element = <WeeklyProgressSection dashboard={dashboard(actual, week, tuesday)} onOpenReport={vi.fn()} />;
    if (renderer) renderer.update(element);
    else renderer = create(element, {
      createNodeMock: node => (String(node.props.className ?? '').includes('home-progress-panel') ? section : {}),
    });
  });
  // Lay the bars out as the browser would after each commit.
  section.querySelectorAll('[data-bar-key]');
}

beforeEach(() => { env = installFakeMotionEnvironment(); bars.clear(); ringSettles.length = 0; });
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; env.restore(); });

describe('weekly progress motion', () => {
  const actual = () => barFor('2026-10-12:actual');

  it('stays still on first paint, grows a changed bar and settles the percentage', () => {
    show(36);
    expect(actual().starts).toEqual([]);
    show(72);
    expect(actual().starts).toEqual([0.5]);
    expect(barFor('2026-10-12:plan').starts).toEqual([]);
    expect(ringSettles).toHaveLength(1);
  });

  it('continues from the drawn height when a second update arrives mid-growth', () => {
    show(36);
    show(72);
    actual().scale = 0.75; // drawn at 30 of its 40 while growing
    const drawn = actual().getBoundingClientRect().height;
    show(108);
    expect(actual().getBoundingClientRect().height).toBeCloseTo(drawn);
  });

  it('shows another week without motion', () => {
    show(36);
    show(72, '2026-10-19');
    expect(barFor('2026-10-19:actual').starts).toEqual([]);
    expect(ringSettles).toHaveLength(0);
  });

  it('shrinks continuously when a large record is removed', () => {
    show(180);
    const drawn = actual().getBoundingClientRect().height;
    show(0);
    expect(actual().getBoundingClientRect().height).toBeCloseTo(drawn);
  });

  it('lets a bar that is still growing continue when another day changes', () => {
    show(36);
    show(72);
    actual().scale = 0.75;
    show(72, undefined, 36);
    expect(actual().starts).toEqual([0.5]);
    expect(barFor('2026-10-12:tue:actual').starts.length).toBe(1);
  });
});
