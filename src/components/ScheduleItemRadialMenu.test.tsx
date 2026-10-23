import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RADIAL_POP_MS, RADIAL_REVEAL_MS, ScheduleItemRadialMenu, type ScheduleItemRadialMenuProps } from './ScheduleItemRadialMenu';
import { SCHEDULE_ITEM_ACTION_INTENT_EVENT, type ActiveScheduleItemAction } from '../hooks/useScheduleItemActionPress';
import { SCHEDULE_RADIAL_ACTION_LABELS, SCHEDULE_RADIAL_ACTION_ORDER } from '../lib/scheduleRadialActions';
import { resetMotionPreferenceForTests, setMotionPreference } from '../lib/motionPreference';

const portal = vi.hoisted(() => ({ destinations: [] as unknown[] }));
vi.mock('react-dom', () => ({ createPortal: (children: ReactNode, destination: unknown) => { portal.destinations.push(destination); return children; } }));

class FocusTarget {
  isConnected = true;
  focus = vi.fn((_options?: FocusOptions) => { activeElement = this; });
  blur = vi.fn(() => { if (activeElement === this) activeElement = null; });
}
let activeElement: FocusTarget | null;
let renderer: ReactTestRenderer | undefined;
let props: ScheduleItemRadialMenuProps<string>;
let origin: FocusTarget;
let reduced: boolean;
let nodes: Map<string, FocusTarget>;
let safePadding: Record<string, string>;
let intent: ReturnType<typeof vi.fn>;
const click = () => ({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
const items = () => renderer!.root.findAllByProps({ role: 'menuitem' });
const menu = () => renderer!.root.findByProps({ role: 'menu' });
function key(key: string, shiftKey = false) { const event = { ...click(), key, shiftKey }; act(() => menu().props.onKeyDown(event)); return event; }
function mount() {
  act(() => { renderer = create(<ScheduleItemRadialMenu {...props} />, {
    createNodeMock: element => {
      if (element.type !== 'button') return {};
      // React test renderer asks for a mock again when an inline ref is
      // reattached; a browser keeps the same DOM node across that render.
      const id = element.props['data-action'];
      const target = nodes.get(id) ?? new FocusTarget(); nodes.set(id, target); return target;
    },
  }); });
}
function update(action: ActiveScheduleItemAction<string> | null) { props = { ...props, action }; act(() => { renderer!.update(<ScheduleItemRadialMenu {...props} />); }); }
beforeEach(() => {
  vi.useFakeTimers(); resetMotionPreferenceForTests();
  activeElement = null; reduced = false; nodes = new Map(); safePadding = {};
  const storage = new Map<string, string>();
  vi.stubGlobal('window', Object.assign(new EventTarget(), {
    innerWidth: 390, innerHeight: 844, setTimeout, clearTimeout,
    getComputedStyle: () => safePadding,
    matchMedia: () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }),
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
  }));
  vi.stubGlobal('document', { body: {}, get activeElement() { return activeElement; }, documentElement: { dataset: {} } });
  origin = new FocusTarget(); portal.destinations = [];
  intent = vi.fn(); window.addEventListener(SCHEDULE_ITEM_ACTION_INTENT_EVENT, intent);
  props = {
    action: { key: 'plan-a', title: '数学', item: 'a', left: 0, top: 0,
      anchorRect: { top: 0, left: 0, width: 100, height: 40, right: 100, bottom: 40 }, anchorElement: origin as unknown as HTMLElement },
    actions: SCHEDULE_RADIAL_ACTION_ORDER.map(id => ({ id, label: SCHEDULE_RADIAL_ACTION_LABELS[id] })),
    onDismiss: vi.fn(), onSelect: vi.fn(),
  };
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; resetMotionPreferenceForTests(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('portals six labelled circular icon buttons to body in clockwise order with one pop per delay slot', () => {
  mount();
  expect(portal.destinations.every(destination => destination === document.body)).toBe(true);
  expect(menu().props['aria-label']).toBe('数学の操作');
  expect(menu().props['data-schedule-item-delete-action']).toBe('true');
  expect(items().map(item => item.props['data-action'])).toEqual(SCHEDULE_RADIAL_ACTION_ORDER);
  expect(items().map(item => item.props['aria-label'])).toEqual(['完了', '編集', '複製', '削除', '実績', '移動']);
  expect(items().map(item => item.props.style['--radial-index'])).toEqual([0, 1, 2, 3, 4, 5]);
  expect(items().map(item => item.props.style['--radial-delay'])).toEqual(['0ms', '14ms', '28ms', '42ms', '56ms', '70ms']);
  expect(items().every(item => item.props.style['--radial-duration'] === `${RADIAL_POP_MS}ms`)).toBe(true);
  // The last (6th) button finishes popping within ~210ms of the reveal.
  expect(RADIAL_REVEAL_MS).toBeLessThanOrEqual(220);
  items().forEach(item => {
    expect(item.props.type).toBe('button'); // Native Enter/Space activation.
    expect(item.props.style.width).toBeGreaterThanOrEqual(44);
    expect(item.findAllByType('svg')).toHaveLength(1);
    expect(item.findAllByType('span').some(span => span.children.join('') === item.props['aria-label'])).toBe(true);
  });
  expect(activeElement).toBe(nodes.get('complete'));
  expect(nodes.get('complete')?.focus).toHaveBeenCalledWith({ preventScroll: true });
});
it('cycles both arrows and Tab clockwise, backwards and across the wrap', () => {
  mount(); key('ArrowRight'); expect(activeElement).toBe(nodes.get('edit'));
  key('ArrowDown'); expect(activeElement).toBe(nodes.get('duplicate'));
  key('ArrowLeft'); expect(activeElement).toBe(nodes.get('edit'));
  key('ArrowUp'); expect(activeElement).toBe(nodes.get('complete'));
  key('Tab', true); expect(activeElement).toBe(nodes.get('move'));
  const event = key('Tab'); expect(activeElement).toBe(nodes.get('complete'));
  expect(event.preventDefault).toHaveBeenCalled();
});
it.each(['Enter', ' '])('%s clears click suppression before native button activation', activationKey => {
  mount(); const event = key(activationKey);
  expect(intent).toHaveBeenCalledOnce(); expect(event.preventDefault).not.toHaveBeenCalled();
});
it('Escape dismisses and restores the connected event without scrolling', () => {
  mount(); const event = key('Escape');
  expect(props.onDismiss).toHaveBeenCalledOnce(); expect(event.stopPropagation).toHaveBeenCalled();
  expect(origin.focus).toHaveBeenCalledWith({ preventScroll: true }); expect(activeElement).toBe(origin);
});
it('does not focus a removed event', () => {
  origin.isConnected = false; mount(); key('Escape');
  expect(props.onDismiss).toHaveBeenCalledOnce(); expect(origin.focus).not.toHaveBeenCalled();
});
it('dispatches intent, dismisses, then selects immediately without waiting for animation', () => {
  const order: string[] = []; window.addEventListener(SCHEDULE_ITEM_ACTION_INTENT_EVENT, () => order.push('intent'));
  props.onDismiss = vi.fn(() => { order.push('dismiss'); update(null); });
  props.onSelect = vi.fn((id, item) => { order.push(`${id}:${item}`); });
  mount(); act(() => items()[0].props.onClick(click()));
  expect(order).toEqual(['intent', 'dismiss', 'complete:a']);
  expect(menu().props['data-closing']).toBe(true); expect(menu().props['aria-hidden']).toBe(true);
  expect(items().every(item => item.props.tabIndex === -1)).toBe(true);
  act(() => items()[0].props.onClick(click())); expect(props.onSelect).toHaveBeenCalledOnce();
  act(() => { vi.advanceTimersByTime(139); }); expect(renderer!.toJSON()).not.toBeNull();
  act(() => { vi.advanceTimersByTime(1); }); expect(renderer!.toJSON()).toBeNull();
});
it('retains the six visual buttons when the caller clears descriptors on dismiss and restores focus out of the hidden ring', () => {
  mount(); props = { ...props, actions: [] }; update(null);
  expect(items()).toHaveLength(6); expect(activeElement).toBe(origin);
  expect(origin.focus).toHaveBeenCalledWith({ preventScroll: true });
});
it.each(['standard', 'reduced', 'off'] as const)('%s never takes focus back from a dialog opened by the selected action', level => {
  setMotionPreference(level); mount(); const dialog = new FocusTarget(); dialog.focus(); update(null);
  expect(activeElement).toBe(dialog); expect(origin.focus).not.toHaveBeenCalled();
});
it.each(['standard', 'reduced', 'off'] as const)('%s blurs the closing menuitem when its event was removed', level => {
  setMotionPreference(level); mount(); origin.isConnected = false; const item = nodes.get('complete')!; update(null);
  expect(item.blur).toHaveBeenCalledOnce(); expect(activeElement).toBeNull();
});
it.each(['standard', 'reduced', 'off'] as const)('%s restores focus to the anchor when an outside gesture dismisses the menu', level => {
  setMotionPreference(level); mount(); update(null);
  expect(activeElement).toBe(origin); expect(origin.focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(renderer!.toJSON() === null).toBe(level !== 'standard');
});
it.each(['standard', 'reduced', 'off'] as const)('%s restores focus after keyboard-selecting complete', level => {
  setMotionPreference(level);
  props.onDismiss = vi.fn(() => update(null));
  mount(); key('Enter'); act(() => items()[0].props.onClick(click()));
  expect(props.onSelect).toHaveBeenCalledWith('complete', 'a');
  expect(activeElement).toBe(origin); expect(origin.focus).toHaveBeenCalledWith({ preventScroll: true });
});
it.each(['standard', 'reduced', 'off'] as const)('%s preserves focus acquired synchronously by an editor during selection', level => {
  setMotionPreference(level); const editor = new FocusTarget();
  props.onDismiss = vi.fn(() => update(null)); props.onSelect = vi.fn(() => editor.focus());
  mount(); act(() => items()[1].props.onClick(click()));
  expect(props.onSelect).toHaveBeenCalledWith('edit', 'a');
  expect(activeElement).toBe(editor);
  act(() => { vi.advanceTimersByTime(200); }); expect(activeElement).toBe(editor);
});
it('keeps disabled actions discoverable, focuses the first enabled item, and explains disabled activation', () => {
  props.actions = props.actions.map(action => action.id === 'complete' ? { ...action, disabledReason: '実績を記録済みです' } : action);
  mount(); expect(activeElement).toBe(nodes.get('edit'));
  const disabled = items()[0]; expect(disabled.props['aria-disabled']).toBe(true);
  expect(disabled.props.title).toBe('実績を記録済みです');
  const description = disabled.findByProps({ id: disabled.props['aria-describedby'] });
  expect(description.children).toEqual(['実績を記録済みです']);
  act(() => disabled.props.onClick(click()));
  expect(renderer!.root.findByProps({ role: 'status' }).children).toEqual(['実績を記録済みです']);
  expect(props.onDismiss).not.toHaveBeenCalled(); expect(props.onSelect).not.toHaveBeenCalled();
});
it.each(['reduced', 'off'] as const)('%s has no stagger and exits instantly', level => {
  setMotionPreference(level); mount(); expect(menu().props['data-motion']).toBe(level);
  expect(items().map(item => item.props.style['--radial-delay'])).toEqual(Array(6).fill('0ms'));
  update(null); expect(renderer!.toJSON()).toBeNull();
});
it('honours the device reduced-motion setting through the app policy', () => {
  reduced = true; mount(); expect(menu().props['data-motion']).toBe('reduced');
  expect(items().every(item => item.props.style['--radial-delay'] === '0ms')).toBe(true);
});
it('measures CSS safe-area padding and keeps buttons inside those viewport boundaries', () => {
  safePadding = { paddingTop: '44px', paddingBottom: '34px', paddingLeft: '12px', paddingRight: '12px' };
  mount(); const ring = renderer!.root.findByProps({ className: 'schedule-radial-ring' });
  items().forEach(item => {
    const { left, top, width, height } = item.props.style;
    expect(ring.props.style.left + left).toBeGreaterThanOrEqual(22 - 1e-9);
    expect(ring.props.style.top + top).toBeGreaterThanOrEqual(54 - 1e-9);
    expect(ring.props.style.left + left + width).toBeLessThanOrEqual(368 + 1e-9);
    expect(ring.props.style.top + top + height).toBeLessThanOrEqual(800 + 1e-9);
  });
});
it('reopening the same or another event replaces the ring and cancels the previous exit timer', () => {
  mount(); const firstFocus = nodes.get('complete')!.focus; expect(firstFocus).toHaveBeenCalledOnce(); update(null);
  update({ ...props.action!, key: 'plan-a', title: '数学2', item: 'a2', top: 0, left: 0,
    anchorRect: { top: 300, left: 100, width: 40, height: 40, right: 140, bottom: 340 } });
  expect(menu().props['aria-label']).toBe('数学2の操作'); expect(firstFocus).toHaveBeenCalledTimes(2);
  expect(activeElement).toBe(nodes.get('complete'));
  act(() => { vi.advanceTimersByTime(200); }); expect(items()).toHaveLength(6);
  update({ ...props.action!, key: 'plan-b', title: '英語', item: 'b' });
  expect(menu().props['data-schedule-action-key']).toBe('plan-b');
  act(() => items()[1].props.onClick(click())); expect(props.onSelect).toHaveBeenLastCalledWith('edit', 'b');
});
it('defines spatial, opacity-only and instant CSS policies and leaves the device setting to the motion owner', () => {
  const css = readFileSync(new URL('./ScheduleItemRadialMenu.css', import.meta.url), 'utf8');
  expect(css).toContain('border-radius: 50%');
  expect(css).toMatch(/schedule-radial-pop var\(--radial-duration, 140ms\)/); expect(css).toMatch(/scale\(\.4\)/); expect(css).toMatch(/scale\(1\.08\)/);
  expect(css).toMatch(/data-motion="reduced"[^}]+schedule-radial-fade 100ms[^}]+animation-delay: 0ms/s);
  expect(css).toMatch(/data-motion="off"[^}]+animation: none/s);
  // The device reduced-motion preference is folded into data-motion by lib/motionPreference.ts only.
  expect(css).not.toContain('prefers-reduced-motion');
  expect(css).toContain('calc(var(--z-modal-overlay, 1000) - 1)');
  expect(css).toContain('env(safe-area-inset-top, 0px)');
});

it.each(['supported', 'missing', 'throwing'] as const)('continuous selection is visual and executes on release with %s vibration', capability => {
  const vibrate = vi.fn(() => { if (capability === 'throwing') throw new Error('Unavailable'); return true; });
  vi.stubGlobal('navigator', capability === 'missing' ? {} : { vibrate });
  const gesture = { origin: { x: 195, y: 300 }, point: { x: 195, y: 300 } } as import('../lib/scheduleRadialGesture').ScheduleRadialGesture;
  props.action = { ...props.action!, anchorRect: { left: 195, top: 300, right: 195, bottom: 300, width: 0, height: 0 }, gesture };
  mount();
  expect(activeElement).toBeNull();
  act(() => { gesture.onMove!({ x: 195, y: 220 }); });
  expect(items()[0].props['data-gesture-selected']).toBe(true);
  act(() => { gesture.onMove!({ x: 196, y: 220 }); });
  expect(vibrate).toHaveBeenCalledTimes(capability === 'missing' ? 0 : 1);
  expect(props.onSelect).not.toHaveBeenCalled();
  act(() => { gesture.onRelease!(); });
  expect(props.onSelect).toHaveBeenCalledExactlyOnceWith('complete', 'a');
});

it('returning to the centre, leaving the ring and disabled sectors cannot execute', () => {
  vi.stubGlobal('navigator', { vibrate: vi.fn() });
  const gesture = { origin: { x: 195, y: 300 }, point: { x: 195, y: 300 } } as import('../lib/scheduleRadialGesture').ScheduleRadialGesture;
  props.action = { ...props.action!, anchorRect: { left: 195, top: 300, right: 195, bottom: 300, width: 0, height: 0 }, gesture };
  props.actions = props.actions.map(action => action.id === 'complete' ? { ...action, disabledReason: '現在は実行できません' } : action);
  mount();
  act(() => { gesture.onMove!({ x: 195, y: 220 }); });
  expect(renderer!.root.findByProps({ role: 'status' }).children).toEqual(['現在は実行できません']);
  act(() => { gesture.onRelease!(); });
  expect(props.onSelect).not.toHaveBeenCalled();
  act(() => { gesture.onMove!({ x: 265, y: 260 }); gesture.onMove!({ x: 195, y: 300 }); gesture.onRelease!(); });
  expect(props.onSelect).not.toHaveBeenCalled();
  act(() => { gesture.onMove!({ x: 265, y: 260 }); gesture.onMove!({ x: 900, y: 300 }); gesture.onRelease!(); });
  expect(props.onSelect).not.toHaveBeenCalled();
});

it.each(SCHEDULE_RADIAL_ACTION_ORDER.map((id, index) => ({ id, index })))('continuous sector $index invokes $id', ({ id, index }) => {
  vi.stubGlobal('navigator', {});
  const gesture = { origin: { x: 195, y: 300 }, point: { x: 195, y: 300 } } as import('../lib/scheduleRadialGesture').ScheduleRadialGesture;
  props.action = { ...props.action!, anchorRect: { left: 195, top: 300, right: 195, bottom: 300, width: 0, height: 0 }, gesture };
  mount();
  const angle = -Math.PI / 2 + index * Math.PI / 3;
  act(() => { gesture.onMove!({ x: 195 + 80 * Math.cos(angle), y: 300 + 80 * Math.sin(angle) }); });
  expect(items()[index].props['data-gesture-selected']).toBe(true);
  expect(props.onSelect).not.toHaveBeenCalled();
  act(() => { gesture.onRelease!(); });
  expect(props.onSelect).toHaveBeenCalledExactlyOnceWith(id, 'a');
});
