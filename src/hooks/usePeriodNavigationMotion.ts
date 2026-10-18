import { useLayoutEffect, useRef, type RefObject } from 'react';
import { playNavigation } from '../lib/motionEffects';

/**
 * Slides a calendar body in from the side the user moved toward whenever the
 * displayed period changes. `period` is the ISO date that identifies the
 * period (its first day), so lexical order is chronological order.
 *
 * The animation runs on the already-rendered new content: nothing waits for
 * it, and a quick second navigation replaces it mid-way instead of queueing.
 */
export function usePeriodNavigationMotion(containerRef: RefObject<Element | null>, period: string) {
  const previous = useRef(period);

  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = period;
    if (before === period) return;
    playNavigation(containerRef.current, period > before ? 'forward' : 'backward');
  }, [containerRef, period]);
}
