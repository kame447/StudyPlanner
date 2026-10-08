import type { ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserEventTarget } from '../lib/timelineDragInteractionLock.testUtils';
import type { Plan } from '../types/domain';
import type { WeekView as WeekViewComponent } from './WeekView';

vi.mock('react-dom', async importOriginal => ({
  ...await importOriginal<typeof import('react-dom')>(),
  createPortal: (children: ReactNode) => children,
}));

const plan: Plan = {
  id: 'plan', seriesId: 'plan', userId: 'owner', title: '数学', subject: '数学', type: 'study',
  date: '2026-10-07', startTime: '09:00', endTime: '10:00', repeat: 'none', repeatUntil: null,
  excludedDates: [], recurrenceRules: [], memo: '',
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
};

describe('WeekView touch drag lifecycle', () => {
  let WeekView: typeof WeekViewComponent;
  let renderer: ReactTestRenderer | undefined;
  let browserWindow: BrowserEventTarget;
  let browserDocument: BrowserEventTarget & { visibilityState: string };
  let classes: Set<string>;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    classes = new Set();
    browserWindow = Object.assign(new BrowserEventTarget(), {
      setTimeout, clearTimeout, matchMedia: () => ({ matches: false }),
    });
    browserDocument = Object.assign(new BrowserEventTarget(), {
      visibilityState: 'visible',
      documentElement: {
        classList: {
          add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name),
          contains: (name: string) => classes.has(name),
        },
        style: { overflow: '', overscrollBehavior: '' },
      },
      body: { style: { overflow: '', overscrollBehavior: '' } },
    });
    vi.stubGlobal('window', browserWindow);
    vi.stubGlobal('document', browserDocument);
    vi.stubGlobal('navigator', { vibrate: vi.fn() });
    ({ WeekView } = await import('./WeekView'));
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const isLocked = () => classes.has('is-timeline-drag-interaction-locked');
  function nativeMove() {
    const event = new Event('touchmove', { cancelable: true });
    browserWindow.dispatchEvent(event);
    return event.defaultPrevented;
  }
  const overlays = () => renderer!.root.findAll(node =>
    typeof node.props.className === 'string' && node.props.className.includes('schedule-week-drag-overlay'),
  );

  function mount() {
    const onMovePlan = vi.fn(async () => undefined);
    const scroll = {
      scrollLeft: 35, scrollTop: 120, scrollWidth: 900, clientWidth: 300,
      getBoundingClientRect: () => ({ left: 0, right: 300 }),
    };
    const column = { getBoundingClientRect: () => ({ width: 300, height: 1440 }) };
    const card = {
      isConnected: true,
      closest: (selector: string) => selector === '.schedule-week-preview-scroll' ? scroll : column,
      getBoundingClientRect: () => ({ left: 20, top: 80, width: 260, height: 60 }),
    };
    act(() => {
      renderer = create(<WeekView selectedDate={plan.date} plans={[plan]} actuals={[]}
        onOpenDay={vi.fn()} onMovePlan={onMovePlan} />);
    });
    const handlers = renderer!.root.findAllByType('button').find(button =>
      button.props.className?.includes('schedule-week-plan-button'),
    )!.props;
    const touch = (y = 100, count = 1) => ({
      currentTarget: card,
      touches: Array.from({ length: count }, (_, identifier) => ({ identifier, clientX: 100, clientY: y })),
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    });
    return {
      onMovePlan, scroll, card,
      start() { act(() => handlers.onTouchStart(touch())); },
      arm() { act(() => { vi.advanceTimersByTime(240); }); },
      move() {
        const event = touch(160);
        act(() => handlers.onTouchMove(event));
        return event;
      },
      async end() { await act(async () => handlers.onTouchEnd(touch(160, 0))); },
      cancel() { act(() => handlers.onTouchCancel()); },
      unmount() { act(() => renderer!.unmount()); renderer = undefined; },
      showActuals() {
        card.isConnected = false;
        const button = renderer!.root.findAllByType('button').find(node => node.children.join('') === '記録');
        act(() => button!.props.onClick());
      },
    };
  }

  it('blocks the first native movement after a stationary long press, then commits and unlocks', async () => {
    const f = mount();
    f.start();
    expect(nativeMove()).toBe(false);
    f.arm();
    expect(isLocked()).toBe(true);
    expect(overlays()).toHaveLength(0);
    expect(nativeMove()).toBe(true);
    f.move();
    expect(overlays()).toHaveLength(1);
    expect(f.scroll.scrollLeft).toBe(35);
    expect(f.scroll.scrollTop).toBe(120);
    await f.end();
    expect(f.onMovePlan).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: plan.id }), {
      date: plan.date, startTime: '10:00', endTime: '11:00',
    });
    expect(isLocked()).toBe(false);
    expect(nativeMove()).toBe(false);
    expect(overlays()).toHaveLength(0);
  });

  it('keeps an ordinary pre-long-press swipe scrollable without moving the plan', async () => {
    const f = mount();
    f.start();
    const event = f.move();
    f.arm();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(isLocked()).toBe(false);
    expect(nativeMove()).toBe(false);
    expect(overlays()).toHaveLength(0);
    await f.end();
    expect(f.onMovePlan).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'multitouch', 'hidden', 'unmount'])('unlocks an active weekly drag on %s without saving', interruption => {
    const f = mount();
    f.start();
    f.arm();
    f.move();
    expect(isLocked()).toBe(true);
    if (interruption === 'cancel') f.cancel();
    if (interruption === 'unmount') f.unmount();
    if (interruption === 'hidden') {
      browserDocument.visibilityState = 'hidden';
      act(() => { browserDocument.dispatchEvent(new Event('visibilitychange')); });
    }
    if (interruption === 'multitouch') {
      const event = new Event('touchstart');
      Object.defineProperty(event, 'touches', { value: [{ identifier: 0 }, { identifier: 1 }] });
      act(() => { browserWindow.dispatchEvent(event); });
    }
    expect(isLocked()).toBe(false);
    expect(nativeMove()).toBe(false);
    expect(f.onMovePlan).not.toHaveBeenCalled();
    if (renderer) expect(overlays()).toHaveLength(0);
  });

  it.each(['pending', 'armed', 'active'])('unlocks when changing to actuals removes the card in the %s phase', async phase => {
    const f = mount();
    f.start();
    if (phase !== 'pending') f.arm();
    if (phase === 'active') f.move();
    f.showActuals();
    f.arm();
    f.move();
    expect(isLocked()).toBe(false);
    expect(nativeMove()).toBe(false);
    expect(overlays()).toHaveLength(0);
    await f.end();
    expect(f.onMovePlan).not.toHaveBeenCalled();
  });
});
