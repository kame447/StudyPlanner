import '../styles/timeline-drag-interaction-lock.css';

const TIMELINE_DRAG_LOCK_CLASS = 'is-timeline-drag-interaction-locked';

let activeLockCount = 0;
let releaseGlobalLock: (() => void) | null = null;

export function isTimelineDragInteractionLocked(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains(TIMELINE_DRAG_LOCK_CLASS)
  );
}

export function acquireTimelineDragInteractionLock(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !document.body) {
    return () => undefined;
  }

  activeLockCount += 1;

  if (activeLockCount === 1) {
    const root = document.documentElement;

    const preventBackgroundScroll = (event: TouchEvent | WheelEvent) => {
      if (event.cancelable) event.preventDefault();
    };

    root.classList.add(TIMELINE_DRAG_LOCK_CLASS);
    window.addEventListener('touchmove', preventBackgroundScroll, {
      capture: true,
      passive: false,
    });
    window.addEventListener('wheel', preventBackgroundScroll, {
      capture: true,
      passive: false,
    });

    releaseGlobalLock = () => {
      window.removeEventListener('touchmove', preventBackgroundScroll, true);
      window.removeEventListener('wheel', preventBackgroundScroll, true);
      root.classList.remove(TIMELINE_DRAG_LOCK_CLASS);
    };
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeLockCount = Math.max(0, activeLockCount - 1);
    if (activeLockCount !== 0) return;

    releaseGlobalLock?.();
    releaseGlobalLock = null;
  };
}

/**
 * Keeps a non-passive touchmove listener on a timeline for as long as it is
 * mounted, cancelling moves only while a drag lock is held.
 *
 * iOS WebKit decides at touchstart whether a gesture's touchmoves may be
 * cancelled, from the non-passive listeners already covering the touched
 * element. The window listener above is only added once the hold arms (or the
 * armed move touch starts), so on iPhone the first moves of that same gesture
 * can already be scrolling an inner container. Registering ahead of time makes
 * the gesture cancellable from its first move; ordinary scrolling is untouched
 * because nothing is prevented while unlocked.
 */
export function installTimelineTouchMoveGuard(element: HTMLElement): () => void {
  const guard = (event: TouchEvent) => {
    if (event.cancelable && isTimelineDragInteractionLocked()) event.preventDefault();
  };
  element.addEventListener('touchmove', guard, { passive: false });
  return () => element.removeEventListener('touchmove', guard);
}
