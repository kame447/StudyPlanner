import { useEffect, useRef, useState } from 'react';
import { acquireTimelineDragInteractionLock } from '../lib/timelineDragInteractionLock';
import { SCHEDULE_RADIAL_GESTURE_START, type ScheduleRadialGesture } from '../lib/scheduleRadialGesture';
import { SCHEDULE_LONG_PRESS_MS } from '../lib/scheduleGestureTiming';

interface ScheduleActionPress<TItem> {
  key: string;
  item: TItem;
  title: string;
  inputKind: 'pointer' | 'touch';
  startX: number;
  startY: number;
  startedAt: number;
  moved: boolean;
  element: HTMLElement;
  inputId?: number;
  timer?: number;
  gesture?: ScheduleRadialGesture;
  releaseLock?: () => void;
}

export interface ActiveScheduleItemAction<TItem> {
  key: string;
  item: TItem;
  title: string;
  top: number;
  left: number;
  /** Viewport rect of the pressed event, used to place the radial menu. */
  anchorRect: { top: number; left: number; right: number; bottom: number; width: number; height: number };
  /** Focus origin for Escape; optional for callers that construct an action. */
  anchorElement?: HTMLElement;
  gesture?: ScheduleRadialGesture;
}

export const SCHEDULE_ITEM_ACTION_INTENT_EVENT = 'studyplanner:schedule-item-action-intent';

const ACTION_LONG_PRESS_MS = SCHEDULE_LONG_PRESS_MS;
const TOUCH_MOVE_TOLERANCE_PX = 9;
const POINTER_MOVE_TOLERANCE_PX = 4;
const CLICK_SUPPRESSION_MS = 700;

function distance(startX: number, startY: number, x: number, y: number): number {
  return Math.hypot(x - startX, y - startY);
}

export function useScheduleItemActionPress<TItem>() {
  const [activeAction, setActiveAction] = useState<ActiveScheduleItemAction<TItem> | null>(null);
  const pressRef = useRef<ScheduleActionPress<TItem> | null>(null);
  const suppressClickUntilRef = useRef(0);
  const outsideClickCleanupRef = useRef<(() => void) | null>(null);

  function clearPress() {
    const press = pressRef.current;
    if (press?.timer !== undefined) window.clearTimeout(press.timer);
    press?.releaseLock?.();
    pressRef.current = null;
  }

  function reveal(press: ScheduleActionPress<TItem>) {
    if (pressRef.current !== press || press.moved) return;
    if (press.element.isConnected === false) { clearPress(); return; }
    press.gesture = { origin: { x: press.startX, y: press.startY }, point: { x: press.startX, y: press.startY } };
    // The ring becomes the sole owner before any drag timer can arm.
    window.dispatchEvent(new Event(SCHEDULE_RADIAL_GESTURE_START));
    press.releaseLock = acquireTimelineDragInteractionLock();
    showFor(press.key, press.item, press.title, press.element, press.gesture);
  }

  function showFor(key: string, item: TItem, title: string, element: HTMLElement, gesture?: ScheduleRadialGesture) {
    const rect = element.getBoundingClientRect();
    setActiveAction({
      key,
      item,
      title,
      anchorElement: element,
      gesture,
      top: Math.max(8, rect.top + 3),
      left: Math.max(8, rect.right - 47),
      anchorRect: {
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
    });
  }

  /** Opens the actions without a press, e.g. from the keyboard or a context menu. */
  function open(key: string, item: TItem, title: string, element: HTMLElement) {
    clearPress();
    outsideClickCleanupRef.current?.();
    showFor(key, item, title, element);
  }

  function start(
    key: string,
    item: TItem,
    title: string,
    inputKind: 'pointer' | 'touch',
    element: HTMLElement,
    x: number,
    y: number,
    inputId?: number,
  ) {
    clearPress();
    if (activeAction?.key !== key) {
      setActiveAction(null);
    }
    const press: ScheduleActionPress<TItem> = {
      key,
      item,
      title,
      inputKind,
      startX: x,
      startY: y,
      startedAt: Date.now(),
      moved: false,
      element,
      inputId,
    };
    pressRef.current = press;
    press.timer = window.setTimeout(() => reveal(press), ACTION_LONG_PRESS_MS);
  }

  function move(x: number, y: number) {
    const press = pressRef.current;
    if (!press || press.moved) return;
    if (press.gesture) {
      press.gesture.point = { x, y };
      press.gesture.onMove?.(press.gesture.point);
      return;
    }
    const tolerance =
      press.inputKind === 'touch' ? TOUCH_MOVE_TOLERANCE_PX : POINTER_MOVE_TOLERANCE_PX;
    if (distance(press.startX, press.startY, x, y) <= tolerance) return;

    press.moved = true;
    if (activeAction?.key === press.key) {
      setActiveAction(null);
    }
  }

  function finish(key: string): boolean {
    const press = pressRef.current;
    const held = Boolean(press && press.key === key && press.gesture);
    const gesture = held ? press?.gesture : undefined;
    clearPress();
    if (held) {
      suppressClickUntilRef.current = Date.now() + CLICK_SUPPRESSION_MS;
      gesture?.onRelease?.();
      setActiveAction(null);
    } else if (press?.gesture) setActiveAction(null);
    return held;
  }

  function cancel() {
    if (pressRef.current?.gesture) {
      suppressClickUntilRef.current = Date.now() + CLICK_SUPPRESSION_MS;
      setActiveAction(null);
    }
    clearPress();
  }

  function dismiss() {
    clearPress();
    setActiveAction(null);
  }

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const consume = (event: Event) => { if (event.cancelable) event.preventDefault(); event.stopImmediatePropagation(); };
    const secondaryPointer = (event: PointerEvent) => {
      const press = pressRef.current;
      if (!press) return;
      if ((press.inputKind === 'pointer' && press.inputId !== undefined && event.pointerId !== press.inputId) ||
          (press.inputKind === 'touch' && event.pointerType !== 'touch')) {
        if (press.gesture) consume(event);
        cancel();
      }
    };
    const pointerMove = (event: PointerEvent) => {
      const press = pressRef.current;
      if (!press || press.inputKind !== 'pointer' || (press.inputId !== undefined && event.pointerId !== press.inputId)) return;
      if (press.gesture) consume(event);
      move(event.clientX, event.clientY);
    };
    const pointerUp = (event: PointerEvent) => {
      const press = pressRef.current;
      if (!press || press.inputKind !== 'pointer' || (press.inputId !== undefined && event.pointerId !== press.inputId)) return;
      if (!press.gesture) return;
      consume(event); move(event.clientX, event.clientY); finish(press.key);
    };
    const pointerCancel = (event: PointerEvent) => {
      const press = pressRef.current;
      if (press?.inputKind === 'pointer' && (press.inputId === undefined || press.inputId === event.pointerId)) cancel();
    };
    const touchMove = (event: TouchEvent) => {
      const press = pressRef.current;
      if (!press || press.inputKind !== 'touch') return;
      if (event.touches.length !== 1) { cancel(); return; }
      const touch = Array.from(event.touches).find(t => press.inputId === undefined || t.identifier === press.inputId);
      if (!touch) return;
      if (press.gesture) consume(event);
      move(touch.clientX, touch.clientY);
    };
    const touchEnd = (event: TouchEvent) => {
      const press = pressRef.current;
      if (!press || press.inputKind !== 'touch' || !press.gesture) return;
      const touch = Array.from(event.changedTouches).find(t => press.inputId === undefined || t.identifier === press.inputId);
      if (!touch) return;
      consume(event); move(touch.clientX, touch.clientY); finish(press.key);
    };
    const secondaryTouch = (event: TouchEvent) => { if (event.touches.length !== 1) cancel(); };
    const contextMenu = (event: Event) => { if (pressRef.current?.gesture) consume(event); };
    const hidden = () => { if (document.visibilityState === 'hidden') cancel(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    window.addEventListener('contextmenu', contextMenu, true);
    window.addEventListener('pointerdown', secondaryPointer, true);
    window.addEventListener('pointermove', pointerMove, { capture: true, passive: false });
    window.addEventListener('pointerup', pointerUp, true);
    window.addEventListener('touchmove', touchMove, { capture: true, passive: false });
    window.addEventListener('touchend', touchEnd, { capture: true, passive: false });
    window.addEventListener('touchstart', secondaryTouch, true);
    window.addEventListener('pointercancel', pointerCancel, true);
    window.addEventListener('touchcancel', cancel, true);
    window.addEventListener('blur', cancel);
    window.addEventListener('pagehide', cancel);
    document.addEventListener('visibilitychange', hidden);
    document.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('contextmenu', contextMenu, true);
      window.removeEventListener('pointerdown', secondaryPointer, true);
      window.removeEventListener('pointermove', pointerMove, true);
      window.removeEventListener('pointerup', pointerUp, true);
      window.removeEventListener('touchmove', touchMove, true);
      window.removeEventListener('touchend', touchEnd, true);
      window.removeEventListener('touchstart', secondaryTouch, true);
      window.removeEventListener('pointercancel', pointerCancel, true);
      window.removeEventListener('touchcancel', cancel, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('pagehide', cancel);
      document.removeEventListener('visibilitychange', hidden);
      document.removeEventListener('keydown', escape);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const allowContextActionClick = () => {
      // Long-press suppression exists only to block the synthetic tap/open after
      // revealing an action. The contextual action itself is a new explicit intent.
      suppressClickUntilRef.current = 0;
    };
    window.addEventListener(SCHEDULE_ITEM_ACTION_INTENT_EVENT, allowContextActionClick);
    return () => {
      window.removeEventListener(SCHEDULE_ITEM_ACTION_INTENT_EVENT, allowContextActionClick);
    };
  }, []);

  useEffect(() => {
    if (!activeAction) return;
    const dismissOnScroll = () => { clearPress(); setActiveAction(null); };
    const dismissOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('[data-schedule-item-delete-action="true"]')
      ) {
        return;
      }
      // An outside gesture dismisses only, regardless of pointer type. Keep its
      // one-shot click guard through close, but clear it on the next unrelated
      // pointer gesture or after 700ms.
      outsideClickCleanupRef.current?.();
      const swallowClick = (click: MouseEvent) => {
        click.preventDefault();
        click.stopImmediatePropagation();
        cleanup();
      };
      const cleanup = () => {
        document.removeEventListener('click', swallowClick, { capture: true });
        document.removeEventListener('pointerdown', cleanup, { capture: true });
        window.clearTimeout(timeout);
        outsideClickCleanupRef.current = null;
      };
      const timeout = window.setTimeout(cleanup, CLICK_SUPPRESSION_MS);
      document.addEventListener('click', swallowClick, true);
      document.addEventListener('pointerdown', cleanup, true);
      outsideClickCleanupRef.current = cleanup;
      event.preventDefault();
      event.stopImmediatePropagation();
      clearPress();
      setActiveAction(null);
    };
    window.addEventListener('scroll', dismissOnScroll, true);
    window.addEventListener('resize', dismissOnScroll);
    document.addEventListener('pointerdown', dismissOnPointerDown, true);
    return () => {
      window.removeEventListener('scroll', dismissOnScroll, true);
      window.removeEventListener('resize', dismissOnScroll);
      document.removeEventListener('pointerdown', dismissOnPointerDown, { capture: true });
    };
  }, [activeAction]);

  useEffect(() => () => { clearPress(); outsideClickCleanupRef.current?.(); }, []);

  return {
    activeAction,
    ownsInput: (kind: 'pointer' | 'touch', inputId: number | undefined) => {
      const press = pressRef.current;
      return Boolean(press && press.inputKind === kind && (press.inputId === undefined || press.inputId === inputId));
    },
    open,
    start,
    move,
    finish,
    cancel,
    cancelPointer: (pointerId: number) => {
      const press = pressRef.current;
      if (press?.inputKind === 'pointer' && (press.inputId === undefined || press.inputId === pointerId)) cancel();
    },
    dismiss,
    shouldSuppressClick: () => Date.now() < suppressClickUntilRef.current,
  };
}
