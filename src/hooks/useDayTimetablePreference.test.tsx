import { Suspense } from 'react';
import { act, create, type ReactTestRenderer, type TestRendererOptions } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMonthTimetablePreference } from './useMonthTimetablePreference';
import { useTimetableDisplayPreference } from './useTimetableDisplayPreference';
const useDayTimetablePreference = (owner?: string) => useTimetableDisplayPreference('day', owner);

let current: ReturnType<typeof useDayTimetablePreference>;
let renderer: ReactTestRenderer;
const frames: boolean[] = [];
function Probe({ owner }: { owner?: string }) {
  current = useDayTimetablePreference(owner);
  frames.push(current.showTimetable);
  return null;
}
function mount(owner?: string) {
  act(() => { renderer = create(<Probe owner={owner} />); });
}
afterEach(() => {
  act(() => renderer?.unmount());
  vi.unstubAllGlobals();
  frames.length = 0;
});

describe('day timetable preference owner boundary', () => {
  it('defaults ON, persists repeated changes and reloads each owner before any render', () => {
    const values = new Map<string, string>();
    const setItem = vi.fn((key: string, value: string) => { values.set(key, value); });
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => values.get(key), setItem } });
    mount('a');
    expect(current.showTimetable).toBe(true);
    act(() => current.setShowTimetable(false));
    expect(current.showTimetable).toBe(false);
    frames.length = 0;
    act(() => renderer.update(<Probe owner="b" />));
    expect(frames.every(Boolean)).toBe(true);
    expect(setItem).toHaveBeenCalledTimes(1);
    act(() => current.setShowTimetable(true));
    frames.length = 0;
    act(() => renderer.update(<Probe owner="a" />));
    expect(frames.every(value => value === false)).toBe(true);
    act(() => current.setShowTimetable(true));
    act(() => current.setShowTimetable(false));
    act(() => renderer.unmount());
    mount('a');
    expect(current.showTimetable).toBe(false);
    frames.length = 0;
    act(() => renderer.update(<Probe />));
    expect(frames.every(Boolean)).toBe(true);
    act(() => current.setShowTimetable(false));
    expect(values.size).toBe(2);
  });

  it('uses ON for unavailable or invalid storage and reports failed writes without pretending to save', () => {
    const getItem = vi.fn(() => 'invalid');
    vi.stubGlobal('window', { localStorage: { getItem, setItem: () => { throw new Error('blocked'); } } });
    mount('a');
    expect(current.showTimetable).toBe(true);
    act(() => current.setShowTimetable(false));
    expect(current.showTimetable).toBe(true);
    expect(current.error).toContain('設定を保存できませんでした');
    getItem.mockImplementation(() => { throw new Error('blocked'); });
    frames.length = 0;
    act(() => renderer.update(<Probe owner="b" />));
    expect(frames.every(Boolean)).toBe(true);
    expect(current.error).toBeNull();
  });
});

describe('day timetable stale callbacks', () => {
  it('isolates exact owner IDs without trimming them', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: {
      getItem: (key: string) => values.get(key),
      setItem: (key: string, value: string) => { values.set(key, value); },
    } });
    mount('a');
    act(() => current.setShowTimetable(false));
    act(() => renderer.update(<Probe owner=" a " />));
    expect(current.showTimetable).toBe(true);
    act(() => current.setShowTimetable(true));
    expect(values.size).toBe(2);
    act(() => renderer.update(<Probe owner="a" />));
    expect(current.showTimetable).toBe(false);
  });

  it('keeps the latest value when a stale same-session callback fails to save', () => {
    const values = new Map<string, string>();
    const setItem = vi.fn((key: string, value: string) => { values.set(key, value); });
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => values.get(key), setItem } });
    mount('a');
    const initialSetter = current.setShowTimetable;
    act(() => current.setShowTimetable(false));
    setItem.mockImplementation(() => { throw new Error('blocked'); });
    act(() => initialSetter(true));
    expect(current.showTimetable).toBe(false);
    expect(current.error).toContain('設定を保存できませんでした');
    expect([...values.values()]).toEqual(['false']);
  });

  it('invalidates prior owner/session callbacks across switching, sign-out and return', () => {
    const values = new Map<string, string>();
    const getItem = vi.fn((key: string) => values.get(key));
    const setItem = vi.fn((key: string, value: string) => { values.set(key, value); });
    const localStorage = { getItem, setItem };
    vi.stubGlobal('window', { localStorage });
    mount('a');
    const oldA = current.setShowTimetable;
    act(() => renderer.update(<Probe owner="b" />));
    act(() => current.setShowTimetable(false));
    getItem.mockImplementation(() => { throw new Error('read blocked'); });
    setItem.mockImplementation(() => { throw new Error('write blocked'); });
    act(() => current.setShowTimetable(true));
    const error = current.error;
    const reads = getItem.mock.calls.length;
    const writes = setItem.mock.calls.length;
    act(() => oldA(true));
    expect(getItem).toHaveBeenCalledTimes(reads);
    expect(setItem).toHaveBeenCalledTimes(writes);
    expect(current.showTimetable).toBe(false);
    expect(current.error).toBe(error);

    // Even access to the Storage property itself can throw.
    const storageGetter = vi.fn(() => { throw new Error('storage getter blocked'); });
    Object.defineProperty(window, 'localStorage', { get: storageGetter, configurable: true });
    act(() => current.setShowTimetable(true));
    expect(current.showTimetable).toBe(false);
    expect(current.error).toBe(error);
    storageGetter.mockClear();
    act(() => oldA(false));
    expect(storageGetter).not.toHaveBeenCalled();

    const oldB = current.setShowTimetable;
    act(() => renderer.update(<Probe />));
    storageGetter.mockClear();
    act(() => { oldA(false); oldB(true); });
    expect(storageGetter).not.toHaveBeenCalled();
    expect(current.showTimetable).toBe(true);
    act(() => renderer.update(<Probe owner="a" />));
    storageGetter.mockClear();
    act(() => oldA(false));
    expect(storageGetter).not.toHaveBeenCalled();
    expect(current.showTimetable).toBe(true);
    expect(current.error).toBeNull();

    Object.defineProperty(window, 'localStorage', { value: localStorage, configurable: true });
    getItem.mockImplementation(key => values.get(key));
    setItem.mockImplementation((key, value) => { values.set(key, value); });
    const newA = current.setShowTimetable;
    act(() => oldA(false));
    expect([...values.values()]).toEqual(['false']);
    act(() => newA(false));
    expect(current.showTimetable).toBe(false);
    expect(values.size).toBe(2);
    act(() => renderer.unmount());
    const finalWrites = setItem.mock.calls.length;
    act(() => newA(true));
    expect(setItem).toHaveBeenCalledTimes(finalWrites);
  });

  it('defaults ON when accessing localStorage itself throws', () => {
    vi.stubGlobal('window', { get localStorage() { throw new Error('blocked'); } });
    mount('a');
    expect(current.showTimetable).toBe(true);
    act(() => current.setShowTimetable(false));
    expect(current.showTimetable).toBe(true);
    expect(current.error).toContain('設定を保存できませんでした');
  });
});


it('cannot save from a suspended render that never committed', async () => {
  const setItem = vi.fn();
  vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem } });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const pending = new Promise<void>(() => {});
  function SuspendedProbe(): never {
    current = useDayTimetablePreference('uncommitted-owner');
    throw pending;
  }
  const options: TestRendererOptions & { unstable_isConcurrent: boolean } = {
    createNodeMock: () => null, unstable_isConcurrent: true,
  };
  await act(async () => {
    renderer = create(<Suspense fallback={null}><SuspendedProbe /></Suspense>, options);
  });
  act(() => current.setShowTimetable(false));
  expect(setItem).not.toHaveBeenCalled();
});

it('retries a failed day save and leaves the real month hook and storage independent', () => {
  const values = new Map<string, string>();
  const setItem = vi.fn((key: string, value: string) => { values.set(key, value); });
  vi.stubGlobal('window', { localStorage: { getItem: (key: string) => values.get(key), setItem } });
  let month!: ReturnType<typeof useMonthTimetablePreference>;
  function Both() { current = useDayTimetablePreference('owner'); month = useMonthTimetablePreference('owner'); return null; }
  act(() => { renderer = create(<Both />); });
  act(() => month.setShowTimetable(false));
  expect(current.showTimetable).toBe(true);
  setItem.mockImplementationOnce(() => { throw new Error('blocked'); });
  act(() => current.setShowTimetable(false));
  expect(current.showTimetable).toBe(true);
  expect(current.error).toContain('設定を保存できませんでした');
  act(() => current.setShowTimetable(false));
  expect(current.showTimetable).toBe(false); expect(current.error).toBeNull();
  act(() => month.setShowTimetable(true));
  expect(current.showTimetable).toBe(false); expect(month.showTimetable).toBe(true);
  expect([...values.entries()].sort()).toEqual([
    ['study-planner-day-timetable:owner', 'false'], ['study-planner-month-timetable:owner', 'true'],
  ]);
});
