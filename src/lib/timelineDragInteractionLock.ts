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
    const body = document.body;
    const previousRootOverscrollBehavior = root.style.overscrollBehavior;
    const previousBodyOverscrollBehavior = body.style.overscrollBehavior;
    const previousBodyOverflow = body.style.overflow;

    const preventBackgroundTouchMove = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault();
    };

    root.classList.add(TIMELINE_DRAG_LOCK_CLASS);
    root.style.overscrollBehavior = 'none';
    body.style.overscrollBehavior = 'none';
    body.style.overflow = 'hidden';
    window.addEventListener('touchmove', preventBackgroundTouchMove, {
      capture: true,
      passive: false,
    });

    releaseGlobalLock = () => {
      window.removeEventListener('touchmove', preventBackgroundTouchMove, true);
      root.classList.remove(TIMELINE_DRAG_LOCK_CLASS);
      root.style.overscrollBehavior = previousRootOverscrollBehavior;
      body.style.overscrollBehavior = previousBodyOverscrollBehavior;
      body.style.overflow = previousBodyOverflow;
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
