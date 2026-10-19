import { useMemo, useRef } from 'react';
import type { MouseEvent, TouchEvent } from 'react';

interface SwipeNavigationOptions {
  onPrevious: () => void;
  onNext: () => void;
  disabled?: boolean;
}

interface SwipeStartState {
  x: number;
  y: number;
  target: EventTarget | null;
}

const SWIPE_THRESHOLD_PX = 72;
const SWIPE_DIRECTION_RATIO = 1.35;

function isIgnoredSwipeTarget(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) {
    return false;
  }

  const weekScroll = target.closest<HTMLElement>('.schedule-week-preview-scroll');
  if (weekScroll && weekScroll.scrollWidth > weekScroll.clientWidth + 1) return true;

  return Boolean(
    target.closest(
      [
        'input',
        'textarea',
        'select',
        '[contenteditable]:not([contenteditable="false"])',
        '[role="dialog"]',
        '[data-schedule-occurrence-id]',
        '.schedule-week-plan-button',
        '[data-swipe-ignore="true"]',
        '.month-week-chip-row',
        '.month-event-chip-list',
        '.report-bar-chart-scroll',
        '.report-timeline-scroll',
      ].join(','),
    ),
  );
}

export function useSwipeNavigation({
  onPrevious,
  onNext,
  disabled = false,
}: SwipeNavigationOptions) {
  const startRef = useRef<SwipeStartState | null>(null);
  const suppressClickUntilRef = useRef(0);
  const deltaRef = useRef({ x: 0, y: 0 });

  return useMemo(
    () => ({
      onTouchStart(event: TouchEvent<HTMLElement>) {
        suppressClickUntilRef.current = 0;
        if (disabled || event.defaultPrevented || event.touches.length !== 1 || isIgnoredSwipeTarget(event.target)) {
          startRef.current = null;
          return;
        }

        const touch = event.touches[0];
        startRef.current = {
          x: touch.clientX,
          y: touch.clientY,
          target: event.target,
        };
        deltaRef.current = { x: 0, y: 0 };
      },
      onTouchMove(event: TouchEvent<HTMLElement>) {
        if (disabled || event.defaultPrevented || !startRef.current || event.touches.length !== 1) {
          startRef.current = null;
          return;
        }

        const touch = event.touches[0];
        deltaRef.current = {
          x: touch.clientX - startRef.current.x,
          y: touch.clientY - startRef.current.y,
        };
      },
      onTouchCancel() {
        startRef.current = null;
      },
      onClickCapture(event: MouseEvent<HTMLElement>) {
        if (Date.now() < suppressClickUntilRef.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
      onTouchEnd() {
        if (disabled || !startRef.current) {
          startRef.current = null;
          return;
        }

        const start = startRef.current;
        const { x, y } = deltaRef.current;
        startRef.current = null;

        if (isIgnoredSwipeTarget(start.target)) {
          return;
        }

        if (Math.abs(x) < SWIPE_THRESHOLD_PX) {
          return;
        }

        if (Math.abs(x) <= Math.abs(y) * SWIPE_DIRECTION_RATIO) {
          return;
        }

        suppressClickUntilRef.current = Date.now() + 700;
        if (x > 0) {
          onPrevious();
          return;
        }

        onNext();
      },
    }),
    [disabled, onNext, onPrevious],
  );
}
