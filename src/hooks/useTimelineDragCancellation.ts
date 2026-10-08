import { useEffect, useRef } from 'react';

/** End a gesture when the browser can no longer reliably deliver its release. */
export function useTimelineDragCancellation(cancelDrag: () => void) {
  const cancelDragRef = useRef(cancelDrag);
  cancelDragRef.current = cancelDrag;

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const cancel = () => cancelDragRef.current();
    const cancelWhenHidden = () => {
      if (document.visibilityState === 'hidden') cancel();
    };
    const cancelMultitouch = (event: TouchEvent) => {
      if (event.touches.length !== 1) cancel();
    };
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };

    window.addEventListener('blur', cancel);
    window.addEventListener('pagehide', cancel);
    window.addEventListener('touchstart', cancelMultitouch, { capture: true, passive: true });
    document.addEventListener('visibilitychange', cancelWhenHidden);
    document.addEventListener('keydown', cancelOnEscape);
    return () => {
      window.removeEventListener('blur', cancel);
      window.removeEventListener('pagehide', cancel);
      window.removeEventListener('touchstart', cancelMultitouch, true);
      document.removeEventListener('visibilitychange', cancelWhenHidden);
      document.removeEventListener('keydown', cancelOnEscape);
    };
  }, []);
}
