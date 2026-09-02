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
  timerId: number | null;
  element: HTMLElement;
}

export interface ActiveScheduleItemAction<TItem> {
  key: string;
  item: TItem;
  title: string;
  top: number;
  left: number;
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

  function clearPress() {
    const press = pressRef.current;
    if (press?.timerId !== null && press?.timerId !== undefined) {
      window.clearTimeout(press.timerId);
    }
    pressRef.current = null;
  }

  function reveal(press: ScheduleActionPress<TItem>) {
    if (pressRef.current !== press || press.moved) return;
    const rect = press.element.getBoundingClientRect();
    setActiveAction({
      key: press.key,
      item: press.item,
      title: press.title,
      top: Math.max(8, rect.top + 3),
      left: Math.max(8, rect.right - 47),
    });
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
      timerId: null,
      element,
    };
    pressRef.current = press;
    press.timerId = window.setTimeout(() => reveal(press), ACTION_LONG_PRESS_MS);
  }

  function move(x: number, y: number) {
    const press = pressRef.current;
    if (!press || press.moved) return;
    const tolerance =
      press.inputKind === 'touch' ? TOUCH_MOVE_TOLERANCE_PX : POINTER_MOVE_TOLERANCE_PX;
    if (distance(press.startX, press.startY, x, y) <= tolerance) return;

    press.moved = true;
    if (press.timerId !== null) {
      window.clearTimeout(press.timerId);
      press.timerId = null;
    }
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
    if (held && press && activeAction?.key !== key) {
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
    const dismissOnScroll = () => setActiveAction(null);
    const dismissOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('[data-schedule-item-delete-action="true"]')
      ) {
        return;
      }
      setActiveAction(null);
    };
    window.addEventListener('scroll', dismissOnScroll, true);
    document.addEventListener('pointerdown', dismissOnPointerDown);
    return () => {
      window.removeEventListener('scroll', dismissOnScroll, true);
      document.removeEventListener('pointerdown', dismissOnPointerDown);
    };
  }, [activeAction]);

  useEffect(() => () => clearPress(), []);

  return {
    activeAction,
    start,
    move,
    finish,
    cancel,
    dismiss,
    shouldSuppressClick: () => Date.now() < suppressClickUntilRef.current,
  };
}
