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
