import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installFakeMotionEnvironment } from '../lib/motionPreference.testUtils';
import { useDataChangeMotion } from './useDataChangeMotion';
import { usePeriodNavigationMotion } from './usePeriodNavigationMotion';

type Item = { key: string; signature: string };
let env: ReturnType<typeof installFakeMotionEnvironment>;
let renderer: ReactTestRenderer | undefined;
let rendered: Item[] = [];
const played = new Map<string, string[]>();

// A container whose children mirror what the component last rendered.
const container = {
  querySelectorAll: () => rendered.map(item => ({
    dataset: { motionKey: item.key, motionSignature: item.signature },
    animate: vi.fn((frames: Keyframe[]) => {
      played.set(item.key, [...(played.get(item.key) ?? []), Object.keys(frames[0]).join(',')]);
      return { cancel: vi.fn(), addEventListener: vi.fn() };
    }),
  })),
} as unknown as Element;
const containerRef = { current: container };

beforeEach(() => { env = installFakeMotionEnvironment(); played.clear(); });
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; env.restore(); });

function View({ scope, items, data }: { scope: string; items: Item[]; data: unknown }) {
  rendered = items;
  useDataChangeMotion(containerRef, scope, [data]);
  return null;
}

const render = (scope: string, items: Item[], data: unknown) => act(() => {
  if (renderer) renderer.update(<View scope={scope} items={items} data={data} />);
  else renderer = create(<View scope={scope} items={items} data={data} />);
});

const kinds = () => Object.fromEntries([...played].map(([key, frames]) => [key, frames.map(frame => frame.includes('translate') ? 'enter' : 'settle')]));

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
