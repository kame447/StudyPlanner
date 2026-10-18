import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeMotionEnvironment } from '../lib/motionPreference.testUtils';
import { useDataChangeMotion } from './useDataChangeMotion';
import { usePeriodNavigationMotion } from './usePeriodNavigationMotion';

type Item = { key: string; signature: string; y?: number };
let env: ReturnType<typeof installFakeMotionEnvironment>;
let renderer: ReactTestRenderer | undefined;
let rendered: Item[] = [];
const played = new Map<string, string[]>();
const glides = new Map<string, string>();

// A container whose children mirror what the component last rendered.
const container = {
  // Items with a `y` are laid out as a 20px-tall column at that offset.
  getBoundingClientRect: () => ({ left: 10, top: 100, width: 200, height: 400 }),
  querySelectorAll: () => rendered.map(item => ({
    dataset: { motionKey: item.key, motionSignature: item.signature },
    ...(item.y === undefined ? {} : {
      getBoundingClientRect: () => ({ left: 10, top: 100 + item.y!, width: 200, height: 20 }),
    }),
    animate: vi.fn((frames: Keyframe[]) => {
      played.set(item.key, [...(played.get(item.key) ?? []), Object.keys(frames[0]).join(',')]);
      if (frames[0].translate && !frames[0].opacity) glides.set(item.key, String(frames[0].translate));
      return { cancel: vi.fn(), addEventListener: vi.fn() };
    }),
  })),
} as unknown as Element;
const containerRef = { current: container };

beforeEach(() => { env = installFakeMotionEnvironment(); played.clear(); glides.clear(); });
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; env.restore(); });

// The hook runs while the previous items are still on screen; the new items
// are "committed" once the render returns, before layout effects.
function View({ scope, items, data }: { scope: string; items: Item[]; data: unknown }) {
  useDataChangeMotion(containerRef, scope, [data]);
  rendered = items;
  return null;
}

const render = (scope: string, items: Item[], data: unknown) => act(() => {
  if (renderer) renderer.update(<View scope={scope} items={items} data={data} />);
  else renderer = create(<View scope={scope} items={items} data={data} />);
});

const kinds = () => Object.fromEntries([...played].map(([key, frames]) => [key, frames.map(frame =>
  frame === 'translate' ? 'glide' : frame.includes('translate') ? 'enter' : 'settle')]));

it('stays still on first render and when moving to another period', () => {
  render('2026-10-15', [{ key: 'a', signature: '9:00' }], 1);
  render('2026-10-16', [{ key: 'b', signature: '9:00' }], 2);
  expect(played.size).toBe(0);
});

it('introduces added items and settles changed ones after a data change', () => {
  render('day', [{ key: 'a', signature: '9:00' }, { key: 'b', signature: '10:00' }], 1);
  render('day', [{ key: 'a', signature: '9:30' }, { key: 'b', signature: '10:00' }, { key: 'c', signature: '11:00' }], 2);
  expect(kinds()).toEqual({ a: ['settle'], c: ['enter'] });
});

it('never animates items revealed without a data change, even on a later data change', () => {
  const data = {};
  render('day', [{ key: 'a', signature: '9:00' }], data);
  render('day', [{ key: 'a', signature: '9:00' }, { key: 'timetable', signature: '1限' }], data);
  render('day', [{ key: 'a', signature: '9:00' }, { key: 'timetable', signature: '1限' }], {});
  expect(played.size).toBe(0);
});

function Calendar({ period }: { period: string }) {
  usePeriodNavigationMotion(containerRef, period);
  return null;
}

it('slides the calendar from the side the user moved toward', () => {
  const navigations: string[] = [];
  const body = { animate: vi.fn((frames: Keyframe[]) => { navigations.push(String(frames[0].translate)); return { cancel: vi.fn(), addEventListener: vi.fn() }; }) };
  containerRef.current = body as unknown as Element;
  try {
    act(() => { renderer = create(<Calendar period="2026-10-12" />); });
    act(() => renderer!.update(<Calendar period="2026-10-12" />));
    act(() => renderer!.update(<Calendar period="2026-10-19" />));
    act(() => renderer!.update(<Calendar period="2026-10-05" />));
    expect(navigations).toEqual(['18px 0', '-18px 0']);
  } finally {
    containerRef.current = container;
  }
});

describe('items pushed aside by a change', () => {
  const column = (...keys: string[]) => keys.map((key, index) => ({ key, signature: key, y: index * 20 }));

  it('glide from where they were drawn when a neighbour is removed', () => {
    render('day', column('a', 'b', 'c'), 1);
    render('day', column('a', 'c'), 2);
    expect(kinds()).toEqual({ c: ['glide'] });
    expect(glides.get('c')).toBe('0px 20px');
  });

  it('make room for an insertion while the new item enters', () => {
    render('day', column('a', 'c'), 1);
    render('day', column('a', 'b', 'c'), 2);
    expect(kinds()).toEqual({ b: ['enter'], c: ['glide'] });
    expect(glides.get('c')).toBe('0px -20px');
  });

  it('do not move without a data change, on a scope change or at reduced', () => {
    const data = {};
    render('day', column('a', 'b'), data);
    render('day', column('b'), data);
    render('week-1', column('a', 'b'), 3);
    render('week-2', column('b'), 4);
    expect(played.size).toBe(0);

    render('week-2', column('a', 'b'), 5);
    played.clear();
    glides.clear();
    env.setSystemReduced(true);
    render('week-2', column('b'), 6);
    expect(played.size).toBe(0);
    expect(glides.size).toBe(0);
  });

  it('are shown in place when a change moves most of the view', () => {
    const many = Array.from({ length: 30 }, (_, index) => `item-${index}`);
    render('day', column('head', ...many), 1);
    render('day', column(...many), 2);
    expect(played.size).toBe(0);
  });
});

describe('a change that arrives while items are still gliding', () => {
  // Persistent nodes whose drawn position includes the running glide's
  // translate, like retained DOM nodes in a browser. The glide holds its
  // starting offset until it ends (or is parked at its end).
  type Glide = { offset: number; time: number; paused: boolean; cancelled: boolean };
  const nodes = new Map<string, { layoutY: number; glide: Glide | null; starts: number[]; element: unknown }>();
  let visible: string[] = [];

  const nodeFor = (key: string) => {
    let node = nodes.get(key);
    if (node) return node;
    const created = { layoutY: 0, glide: null as Glide | null, starts: [] as number[], element: null as unknown };
    created.element = {
      dataset: { motionKey: key, motionSignature: key },
      getBoundingClientRect: () => {
        const glide = created.glide;
        const drawn = glide && !glide.cancelled && glide.time < 200 ? glide.offset : 0;
        return { left: 10, top: 100 + created.layoutY + drawn, width: 200, height: 20 };
      },
      animate: (frames: Keyframe[]) => {
        const offset = Number.parseFloat(String(frames[0].translate ?? '0 0').split(' ')[1]) || 0;
        const glide: Glide = { offset, time: 0, paused: false, cancelled: false };
        created.glide = glide;
        created.starts.push(offset);
        return {
          get playState() { return glide.paused ? 'paused' : 'running'; },
          get currentTime() { return glide.time; },
          set currentTime(value: number) { glide.time = value; },
          effect: { getComputedTiming: () => ({ endTime: 200 }) },
          pause: () => { glide.paused = true; },
          play: () => { glide.paused = false; },
          cancel: () => { glide.cancelled = true; },
          addEventListener: vi.fn(),
        };
      },
    };
    nodes.set(key, created);
    return created;
  };

  const persistentContainer = {
    getBoundingClientRect: () => ({ left: 10, top: 100, width: 200, height: 400 }),
    querySelectorAll: () => visible.map(key => nodeFor(key).element),
  } as unknown as Element;

  function Column({ keys, data }: { keys: string[]; data: unknown }) {
    useDataChangeMotion({ current: persistentContainer }, 'todo', [data]);
    visible = keys;
    keys.forEach((key, index) => { nodeFor(key).layoutY = index * 20; });
    return null;
  }

  it('continues from where each item is drawn instead of jumping', () => {
    nodes.clear();
    let column: ReactTestRenderer | undefined;
    const show = (keys: string[], data: number) => act(() => {
      if (column) column.update(<Column keys={keys} data={data} />);
      else column = create(<Column keys={keys} data={data} />);
    });
    try {
      show(['a', 'b', 'c', 'd'], 1);
      show(['b', 'c', 'd'], 2);
      expect(nodeFor('d').starts).toEqual([20]);
      const drawnBefore = (nodeFor('d').element as Element).getBoundingClientRect().top;

      // A second removal while the first glide is still drawing d 20px lower.
      show(['c', 'd'], 3);
      expect(nodeFor('d').starts).toEqual([20, 40]);
      expect((nodeFor('d').element as Element).getBoundingClientRect().top).toBe(drawnBefore);

      // A follow-up commit that does not move d (e.g. the saved copy of the
      // same change arriving) lets the running glide continue.
      show(['c', 'd'], 4);
      expect(nodeFor('d').starts).toEqual([20, 40]);
    } finally {
      act(() => column?.unmount());
    }
  });
});
