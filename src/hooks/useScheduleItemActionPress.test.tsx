import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SCHEDULE_ITEM_ACTION_INTENT_EVENT, useScheduleItemActionPress } from './useScheduleItemActionPress';
import { SCHEDULE_LONG_PRESS_MS } from '../lib/scheduleGestureTiming';

let renderer: ReactTestRenderer | undefined;
let press: ReturnType<typeof useScheduleItemActionPress<string>>;
class Target extends EventTarget {
  inside = false;
  closest() { return this.inside ? this : null; }
  getBoundingClientRect() { return { top: 30, left: 40, right: 140, bottom: 80, width: 100, height: 50 }; }
}
let element: HTMLElement;
function Harness() { press = useScheduleItemActionPress<string>(); return null; }
function start(kind: 'pointer' | 'touch' = 'touch') { act(() => press.start('a', 'item-a', '数学', kind, element, 50, 50)); }
function dispatch(type: string, target: Target, pointerType?: string) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, { target: { value: target }, pointerType: { value: pointerType } });
  act(() => { document.dispatchEvent(event); });
  return event;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
  vi.stubGlobal('document', new EventTarget());
  vi.stubGlobal('Element', Target);
  element = new Target() as unknown as HTMLElement;
  act(() => { renderer = create(<Harness />); });
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

it('short tap does not open or suppress its click', () => {
  start(); act(() => { vi.advanceTimersByTime(SCHEDULE_LONG_PRESS_MS - 1); });
  act(() => { expect(press.finish('a')).toBe(false); });
  expect(press.activeAction).toBeNull(); expect(press.shouldSuppressClick()).toBe(false);
});
it('opens while held and consumes release without replaying a click', () => {
  start(); act(() => { vi.advanceTimersByTime(400); });
  expect(press.activeAction).toMatchObject({ key: 'a', item: 'item-a', anchorElement: element, anchorRect: { left: 40, top: 30, width: 100, height: 50 } });
  act(() => { expect(press.finish('a')).toBe(true); });
  expect(press.activeAction).toBeNull();
  expect(press.shouldSuppressClick()).toBe(true);
  act(() => { window.dispatchEvent(new Event(SCHEDULE_ITEM_ACTION_INTENT_EVENT)); });
  expect(press.shouldSuppressClick()).toBe(false);
});
it.each(['touch', 'pointer'] as const)('a %s swipe before the hold never opens, even after returning to its origin', kind => {
  start(kind); act(() => { vi.advanceTimersByTime(100); press.move(60, 50); press.move(50, 50); vi.advanceTimersByTime(200); });
  expect(press.activeAction).toBeNull();
  act(() => { expect(press.finish('a')).toBe(false); });
  expect(press.activeAction).toBeNull();
});
it('permits touch jitter within the tolerance and opens at the exact threshold', () => {
  start(); act(() => { press.move(59, 50); vi.advanceTimersByTime(SCHEDULE_LONG_PRESS_MS); });
  expect(press.activeAction?.key).toBe('a');
  act(() => { expect(press.finish('a')).toBe(true); });
  act(() => { vi.advanceTimersByTime(700); });
  expect(press.shouldSuppressClick()).toBe(false);
});
it('uses a quick hold threshold just longer than a normal tap', () => {
  expect(SCHEDULE_LONG_PRESS_MS).toBeGreaterThanOrEqual(160);
  expect(SCHEDULE_LONG_PRESS_MS).toBeLessThanOrEqual(180);
});
it.each(['touch', 'pointer'] as const)('%s release just under the hold threshold stays a tap; just over opens', kind => {
  start(kind); act(() => { vi.advanceTimersByTime(120); });
  act(() => { expect(press.finish('a')).toBe(false); });
  expect(press.activeAction).toBeNull(); expect(press.shouldSuppressClick()).toBe(false);
  start(kind); act(() => { vi.advanceTimersByTime(SCHEDULE_LONG_PRESS_MS - 1); });
  act(() => { expect(press.finish('a')).toBe(false); });
  expect(press.activeAction).toBeNull();
  start(kind); act(() => { vi.advanceTimersByTime(SCHEDULE_LONG_PRESS_MS + 1); });
  expect(press.activeAction?.key).toBe('a');
  act(() => { expect(press.finish('a')).toBe(true); }); expect(press.shouldSuppressClick()).toBe(true);
});
it('movement after the threshold belongs to the ring until release', () => {
  start(); act(() => { vi.advanceTimersByTime(SCHEDULE_LONG_PRESS_MS + 1); });
  const moved = vi.fn(); const released = vi.fn();
  press.activeAction!.gesture!.onMove = moved; press.activeAction!.gesture!.onRelease = released;
  act(() => { press.move(50, 100); });
  expect(moved).toHaveBeenCalledWith({ x: 50, y: 100 });
  act(() => { expect(press.finish('a')).toBe(true); });
  expect(released).toHaveBeenCalledOnce();
  act(() => { expect(press.finish('a')).toBe(false); });
  expect(released).toHaveBeenCalledOnce();
  expect(press.activeAction).toBeNull();
});
it('cancel and a release for another event never open', () => {
  start(); act(() => { vi.advanceTimersByTime(300); press.cancel(); });
  act(() => { expect(press.finish('a')).toBe(false); });
  start(); act(() => { vi.advanceTimersByTime(300); });
  act(() => { expect(press.finish('b')).toBe(false); });
  expect(press.activeAction).toBeNull();
});
it('open replaces the same or another event and cancels a pending hold', () => {
  start(); act(() => { press.open('b', 'item-b', '英語', element); });
  const previous = press.activeAction;
  act(() => { press.open('b', 'replacement', '英語2', element); vi.advanceTimersByTime(300); });
  expect(press.activeAction).not.toBe(previous);
  expect(press.activeAction).toMatchObject({ key: 'b', item: 'replacement', title: '英語2' });
  act(() => { expect(press.finish('a')).toBe(false); press.dismiss(); });
  expect(press.activeAction).toBeNull();
});
it.each(['scroll', 'resize'])('%s dismisses the open menu', type => {
  act(() => { press.open('a', 'item', '数学', element); });
  act(() => { window.dispatchEvent(new Event(type)); });
  expect(press.activeAction).toBeNull();
});
it('ignores menu pointerdown and dismisses on an outside mouse pointerdown', () => {
  act(() => { press.open('a', 'item', '数学', element); });
  const inside = new Target(); inside.inside = true;
  dispatch('pointerdown', inside, 'touch'); expect(press.activeAction?.key).toBe('a');
  const event = dispatch('pointerdown', new Target(), 'mouse');
  expect(press.activeAction).toBeNull(); expect(event.defaultPrevented).toBe(true);
});
it.each(['touch', 'mouse', 'pen'])('swallows an outside %s gesture and its click exactly once', pointerType => {
  act(() => { press.open('a', 'item', '数学', element); });
  const outside = new Target();
  const pointerObserver = vi.fn(); document.addEventListener('pointerdown', pointerObserver);
  const down = dispatch('pointerdown', outside, pointerType);
  expect(down.defaultPrevented).toBe(true); expect(pointerObserver).not.toHaveBeenCalled();
  expect(press.activeAction).toBeNull();
  const activation = vi.fn(); document.addEventListener('click', activation);
  expect(dispatch('click', outside).defaultPrevented).toBe(true);
  expect(activation).not.toHaveBeenCalled();
  expect(dispatch('click', outside).defaultPrevented).toBe(false);
  expect(activation).toHaveBeenCalledOnce();
});
it.each(['touch', 'mouse', 'pen'].flatMap(pointerType => ['new gesture', 'timeout', 'unmount', 'reopen'].map(cause => ({ pointerType, cause }))))('cleans a $pointerType click guard on $cause', ({ pointerType, cause }) => {
  act(() => { press.open('a', 'item', '数学', element); });
  const outside = new Target(); dispatch('pointerdown', outside, pointerType);
  if (cause === 'new gesture') dispatch('pointerdown', outside, 'mouse');
  else if (cause === 'timeout') act(() => { vi.advanceTimersByTime(700); });
  else if (cause === 'reopen') act(() => { press.open('b', 'item-b', '英語', element); });
  else { act(() => renderer?.unmount()); renderer = undefined; }
  expect(dispatch('click', outside).defaultPrevented).toBe(false);
});

function nativeInput(type: string, fields: Record<string, unknown>) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, { value }])));
  act(() => { window.dispatchEvent(event); });
  return event;
}
it('keeps pointer identity and consumes the owning release exactly once', () => {
  act(() => { press.start('a', 'a', '数学', 'pointer', element, 50, 50, 7); vi.advanceTimersByTime(170); });
  const move = vi.fn(); const release = vi.fn();
  press.activeAction!.gesture!.onMove = move; press.activeAction!.gesture!.onRelease = release;
  nativeInput('pointermove', { pointerId: 8, clientX: 90, clientY: 90 });
  nativeInput('pointerup', { pointerId: 8, clientX: 90, clientY: 90 });
  expect(move).not.toHaveBeenCalled(); expect(release).not.toHaveBeenCalled();
  expect(nativeInput('pointermove', { pointerId: 7, clientX: 90, clientY: 90 }).defaultPrevented).toBe(true);
  expect(nativeInput('pointerup', { pointerId: 7, clientX: 90, clientY: 90 }).defaultPrevented).toBe(true);
  act(() => { press.finish('a'); });
  expect(release).toHaveBeenCalledOnce(); expect(press.shouldSuppressClick()).toBe(true);
});
it.each(['touchcancel', 'blur', 'pagehide'])('%s cancels a held selection without executing', type => {
  start(); act(() => { vi.advanceTimersByTime(170); });
  const release = vi.fn(); press.activeAction!.gesture!.onRelease = release;
  nativeInput(type, {});
  expect(press.activeAction).toBeNull(); expect(release).not.toHaveBeenCalled();
});
it('a second touch cancels; unrelated touch release cannot execute', () => {
  act(() => { press.start('a', 'a', '数学', 'touch', element, 50, 50, 3); vi.advanceTimersByTime(170); });
  const release = vi.fn(); press.activeAction!.gesture!.onRelease = release;
  nativeInput('touchend', { changedTouches: [{ identifier: 4, clientX: 50, clientY: 100 }] });
  expect(release).not.toHaveBeenCalled();
  nativeInput('touchstart', { touches: [{ identifier: 3 }, { identifier: 4 }] });
  expect(press.activeAction).toBeNull(); expect(release).not.toHaveBeenCalled();
});

it('a second pointer cancels even above the menu and cannot release the original selection', () => {
  act(() => { press.start('a', 'a', '数学', 'pointer', element, 50, 50, 7); vi.advanceTimersByTime(170); });
  const release = vi.fn(); press.activeAction!.gesture!.onRelease = release;
  const inside = new Target(); inside.inside = true;
  expect(nativeInput('pointerdown', { pointerId: 8, pointerType: 'pen', target: inside }).defaultPrevented).toBe(true);
  nativeInput('pointerup', { pointerId: 7, clientX: 90, clientY: 90 });
  expect(press.activeAction).toBeNull(); expect(release).not.toHaveBeenCalled();
  expect(press.shouldSuppressClick()).toBe(true);
});
it('the browser context menu cannot replace an owned continuous gesture', () => {
  start(); act(() => { vi.advanceTimersByTime(170); });
  const active = press.activeAction;
  expect(nativeInput('contextmenu', {}).defaultPrevented).toBe(true);
  expect(press.activeAction).toBe(active);
});

it('touch compatibility pointercancel does not retire the owning touch stream', () => {
  start(); act(() => { vi.advanceTimersByTime(170); });
  nativeInput('pointercancel', { pointerId: 7, pointerType: 'touch' });
  expect(press.activeAction).not.toBeNull();
  nativeInput('touchcancel', {});
  expect(press.activeAction).toBeNull();
});
it('pointercancel retires only its owning pointer', () => {
  act(() => { press.start('a', 'a', '数学', 'pointer', element, 50, 50, 7); vi.advanceTimersByTime(170); });
  nativeInput('pointercancel', { pointerId: 8 }); expect(press.activeAction).not.toBeNull();
  nativeInput('pointercancel', { pointerId: 7 }); expect(press.activeAction).toBeNull();
});
