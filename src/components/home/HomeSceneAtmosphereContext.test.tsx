import { HomeDisplayClockProvider } from './HomeDisplayClockContext';
import { StrictMode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as atmosphere from '../../lib/homeSceneAtmosphere';
import { HomeSceneAtmosphereProvider, useHomeSceneAtmosphere } from './HomeSceneAtmosphereContext';

const INITIAL_TIME = new Date('2026-08-19T10:15:59.900Z');

describe('shared Home display clock and scene lifecycle', () => {
  let renderer: ReactTestRenderer | undefined;
  let browserWindow: EventTarget;
  let browserDocument: EventTarget & { visibilityState: string };
  let snapshots: atmosphere.HomeSceneAtmosphere[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(INITIAL_TIME);
    browserWindow = new EventTarget();
    browserDocument = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    vi.stubGlobal('window', browserWindow);
    vi.stubGlobal('document', browserDocument);
    vi.spyOn(browserWindow, 'addEventListener');
    vi.spyOn(browserWindow, 'removeEventListener');
    vi.spyOn(browserDocument, 'addEventListener');
    vi.spyOn(browserDocument, 'removeEventListener');
    vi.spyOn(atmosphere, 'resolveHomeSceneAtmosphere');
    snapshots = [];
  });

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = undefined;
    expect(vi.getTimerCount()).toBe(0);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function SceneConsumer() {
    const snapshot = useHomeSceneAtmosphere();
    snapshots.push(snapshot);
    return <span data-period={snapshot.period} />;
  }

  function scenes(active: boolean, count = 5) {
    return <HomeDisplayClockProvider active={active}><HomeSceneAtmosphereProvider>
      {Array.from({ length: count }, (_, index) => <SceneConsumer key={index} />)}
    </HomeSceneAtmosphereProvider></HomeDisplayClockProvider>;
  }

  function mount(active = true) {
    act(() => { renderer = create(scenes(active)); });
  }

  function expectOneListenerSet() {
    expect(vi.mocked(browserWindow.addEventListener).mock.calls.map(([type]) => type)).toEqual(['focus', 'pageshow']);
    expect(vi.mocked(browserDocument.addEventListener).mock.calls.map(([type]) => type)).toEqual(['visibilitychange']);
  }

  function expectAllListenersRemoved() {
    expect(vi.mocked(browserWindow.removeEventListener).mock.calls).toEqual(vi.mocked(browserWindow.addEventListener).mock.calls);
    expect(vi.mocked(browserDocument.removeEventListener).mock.calls).toEqual(vi.mocked(browserDocument.addEventListener).mock.calls);
  }

  it('does not schedule or subscribe while inactive, including standalone consumers', () => {
    mount(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(browserWindow.addEventListener).not.toHaveBeenCalled();
    expect(browserDocument.addEventListener).not.toHaveBeenCalled();
    act(() => renderer?.update(<SceneConsumer />));
    expect(vi.getTimerCount()).toBe(0);
    expect(browserWindow.addEventListener).not.toHaveBeenCalled();
    expect(browserDocument.addEventListener).not.toHaveBeenCalled();
  });

  it('shares one snapshot and one timer/listener set across five scene consumers', () => {
    mount();
    expect(vi.getTimerCount()).toBe(1);
    expectOneListenerSet();
    expect(new Set(snapshots.slice(-5)).size).toBe(1);
    snapshots = [];
    act(() => { vi.advanceTimersByTime(100); });
    expect(snapshots).toHaveLength(5);
    expect(new Set(snapshots).size).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    expectOneListenerSet();
  });

  it('schedules the next minute boundary rather than sixty seconds after mounting', () => {
    mount();
    const resolve = vi.mocked(atmosphere.resolveHomeSceneAtmosphere);
    resolve.mockClear();
    act(() => { vi.advanceTimersByTime(99); });
    expect(resolve).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenLastCalledWith(new Date('2026-08-19T10:16:00.000Z'));
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(resolve).toHaveBeenLastCalledWith(new Date('2026-08-19T10:17:00.000Z'));
    expect(vi.getTimerCount()).toBe(1);
  });

  it.each(['focus', 'pageshow'])('repeated %s events refresh fresh time without accumulating timers or listeners', (event) => {
    mount();
    const now = new Date('2026-08-19T10:42:17.000Z');
    vi.setSystemTime(now);
    for (let index = 0; index < 4; index += 1) {
      act(() => { browserWindow.dispatchEvent(new Event(event)); });
      expect(vi.getTimerCount()).toBe(1);
    }
    expectOneListenerSet();
    expect(atmosphere.resolveHomeSceneAtmosphere).toHaveBeenLastCalledWith(now);
    const resolve = vi.mocked(atmosphere.resolveHomeSceneAtmosphere);
    resolve.mockClear();
    act(() => { vi.advanceTimersByTime(42_999); });
    expect(resolve).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(resolve).toHaveBeenLastCalledWith(new Date('2026-08-19T10:43:00.000Z'));
    expect(vi.getTimerCount()).toBe(1);
  });

  it('clears the timer while hidden and recomputes immediately on foreground within the same date', () => {
    mount();
    browserDocument.visibilityState = 'hidden';
    act(() => { browserDocument.dispatchEvent(new Event('visibilitychange')); });
    const resolve = vi.mocked(atmosphere.resolveHomeSceneAtmosphere);
    resolve.mockClear();
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      vi.advanceTimersByTime(3_600_000);
      browserWindow.dispatchEvent(new Event('focus'));
      browserWindow.dispatchEvent(new Event('pageshow'));
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    browserDocument.visibilityState = 'visible';
    act(() => { browserDocument.dispatchEvent(new Event('visibilitychange')); });
    expect(resolve).toHaveBeenLastCalledWith(new Date('2026-08-19T11:15:59.900Z'));
    expect(vi.getTimerCount()).toBe(1);
    expectOneListenerSet();
  });

  it('starts hidden without a wakeup and resumes from the current clock', () => {
    browserDocument.visibilityState = 'hidden';
    mount();
    expect(vi.getTimerCount()).toBe(0);
    const resolve = vi.mocked(atmosphere.resolveHomeSceneAtmosphere);
    resolve.mockClear();
    act(() => { vi.advanceTimersByTime(120_000); });
    expect(resolve).not.toHaveBeenCalled();
    browserDocument.visibilityState = 'visible';
    act(() => { browserDocument.dispatchEvent(new Event('visibilitychange')); });
    expect(resolve).toHaveBeenLastCalledWith(new Date('2026-08-19T10:17:59.900Z'));
    expect(vi.getTimerCount()).toBe(1);
  });

  it('unsubscribes when inactive and recreates just one clock when activated again', () => {
    mount();
    act(() => renderer?.update(scenes(false)));
    expect(vi.getTimerCount()).toBe(0);
    expectAllListenersRemoved();
    const resolve = vi.mocked(atmosphere.resolveHomeSceneAtmosphere);
    resolve.mockClear();
    act(() => {
      vi.advanceTimersByTime(90_000);
      browserWindow.dispatchEvent(new Event('focus'));
      browserDocument.dispatchEvent(new Event('visibilitychange'));
    });
    expect(resolve).not.toHaveBeenCalled();
    act(() => renderer?.update(scenes(true)));
    expect(resolve).toHaveBeenLastCalledWith(new Date('2026-08-19T10:17:29.900Z'));
    expect(vi.getTimerCount()).toBe(1);
    act(() => renderer?.unmount());
    renderer = undefined;
    expectAllListenersRemoved();
  });

  it('leaves no timer or listener after a StrictMode unmount/remount cycle', () => {
    for (let index = 0; index < 2; index += 1) {
      act(() => { renderer = create(<StrictMode>{scenes(true)}</StrictMode>); });
      expect(vi.getTimerCount()).toBe(1);
      act(() => renderer?.unmount());
      renderer = undefined;
      expect(vi.getTimerCount()).toBe(0);
      expectAllListenersRemoved();
    }
    const resolve = vi.mocked(atmosphere.resolveHomeSceneAtmosphere);
    resolve.mockClear();
    act(() => {
      vi.advanceTimersByTime(120_000);
      browserWindow.dispatchEvent(new Event('pageshow'));
      browserDocument.dispatchEvent(new Event('visibilitychange'));
    });
    expect(resolve).not.toHaveBeenCalled();
  });
});
