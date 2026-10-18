import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SCHEDULE_ITEM_ACTION_INTENT_EVENT, useScheduleItemActionPress } from './useScheduleItemActionPress';

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
  start(); act(() => { vi.advanceTimersByTime(239); });
  act(() => { expect(press.finish('a')).toBe(false); });
  expect(press.activeAction).toBeNull(); expect(press.shouldSuppressClick()).toBe(false);
});
it('opens only on release after a stationary hold and suppresses the synthetic click', () => {
  start(); act(() => { vi.advanceTimersByTime(400); });
  expect(press.activeAction).toBeNull();
  act(() => { expect(press.finish('a')).toBe(true); });
  expect(press.activeAction).toMatchObject({ key: 'a', item: 'item-a', anchorElement: element, anchorRect: { left: 40, top: 30, width: 100, height: 50 } });
  expect(press.shouldSuppressClick()).toBe(true);
  act(() => { window.dispatchEvent(new Event(SCHEDULE_ITEM_ACTION_INTENT_EVENT)); });
  expect(press.shouldSuppressClick()).toBe(false);
});
it.each(['touch', 'pointer'] as const)('a %s hold that moves never opens, even after returning to its origin', kind => {
  start(kind); act(() => { vi.advanceTimersByTime(300); press.move(60, 50); press.move(50, 50); });
  expect(press.activeAction).toBeNull();
  act(() => { expect(press.finish('a')).toBe(false); });
  expect(press.activeAction).toBeNull();
});
it('permits touch jitter within the tolerance and opens at the exact threshold', () => {
  start(); act(() => { vi.advanceTimersByTime(240); press.move(59, 50); });
  act(() => { expect(press.finish('a')).toBe(true); });
  expect(press.activeAction?.key).toBe('a');
  act(() => { vi.advanceTimersByTime(700); });
  expect(press.shouldSuppressClick()).toBe(false);
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
  expect(press.activeAction).toBeNull(); expect(event.defaultPrevented).toBe(false);
});
it('swallows an outside touch and its click exactly once', () => {
  act(() => { press.open('a', 'item', '数学', element); });
  const outside = new Target();
  expect(dispatch('pointerdown', outside, 'touch').defaultPrevented).toBe(true);
  expect(press.activeAction).toBeNull();
  expect(dispatch('click', outside).defaultPrevented).toBe(true);
  expect(dispatch('click', outside).defaultPrevented).toBe(false);
});
it.each(['new gesture', 'timeout', 'unmount'])('cleans a touch click guard on %s', cause => {
  act(() => { press.open('a', 'item', '数学', element); });
  const outside = new Target(); dispatch('pointerdown', outside, 'touch');
  if (cause === 'new gesture') dispatch('pointerdown', outside, 'mouse');
  else if (cause === 'timeout') act(() => { vi.advanceTimersByTime(700); });
  else { act(() => renderer?.unmount()); renderer = undefined; }
  expect(dispatch('click', outside).defaultPrevented).toBe(false);
});
