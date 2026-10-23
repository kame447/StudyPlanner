import type { MouseEvent, TouchEvent } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSwipeNavigation } from './useSwipeNavigation';

class Target {
  constructor(public selector = '', public scrollWidth = 300, public clientWidth = 300) {}
  closest(selector: string) {
    return this.selector && selector.split(',').includes(this.selector) ? this : null;
  }
}
let renderer: ReactTestRenderer;
let handlers: ReturnType<typeof useSwipeNavigation>;
const previous = vi.fn();
const next = vi.fn();
function Harness({ disabled = false }) {
  handlers = useSwipeNavigation({ onPrevious: previous, onNext: next, disabled });
  return null;
}
function touch(x: number, y = 0, target = new Target(), count = 1) {
  return { target, touches: Array.from({ length: count }, () => ({ clientX: x, clientY: y })) } as unknown as TouchEvent<HTMLElement>;
}
function swipe(x: number, y = 0, target = new Target()) {
  handlers.onTouchStart(touch(100, 100, target));
  handlers.onTouchMove(touch(100 + x, 100 + y, target));
  handlers.onTouchEnd();
}
beforeEach(() => {
  previous.mockClear(); next.mockClear();
  vi.stubGlobal('Element', Target);
  act(() => { renderer = create(<Harness />); });
});
afterEach(() => { act(() => renderer.unmount()); vi.unstubAllGlobals(); });

describe('shared calendar swipe navigation', () => {
  it('uses the day threshold and direction, once per gesture', () => {
    swipe(-90); handlers.onTouchEnd(); expect(next).toHaveBeenCalledTimes(1);
    swipe(90); expect(previous).toHaveBeenCalledTimes(1);
    swipe(-71); swipe(-90, 100); expect(next).toHaveBeenCalledTimes(1);
  });
  it.each(['input', 'textarea', 'select', '[contenteditable]:not([contenteditable="false"])',
    '[role="dialog"]', '[data-schedule-occurrence-id]', '.schedule-week-plan-button',
    '[data-swipe-ignore="true"]', '.month-event-chip-list'])('leaves %s interactions alone', selector => {
    swipe(-100, 0, new Target(selector)); expect(next).not.toHaveBeenCalled();
  });
  it('preserves real horizontal overflow while allowing a fitting weekly grid', () => {
    swipe(-100, 0, new Target('.schedule-week-preview-scroll', 620, 320));
    expect(next).not.toHaveBeenCalled();
    swipe(-100, 0, new Target('.schedule-week-preview-scroll'));
    expect(next).toHaveBeenCalledTimes(1);
  });
  it('cancels on touch cancellation or multitouch, without stale navigation', () => {
    handlers.onTouchStart(touch(100)); handlers.onTouchMove(touch(0));
    handlers.onTouchCancel(); handlers.onTouchEnd();
    handlers.onTouchStart(touch(100)); handlers.onTouchMove(touch(0));
    handlers.onTouchMove(touch(0, 0, new Target(), 2)); handlers.onTouchEnd();
    expect(next).not.toHaveBeenCalled();
  });
  it('does not navigate after disabling during an active gesture', () => {
    handlers.onTouchStart(touch(100)); handlers.onTouchMove(touch(0));
    act(() => renderer.update(<Harness disabled />)); handlers.onTouchEnd();
    expect(next).not.toHaveBeenCalled();
  });
  it('suppresses the synthetic click after swiping but preserves the next deliberate tap', () => {
    swipe(-100);
    const click = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    handlers.onClickCapture(click as unknown as MouseEvent<HTMLElement>);
    expect(click.preventDefault).toHaveBeenCalledOnce();
    handlers.onTouchStart(touch(100)); handlers.onTouchEnd();
    handlers.onClickCapture(click as unknown as MouseEvent<HTMLElement>);
    expect(click.preventDefault).toHaveBeenCalledOnce();
  });
});
