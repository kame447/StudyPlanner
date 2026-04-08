import { useMemo, useRef } from 'react';
import type { TouchEvent } from 'react';

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
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest(
      [
        'input',
        'textarea',
        'select',
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
  const deltaRef = useRef({ x: 0, y: 0 });

  return useMemo(
    () => ({
      onTouchStart(event: TouchEvent<HTMLElement>) {
        if (disabled || event.touches.length !== 1) {
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
        if (disabled || !startRef.current || event.touches.length !== 1) {
          return;
        }

        const touch = event.touches[0];
        deltaRef.current = {
          x: touch.clientX - startRef.current.x,
          y: touch.clientY - startRef.current.y,
        };
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
