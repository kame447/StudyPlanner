import { useLayoutEffect, type PointerEvent as ReactPointerEvent, type TouchEvent as ReactTouchEvent } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineDragDescriptor, useTimelineDragController } from './useTimelineDragController';
import { BrowserEventTarget } from '../lib/timelineDragInteractionLock.testUtils';

type Controller = ReturnType<typeof useTimelineDragController<string>>;
const LOCK_CLASS = 'is-timeline-drag-interaction-locked';
const original = { date: '2026-10-07', startTime: '09:00', endTime: '10:00' };
const descriptor: TimelineDragDescriptor<string> = {
  key: 'plan', item: 'plan', title: '数学', original,
  dates: ['2026-10-07', '2026-10-08'], allowDateChange: false,
  dayColumnSelector: '.day-column', scrollSelector: '.timeline-scroll',
};

function createElementState() {
  const classes = new Set<string>();
  return {
    classList: {
      add: (value: string) => classes.add(value),
      remove: (value: string) => classes.delete(value),
      contains: (value: string) => classes.has(value),
    },
    style: { overflow: '', overscrollBehavior: '' },
    scrollTop: 180,
    scrollLeft: 0,
  };
}

describe('timeline drag interaction lifecycle', () => {
  let hook: typeof useTimelineDragController;
  let renderers: ReactTestRenderer[];
  let browserWindow: EventTarget & {
    scrollX: number; scrollY: number;
    setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout;
  };
  let browserDocument: EventTarget & {
    documentElement: ReturnType<typeof createElementState>;
    body: ReturnType<typeof createElementState>;
    visibilityState: string; hidden: boolean;
  };

  beforeEach(async () => {
    // Isolate the lock module's ownership counter, including deliberately interrupted sessions.
    vi.resetModules();
    vi.useFakeTimers();
    renderers = [];
    browserWindow = Object.assign(new BrowserEventTarget(), {
      setTimeout, clearTimeout, scrollX: 0, scrollY: 260,
      matchMedia: () => ({ matches: false }),
    });
    browserDocument = Object.assign(new BrowserEventTarget(), {
      documentElement: createElementState(), body: createElementState(),
      visibilityState: 'visible', hidden: false,
    });
    vi.stubGlobal('window', browserWindow);
    vi.stubGlobal('document', browserDocument);
    vi.stubGlobal('navigator', { vibrate: vi.fn() });
    ({ useTimelineDragController: hook } = await import('./useTimelineDragController'));
  });

  afterEach(() => {
    act(() => renderers.forEach(renderer => renderer.unmount()));
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function mount(deferTouchDragUntilMoveAfterLongPress = true, withParentViewportLock = false) {
    let controller: Controller;
    const onCommit = vi.fn();
    const scroll = {
      scrollTop: 120, scrollLeft: 0, scrollWidth: 900, clientWidth: 300,
      getBoundingClientRect: () => ({ left: 0, right: 300 }),
    };
    const day = { getBoundingClientRect: () => ({ width: 300, height: 1440 }) };
    const card = {
      isConnected: true,
      closest: (selector: string) => selector === '.day-column' ? day : scroll,
      getBoundingClientRect: () => ({ left: 20, top: 80, width: 260, height: 60 }),
      setPointerCapture: vi.fn(),
    };
    function Probe() {
      controller = hook({ onCommit, deferTouchDragUntilMoveAfterLongPress });
      return null;
    }
    function ParentViewportLock() {
      // Match the AI preview's parent layout lock / child passive cleanup ordering.
      useLayoutEffect(() => {
        if (!withParentViewportLock) return;
        const elements = [browserDocument.documentElement, browserDocument.body];
        const previous = elements.map(element => ({ ...element.style }));
        elements.forEach(element => {
          element.style.overflow = 'hidden';
          element.style.overscrollBehavior = 'none';
        });
        return () => elements.forEach((element, index) => Object.assign(element.style, previous[index]));
      }, []);
      return <Probe />;
    }
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<ParentViewportLock />); });
    renderers.push(renderer);

    function touch(x = 100, y = 100, count = 1) {
      return {
        currentTarget: card,
        touches: Array.from({ length: count }, (_, identifier) => ({ identifier, clientX: x, clientY: y })),
        preventDefault: vi.fn(), stopPropagation: vi.fn(),
      } as unknown as ReactTouchEvent<HTMLElement>;
    }
    return {
      get controller() { return controller!; },
      onCommit, scroll, card, touch,
      start(count = 1) { act(() => controller!.handleTouchStart(touch(100, 100, count), descriptor)); },
      arm() { act(() => { vi.advanceTimersByTime(240); }); },
      move(x = 100, y = 160, count = 1) {
        const event = touch(x, y, count);
        act(() => controller!.handleTouchMove(event));
        return event;
      },
      end() { act(() => controller!.handleTouchEnd(touch(100, 160, 0))); },
      cancel() { act(() => controller!.handleTouchCancel()); },
      rerender() { act(() => renderer.update(<ParentViewportLock />)); },
      unmount() {
        act(() => renderer.unmount());
        renderers = renderers.filter(value => value !== renderer);
      },
    };
  }

  function isLocked() {
    return browserDocument.documentElement.classList.contains(LOCK_CLASS);
  }

  function nativeMove() {
    const event = new Event('touchmove', { cancelable: true });
    browserWindow.dispatchEvent(event);
    return event;
  }

  it('locks before the first native move after a long press, without moving the card yet', () => {
    const f = mount();
    f.start();
    act(() => { vi.advanceTimersByTime(239); });
    expect(isLocked()).toBe(false);
    expect(nativeMove().defaultPrevented).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(isLocked()).toBe(true);
    expect(f.controller.dragVisual).toBeNull();
    expect(nativeMove().defaultPrevented).toBe(true);
    expect(browserDocument.body.style.overflow).toBe('');
    f.move();
    expect(f.controller.dragVisual?.target).toEqual({ ...original, startTime: '10:00', endTime: '11:00' });
    f.end();
    expect(f.onCommit).toHaveBeenCalledExactlyOnceWith(descriptor, original, {
      ...original, startTime: '10:00', endTime: '11:00',
    });
    expect(isLocked()).toBe(false);
    expect(nativeMove().defaultPrevented).toBe(false);
    expect(browserWindow.scrollY).toBe(260);
    expect(browserDocument.documentElement.scrollTop).toBe(180);
    expect(f.scroll.scrollTop).toBe(120);
  });

  it('leaves an ordinary swipe scrollable even if the finger stays down past the long-press delay', () => {
    const f = mount();
    f.start();
    const move = f.move(100, 120);
    f.arm();
    expect(move.preventDefault).not.toHaveBeenCalled();
    expect(nativeMove().defaultPrevented).toBe(false);
    expect(isLocked()).toBe(false);
    expect(f.controller.dragVisual).toBeNull();
    f.end();
    expect(f.onCommit).not.toHaveBeenCalled();
  });

  it('does not lock or suppress a short tap', () => {
    const f = mount();
    f.start();
    f.end();
    f.arm();
    expect(isLocked()).toBe(false);
    expect(f.controller.shouldSuppressClick()).toBe(false);
    expect(f.onCommit).not.toHaveBeenCalled();
  });

  it('removes a pending long-press timer on unmount so it cannot lock a later screen', () => {
    const f = mount();
    f.start();
    f.unmount();
    expect(vi.getTimerCount()).toBe(0);
    f.arm();
    expect(isLocked()).toBe(false);
    expect(nativeMove().defaultPrevented).toBe(false);
  });

  it.each(['end', 'cancel', 'unmount'] as const)('releases a stationary armed long press on %s without committing', ending => {
    const f = mount();
    f.start();
    f.arm();
    expect(isLocked()).toBe(true);
    f[ending]();
    expect(isLocked()).toBe(false);
    expect(nativeMove().defaultPrevented).toBe(false);
    expect(f.onCommit).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['cancel', 'unmount'] as const)('releases an active drag on %s without committing', ending => {
    const f = mount();
    f.start();
    f.arm();
    f.move();
    expect(isLocked()).toBe(true);
    f[ending]();
    expect(isLocked()).toBe(false);
    expect(nativeMove().defaultPrevented).toBe(false);
    expect(f.onCommit).not.toHaveBeenCalled();
  });

  it.each(['hidden', 'blur', 'pagehide', 'Escape'] as const)('cancels pending, armed, and active sessions on %s', interruption => {
    for (const phase of ['pending', 'armed', 'active']) {
      const f = mount();
      f.start();
      if (phase !== 'pending') f.arm();
      if (phase === 'active') f.move();
      act(() => {
        if (interruption === 'hidden') {
          browserDocument.visibilityState = 'hidden';
          browserDocument.hidden = true;
          browserDocument.dispatchEvent(new Event('visibilitychange'));
        } else if (interruption === 'Escape') {
          const event = new Event('keydown');
          Object.defineProperty(event, 'key', { value: 'Escape' });
          browserDocument.dispatchEvent(event);
        } else {
          browserWindow.dispatchEvent(new Event(interruption));
        }
      });
      f.arm();
      f.move();
      f.end();
      expect(isLocked()).toBe(false);
      expect(f.controller.dragVisual).toBeNull();
      expect(f.onCommit).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      f.unmount();
      browserDocument.visibilityState = 'visible';
      browserDocument.hidden = false;
    }
  });

  it('leaves an armed session intact on visible visibilitychange and unrelated keyboard events', () => {
    const f = mount();
    f.start();
    f.arm();
    act(() => { browserDocument.dispatchEvent(new Event('visibilitychange')); });
    const event = new Event('keydown');
    Object.defineProperty(event, 'key', { value: 'Enter' });
    act(() => { browserDocument.dispatchEvent(event); });
    expect(isLocked()).toBe(true);
    f.move();
    f.end();
    expect(f.onCommit).toHaveBeenCalledTimes(1);
  });

  it.each(['start', 'move'] as const)('cancels when a second finger arrives through touch %s', eventKind => {
    for (const phase of ['pending', 'armed', 'active']) {
      const f = mount();
      f.start();
      if (phase !== 'pending') f.arm();
      if (phase === 'active') f.move();
      if (eventKind === 'start') f.start(2);
      else f.move(100, 160, 2);
      f.arm();
      expect(isLocked()).toBe(false);
      expect(f.controller.dragVisual).toBeNull();
      expect(nativeMove().defaultPrevented).toBe(false);
      f.end();
      expect(f.onCommit).not.toHaveBeenCalled();
      f.unmount();
    }
  });

  it('cancels when a second finger starts outside the dragged card', () => {
    const f = mount();
    f.start();
    f.arm();
    f.move();
    const event = new Event('touchstart');
    Object.defineProperty(event, 'touches', { value: [{ identifier: 0 }, { identifier: 1 }] });
    act(() => { browserWindow.dispatchEvent(event); });
    expect(isLocked()).toBe(false);
    expect(f.controller.dragVisual).toBeNull();
    expect(nativeMove().defaultPrevented).toBe(false);
    f.end();
    expect(f.onCommit).not.toHaveBeenCalled();
  });

  it('removes interruption listeners on unmount, including after a mount/unmount cycle', () => {
    const windowAdd = vi.spyOn(browserWindow, 'addEventListener');
    const windowRemove = vi.spyOn(browserWindow, 'removeEventListener');
    const documentAdd = vi.spyOn(browserDocument, 'addEventListener');
    const documentRemove = vi.spyOn(browserDocument, 'removeEventListener');
    for (let cycle = 0; cycle < 2; cycle += 1) {
      const f = mount();
      f.start();
      f.arm();
      f.unmount();
    }
    const capture = (options: boolean | EventListenerOptions | undefined) =>
      typeof options === 'boolean' ? options : options?.capture ?? false;
    for (const [added, removed] of [[windowAdd, windowRemove], [documentAdd, documentRemove]]) {
      expect(removed.mock.calls).toHaveLength(added.mock.calls.length);
      for (const [type, listener, options] of added.mock.calls) {
        expect(removed.mock.calls.some(([removedType, removedListener, removedOptions]) =>
          type === removedType && listener === removedListener && capture(options) === capture(removedOptions),
        )).toBe(true);
      }
    }
    expect(nativeMove().defaultPrevented).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('replaces an old touch session without orphaning its interaction lock', () => {
    const f = mount();
    f.start();
    f.arm();
    f.move();
    f.start();
    expect(isLocked()).toBe(false);
    expect(f.controller.dragVisual).toBeNull();
    f.arm();
    expect(isLocked()).toBe(true);
    f.cancel();
    expect(isLocked()).toBe(false);
    expect(f.onCommit).not.toHaveBeenCalled();
  });

  it.each(['pending', 'armed', 'active'])('cancels a gesture in the %s phase when its card is removed but the controller stays mounted', phase => {
    const f = mount();
    f.start();
    if (phase !== 'pending') f.arm();
    if (phase === 'active') f.move();
    f.card.isConnected = false;
    f.rerender();
    f.arm();
    expect(isLocked()).toBe(false);
    expect(f.controller.dragVisual).toBeNull();
    expect(nativeMove().defaultPrevented).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    f.move();
    expect(f.controller.dragVisual).toBeNull();
    f.end();
    expect(f.onCommit).not.toHaveBeenCalled();
  });

  it('keeps another controller locked when the first controller ends or unmounts', () => {
    const first = mount();
    const second = mount();
    first.start();
    first.arm();
    first.move();
    second.start();
    second.arm();
    second.move();
    first.end();
    first.unmount();
    expect(isLocked()).toBe(true);
    expect(nativeMove().defaultPrevented).toBe(true);
    second.cancel();
    expect(isLocked()).toBe(false);
    expect(nativeMove().defaultPrevented).toBe(false);
  });

  it.each(['armed', 'active'])('does not restore a dismissed parent viewport lock when an %s drag unmounts', phase => {
    const f = mount(true, true);
    f.start();
    f.arm();
    if (phase === 'active') f.move();
    expect(isLocked()).toBe(true);
    f.unmount();
    expect(isLocked()).toBe(false);
    expect(nativeMove().defaultPrevented).toBe(false);
    expect(browserDocument.documentElement.style).toEqual({ overflow: '', overscrollBehavior: '' });
    expect(browserDocument.body.style).toEqual({ overflow: '', overscrollBehavior: '' });
    expect(f.onCommit).not.toHaveBeenCalled();
  });

  it('preserves a parent viewport lock when only the child drag is canceled', () => {
    const f = mount(true, true);
    f.start();
    f.arm();
    f.move();
    f.cancel();
    expect(isLocked()).toBe(false);
    expect(nativeMove().defaultPrevented).toBe(false);
    expect(browserDocument.documentElement.style).toEqual({ overflow: 'hidden', overscrollBehavior: 'none' });
    expect(browserDocument.body.style).toEqual({ overflow: 'hidden', overscrollBehavior: 'none' });
    f.unmount();
    expect(browserDocument.documentElement.style).toEqual({ overflow: '', overscrollBehavior: '' });
    expect(browserDocument.body.style).toEqual({ overflow: '', overscrollBehavior: '' });
  });

  it('releases the lock before a failed asynchronous save and permits the next drag', async () => {
    const f = mount();
    f.onCommit.mockRejectedValueOnce(new Error('save unavailable'));
    f.start();
    f.arm();
    f.move();
    f.end();
    expect(isLocked()).toBe(false);
    expect(nativeMove().defaultPrevented).toBe(false);
    await act(async () => { await Promise.resolve(); });
    f.start();
    f.arm();
    f.move();
    f.end();
    expect(f.onCommit).toHaveBeenCalledTimes(2);
    expect(isLocked()).toBe(false);
  });

  it('releases the lock even if the save callback throws synchronously', () => {
    const f = mount();
    const failure = new Error('save callback failed');
    f.onCommit.mockImplementationOnce(() => { throw failure; });
    f.start();
    f.arm();
    f.move();
    expect(() => f.end()).toThrow(failure);
    expect(isLocked()).toBe(false);
    expect(nativeMove().defaultPrevented).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves immediate-on-long-press drag mode and touch horizontal scroll position', () => {
    const f = mount(false);
    f.scroll.scrollLeft = 35;
    f.start();
    f.arm();
    expect(isLocked()).toBe(true);
    expect(f.controller.dragVisual).not.toBeNull();
    f.move(299, 160);
    expect(f.scroll.scrollLeft).toBe(35);
    f.end();
    expect(isLocked()).toBe(false);
    expect(f.onCommit).toHaveBeenCalledTimes(1);
  });

  it('preserves pointer dragging and its intentional horizontal edge scrolling', () => {
    const f = mount();
    function pointer(x: number, y: number) {
      return {
        pointerType: 'mouse', button: 0, isPrimary: true, pointerId: 1,
        currentTarget: f.card, clientX: x, clientY: y,
        preventDefault: vi.fn(), stopPropagation: vi.fn(),
      } as unknown as ReactPointerEvent<HTMLElement>;
    }
    act(() => f.controller.handlePointerDown(pointer(100, 100), descriptor));
    act(() => f.controller.handlePointerMove(pointer(299, 160)));
    expect(f.scroll.scrollLeft).toBeGreaterThan(0);
    expect(isLocked()).toBe(false);
    act(() => f.controller.handlePointerUp(pointer(299, 160)));
    expect(f.onCommit).toHaveBeenCalledTimes(1);
  });
});
