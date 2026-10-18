import { useLayoutEffect, type RefObject } from 'react';

/** Keep only the material-creation sheet above a mobile keyboard. Pinch zoom
 * continues to magnify the existing layout instead of reflowing the form. */
export function useMaterialCreateViewport(ref: RefObject<HTMLElement>, active: boolean): void {
  useLayoutEffect(() => {
    if (!active || typeof window === 'undefined') return;
    const viewport = window.visualViewport;
    const overlay = ref.current;
    if (!viewport || !overlay) return;
    const update = () => {
      if (viewport.scale !== 1 || viewport.height <= 0 || document.visibilityState === 'hidden') return;
      overlay.style.setProperty('--material-create-viewport-height', `${viewport.height}px`);
      overlay.style.setProperty('--material-create-viewport-top', `${Math.max(0, viewport.offsetTop)}px`);
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    window.addEventListener('pageshow', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      window.removeEventListener('pageshow', update);
      document.removeEventListener('visibilitychange', update);
      overlay.style.removeProperty('--material-create-viewport-height');
      overlay.style.removeProperty('--material-create-viewport-top');
    };
  }, [ref, active]);
}
