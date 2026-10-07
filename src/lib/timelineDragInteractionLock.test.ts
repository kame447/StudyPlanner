import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acquireTimelineDragInteractionLock, isTimelineDragInteractionLocked } from './timelineDragInteractionLock';
import { BrowserEventTarget } from './timelineDragInteractionLock.testUtils';

function elementState(overflow: string, overscrollBehavior: string) {
  const classes = new Set<string>();
  return {
    style: { overflow, overscrollBehavior },
    classList: {
      add: (value: string) => classes.add(value),
      remove: (value: string) => classes.delete(value),
      contains: (value: string) => classes.has(value),
    },
    scrollTop: 150,
    scrollLeft: 20,
  };
}

describe('timeline drag interaction lock ownership', () => {
  let browserWindow: EventTarget;
  let root: ReturnType<typeof elementState>;
  let body: ReturnType<typeof elementState>;
  let releases: (() => void)[];

  beforeEach(() => {
    releases = [];
    browserWindow = new BrowserEventTarget();
    root = elementState('auto', 'contain');
    body = elementState('scroll', 'auto');
    vi.stubGlobal('window', browserWindow);
    vi.stubGlobal('document', { documentElement: root, body });
  });

  afterEach(() => {
    releases.forEach(release => release());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function acquire() {
    const release = acquireTimelineDragInteractionLock();
    releases.push(release);
    return release;
  }

  function move(cancelable = true) {
    const event = new Event('touchmove', { cancelable });
    browserWindow.dispatchEvent(event);
    return event;
  }

  it('installs a non-passive capture listener without changing inline styles or scroll offsets', () => {
    const add = vi.spyOn(browserWindow, 'addEventListener');
    const remove = vi.spyOn(browserWindow, 'removeEventListener');
    expect(move().defaultPrevented).toBe(false);
    const release = acquire();
    expect(isTimelineDragInteractionLocked()).toBe(true);
    expect(add).toHaveBeenCalledWith('touchmove', expect.any(Function), { capture: true, passive: false });
    expect(move().defaultPrevented).toBe(true);
    expect(root.style).toEqual({ overflow: 'auto', overscrollBehavior: 'contain' });
    expect(body.style).toEqual({ overflow: 'scroll', overscrollBehavior: 'auto' });
    release();
    expect(isTimelineDragInteractionLocked()).toBe(false);
    expect(remove).toHaveBeenCalledWith('touchmove', add.mock.calls[0][1], true);
    expect(move().defaultPrevented).toBe(false);
    expect(root.style).toEqual({ overflow: 'auto', overscrollBehavior: 'contain' });
    expect(body.style).toEqual({ overflow: 'scroll', overscrollBehavior: 'auto' });
    expect([root.scrollTop, root.scrollLeft, body.scrollTop, body.scrollLeft]).toEqual([150, 20, 150, 20]);
  });

  it('blocks wheel scrolling during the touch lock and restores it after release', () => {
    const add = vi.spyOn(browserWindow, 'addEventListener');
    const wheel = () => {
      const event = new Event('wheel', { cancelable: true });
      browserWindow.dispatchEvent(event);
      return event;
    };
    expect(wheel().defaultPrevented).toBe(false);
    const release = acquire();
    expect(add).toHaveBeenCalledWith('wheel', expect.any(Function), { capture: true, passive: false });
    expect(wheel().defaultPrevented).toBe(true);
    release();
    expect(wheel().defaultPrevented).toBe(false);
  });

  it.each([true, false])('keeps nested owners locked until the final release (first owner releases first: %s)', firstOwnerFirst => {
    const add = vi.spyOn(browserWindow, 'addEventListener');
    const first = acquire();
    const second = acquire();
    const [earlier, later] = firstOwnerFirst ? [first, second] : [second, first];
    expect(add.mock.calls.filter(([type]) => type === 'touchmove')).toHaveLength(1);
    earlier();
    earlier();
    expect(isTimelineDragInteractionLocked()).toBe(true);
    expect(move().defaultPrevented).toBe(true);
    expect(body.style.overflow).toBe('scroll');
    later();
    expect(isTimelineDragInteractionLocked()).toBe(false);
    expect(move().defaultPrevented).toBe(false);
    expect(body.style.overflow).toBe('scroll');
  });

  it('does not let an old release unlock a later independent drag', () => {
    const first = acquire();
    first();
    body.style.overflow = 'clip';
    const second = acquire();
    first();
    expect(isTimelineDragInteractionLocked()).toBe(true);
    second();
    expect(isTimelineDragInteractionLocked()).toBe(false);
    expect(body.style.overflow).toBe('clip');
  });

  it('does not overwrite newer styles applied by another viewport owner before release', () => {
    const release = acquire();
    root.style.overflow = 'clip';
    root.style.overscrollBehavior = 'auto';
    body.style.overflow = 'auto';
    body.style.overscrollBehavior = 'contain';
    release();
    expect(root.style).toEqual({ overflow: 'clip', overscrollBehavior: 'auto' });
    expect(body.style).toEqual({ overflow: 'auto', overscrollBehavior: 'contain' });
    expect(isTimelineDragInteractionLocked()).toBe(false);
    expect(move().defaultPrevented).toBe(false);
  });

  it.each(['touchmove', 'wheel'])('leaves non-cancelable %s events alone', type => {
    acquire();
    const event = new Event(type, { cancelable: false });
    const preventDefault = vi.spyOn(event, 'preventDefault');
    browserWindow.dispatchEvent(event);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('is harmless without a browser document or body', () => {
    vi.stubGlobal('document', undefined);
    expect(isTimelineDragInteractionLocked()).toBe(false);
    expect(() => acquire()()).not.toThrow();
    vi.stubGlobal('document', { documentElement: root, body: null });
    expect(() => acquire()()).not.toThrow();
    vi.stubGlobal('document', { documentElement: root, body });
    const release = acquire();
    expect(isTimelineDragInteractionLocked()).toBe(true);
    release();
    expect(isTimelineDragInteractionLocked()).toBe(false);
  });
});
