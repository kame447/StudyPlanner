import { useEffect, useRef, type RefObject } from 'react';
import { installTimelineTouchMoveGuard } from '../lib/timelineDragInteractionLock';

/** Registers the timeline's touchmove guard before any gesture starts on it. */
export function useTimelineTouchMoveGuard(ref: RefObject<HTMLElement | null>) {
  const installed = useRef<{ element: HTMLElement; remove: () => void } | null>(null);
  // The guarded element can mount after its owner (e.g. a mode switch), so
  // reconcile after every commit; the listener is only re-added on change.
  useEffect(() => {
    const element = ref.current;
    if (installed.current?.element === element) return;
    installed.current?.remove();
    installed.current = element && typeof element.addEventListener === 'function'
      ? { element, remove: installTimelineTouchMoveGuard(element) }
      : null;
  });
  useEffect(() => () => { installed.current?.remove(); installed.current = null; }, []);
}
