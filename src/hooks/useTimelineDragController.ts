import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import {
  calculateWeekPlanVelocityTilt,
  hasWeekPlanMoveChanged,
  resolveWeekPlanDragTarget,
  type WeekPlanMoveTarget,
} from '../lib/weekPlanDrag';

type DragInputKind = 'pointer' | 'touch';

export interface TimelineDragDescriptor<TItem> {
  key: string;
  item: TItem;
  title: string;
  toneClass?: string;
  original: WeekPlanMoveTarget;
  dates: string[];
  allowDateChange: boolean;
  dayColumnSelector: string;
  scrollSelector?: string;
  lockLabel?: string;
}

interface DragSession<TItem> {
  inputKind: DragInputKind;
  descriptor: TimelineDragDescriptor<TItem>;
  startX: number;
  startY: number;
  lastX: number;
  lastSampleTime: number;
  smoothedVelocityX: number;
  grabOffsetX: number;
  grabOffsetY: number;
  width: number;
  height: number;
  dayWidth: number;
  timelineHeight: number;
  startScrollLeft: number;
  scrollElement: HTMLElement | null;
  active: boolean;
  canceled: boolean;
  longPressTimer: number | null;
  target: WeekPlanMoveTarget;
  reducedMotion: boolean;
}

export interface TimelineDragVisualState {
  key: string;
  title: string;
  toneClass: string;
  target: WeekPlanMoveTarget;
  overlayX: number;
  overlayY: number;
  width: number;
  height: number;
  tilt: number;
  lockLabel?: string;
}

interface UseTimelineDragControllerOptions<TItem> {
  onCommit: (
    descriptor: TimelineDragDescriptor<TItem>,
    before: WeekPlanMoveTarget,
    after: WeekPlanMoveTarget,
  ) => void | Promise<void>;
}

const TOUCH_LONG_PRESS_MS = 240;
const TOUCH_MOVE_TOLERANCE_PX = 9;
const POINTER_DRAG_THRESHOLD_PX = 4;
const DRAG_EDGE_SCROLL_PX = 30;
const DRAG_EDGE_SCROLL_STEP_PX = 14;
const CLICK_SUPPRESSION_MS = 700;

function getDistance(startX: number, startY: number, x: number, y: number): number {
  return Math.hypot(x - startX, y - startY);
}

export function useTimelineDragController<TItem>({
  onCommit,
}: UseTimelineDragControllerOptions<TItem>) {
  const [dragVisual, setDragVisual] = useState<TimelineDragVisualState | null>(null);
  const dragSessionRef = useRef<DragSession<TItem> | null>(null);
  const suppressClickUntilRef = useRef(0);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  function clearLongPressTimer(session: DragSession<TItem> | null) {
    if (session?.longPressTimer !== null && session?.longPressTimer !== undefined) {
      window.clearTimeout(session.longPressTimer);
      session.longPressTimer = null;
    }
  }

  function clearDragSession() {
    clearLongPressTimer(dragSessionRef.current);
    dragSessionRef.current = null;
    setDragVisual(null);
  }

  useEffect(() => {
    return () => {
      clearLongPressTimer(dragSessionRef.current);
    };
  }, []);

  function createDragSession(
    inputKind: DragInputKind,
    descriptor: TimelineDragDescriptor<TItem>,
    element: HTMLElement,
    clientX: number,
    clientY: number,
  ): DragSession<TItem> | null {
    const dayColumn = element.closest<HTMLElement>(descriptor.dayColumnSelector);
    if (!dayColumn) return null;

    const scrollElement = descriptor.scrollSelector
      ? element.closest<HTMLElement>(descriptor.scrollSelector)
      : null;
    const cardRect = element.getBoundingClientRect();
    const dayRect = dayColumn.getBoundingClientRect();

    return {
      inputKind,
      descriptor,
      startX: clientX,
      startY: clientY,
      lastX: clientX,
      lastSampleTime: performance.now(),
      smoothedVelocityX: 0,
      grabOffsetX: clientX - cardRect.left,
      grabOffsetY: clientY - cardRect.top,
      width: cardRect.width,
      height: cardRect.height,
      dayWidth: Math.max(dayRect.width, 1),
      timelineHeight: Math.max(dayRect.height, 1),
      startScrollLeft: scrollElement?.scrollLeft ?? 0,
      scrollElement,
      active: false,
      canceled: false,
      longPressTimer: null,
      target: descriptor.original,
      reducedMotion:
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  }

  function nudgeHorizontalScroll(session: DragSession<TItem>, clientX: number) {
    const scrollElement = session.scrollElement;
    if (!scrollElement || scrollElement.scrollWidth <= scrollElement.clientWidth) return;

    const rect = scrollElement.getBoundingClientRect();
    if (clientX <= rect.left + DRAG_EDGE_SCROLL_PX) {
      scrollElement.scrollLeft = Math.max(
        0,
        scrollElement.scrollLeft - DRAG_EDGE_SCROLL_STEP_PX,
      );
    } else if (clientX >= rect.right - DRAG_EDGE_SCROLL_PX) {
      scrollElement.scrollLeft = Math.min(
        scrollElement.scrollWidth - scrollElement.clientWidth,
        scrollElement.scrollLeft + DRAG_EDGE_SCROLL_STEP_PX,
      );
    }
  }

  function updateDrag(session: DragSession<TItem>, clientX: number, clientY: number) {
    if (!session.active || dragSessionRef.current !== session) return;

    nudgeHorizontalScroll(session, clientX);
    const scrollDelta =
      (session.scrollElement?.scrollLeft ?? session.startScrollLeft) - session.startScrollLeft;
    const descriptor = session.descriptor;
    const target = resolveWeekPlanDragTarget({
      weekDates: descriptor.dates,
      originalDate: descriptor.original.date,
      originalStartTime: descriptor.original.startTime,
      originalEndTime: descriptor.original.endTime,
      deltaX: clientX - session.startX + scrollDelta,
      deltaY: clientY - session.startY,
      dayWidth: session.dayWidth,
      timelineHeight: session.timelineHeight,
      allowDateChange: descriptor.allowDateChange,
    });
    const now = performance.now();
    const elapsedMs = Math.max(now - session.lastSampleTime, 8);
    const instantaneousVelocityX = ((clientX - session.lastX) / elapsedMs) * 1000;
    session.smoothedVelocityX =
      session.smoothedVelocityX * 0.72 + instantaneousVelocityX * 0.28;
    session.lastX = clientX;
    session.lastSampleTime = now;
    session.target = target;

    setDragVisual({
      key: descriptor.key,
      title: descriptor.title,
      toneClass: descriptor.toneClass ?? '',
      target,
      overlayX: clientX - session.grabOffsetX,
      overlayY: clientY - session.grabOffsetY,
      width: session.width,
      height: session.height,
      tilt: session.reducedMotion
        ? 0
        : calculateWeekPlanVelocityTilt(session.smoothedVelocityX),
      lockLabel: descriptor.lockLabel,
    });
  }

  function activateDrag(session: DragSession<TItem>, clientX: number, clientY: number) {
    if (dragSessionRef.current !== session || session.canceled || session.active) return;

    clearLongPressTimer(session);
    session.active = true;
    suppressClickUntilRef.current = Date.now() + CLICK_SUPPRESSION_MS;

    if (session.inputKind === 'touch' && 'vibrate' in navigator) {
      navigator.vibrate?.(10);
    }

    updateDrag(session, clientX, clientY);
  }

  function finishDrag(session: DragSession<TItem>) {
    if (dragSessionRef.current !== session) return;

    const descriptor = session.descriptor;
    const before = descriptor.original;
    const after = session.target;
    const shouldCommit =
      session.active &&
      hasWeekPlanMoveChanged(
        before.date,
        before.startTime,
        before.endTime,
        after,
      );
    clearDragSession();

    if (!shouldCommit) return;
    void Promise.resolve(onCommitRef.current(descriptor, before, after)).catch(() => undefined);
  }

  function handlePointerDown(
    event: ReactPointerEvent<HTMLElement>,
    descriptor: TimelineDragDescriptor<TItem>,
  ) {
    if (event.pointerType === 'touch' || event.button !== 0 || !event.isPrimary) return;

    const session = createDragSession(
      'pointer',
      descriptor,
      event.currentTarget,
      event.clientX,
      event.clientY,
    );
    if (!session) return;

    dragSessionRef.current = session;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLElement>) {
    const session = dragSessionRef.current;
    if (!session || session.inputKind !== 'pointer') return;

    if (!session.active) {
      if (
        getDistance(session.startX, session.startY, event.clientX, event.clientY) <
        POINTER_DRAG_THRESHOLD_PX
      ) {
        return;
      }
      activateDrag(session, event.clientX, event.clientY);
    }

    event.preventDefault();
    event.stopPropagation();
    updateDrag(session, event.clientX, event.clientY);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLElement>) {
    const session = dragSessionRef.current;
    if (!session || session.inputKind !== 'pointer') return;

    if (session.active) {
      event.preventDefault();
      event.stopPropagation();
      suppressClickUntilRef.current = Date.now() + CLICK_SUPPRESSION_MS;
      finishDrag(session);
      return;
    }

    clearDragSession();
  }

  function handlePointerCancel() {
    const session = dragSessionRef.current;
    if (session?.inputKind === 'pointer') clearDragSession();
  }

  function handleTouchStart(
    event: ReactTouchEvent<HTMLElement>,
    descriptor: TimelineDragDescriptor<TItem>,
  ) {
    if (event.touches.length !== 1) return;

    const touch = event.touches[0];
    const session = createDragSession(
      'touch',
      descriptor,
      event.currentTarget,
      touch.clientX,
      touch.clientY,
    );
    if (!session) return;

    dragSessionRef.current = session;
    session.longPressTimer = window.setTimeout(() => {
      activateDrag(session, session.startX, session.startY);
    }, TOUCH_LONG_PRESS_MS);
  }

  function handleTouchMove(event: ReactTouchEvent<HTMLElement>) {
    const session = dragSessionRef.current;
    if (!session || session.inputKind !== 'touch' || event.touches.length !== 1) return;

    const touch = event.touches[0];
    if (!session.active) {
      if (
        getDistance(session.startX, session.startY, touch.clientX, touch.clientY) >
        TOUCH_MOVE_TOLERANCE_PX
      ) {
        session.canceled = true;
        clearLongPressTimer(session);
      }
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    updateDrag(session, touch.clientX, touch.clientY);
  }

  function handleTouchEnd(event: ReactTouchEvent<HTMLElement>) {
    const session = dragSessionRef.current;
    if (!session || session.inputKind !== 'touch') return;

    if (session.active) {
      event.preventDefault();
      event.stopPropagation();
      suppressClickUntilRef.current = Date.now() + CLICK_SUPPRESSION_MS;
      finishDrag(session);
      return;
    }

    clearDragSession();
  }

  function handleTouchCancel() {
    const session = dragSessionRef.current;
    if (session?.inputKind === 'touch') clearDragSession();
  }

  return {
    dragVisual,
    isDragging: (key: string) => dragVisual?.key === key,
    shouldSuppressClick: () => Date.now() < suppressClickUntilRef.current,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel,
  };
}
