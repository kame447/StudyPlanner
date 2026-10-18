import { useEffect, useRef, useState } from 'react';

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
}

export const SCHEDULE_ITEM_ACTION_INTENT_EVENT = 'studyplanner:schedule-item-action-intent';

const ACTION_LONG_PRESS_MS = 240;
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
    pressRef.current = null;
  }

  function reveal(press: ScheduleActionPress<TItem>) {
    if (pressRef.current !== press || press.moved) return;
    showFor(press.key, press.item, press.title, press.element);
  }

  function showFor(key: string, item: TItem, title: string, element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    setActiveAction({
      key,
      item,
      title,
      anchorElement: element,
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
    };
    pressRef.current = press;
    // The drag controller arms at the same threshold. Reveal only on release,
    // once we know this stationary hold did not turn into a drag.
  }

  function move(x: number, y: number) {
    const press = pressRef.current;
    if (!press || press.moved) return;
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
    const held = Boolean(
      press &&
        press.key === key &&
        !press.moved &&
        Date.now() - press.startedAt >= ACTION_LONG_PRESS_MS,
    );
    if (held && press) {
      reveal(press);
    }
    if (held) {
      suppressClickUntilRef.current = Date.now() + CLICK_SUPPRESSION_MS;
    }
    clearPress();
    return held;
  }

  function cancel() {
    clearPress();
  }

  function dismiss() {
    clearPress();
    setActiveAction(null);
  }

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
      // A touch outside dismisses only: its compatibility click must not open
      // the calendar item underneath. Keep the one-shot listener through close,
      // but clear it on the next unrelated pointer gesture or after 700ms.
      if (event.pointerType === 'touch') {
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
      }
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
    open,
    start,
    move,
    finish,
    cancel,
    dismiss,
    shouldSuppressClick: () => Date.now() < suppressClickUntilRef.current,
  };
}
