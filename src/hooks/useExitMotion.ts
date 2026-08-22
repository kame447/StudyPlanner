import { useCallback, useEffect, useRef, useState } from 'react';

export const DEFAULT_EXIT_MOTION_MS = 280;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function useExitMotion(
  onExit: () => void,
  durationMs = DEFAULT_EXIT_MOTION_MS,
) {
  const [isExiting, setIsExiting] = useState(false);
  const isExitingRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onExitRef = useRef(onExit);

  useEffect(() => {
    onExitRef.current = onExit;
  }, [onExit]);

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
    },
    [],
  );

  const requestExit = useCallback(
    (afterExit?: () => void) => {
      if (isExitingRef.current) {
        return;
      }

      const finishExit = () => {
        isExitingRef.current = false;
        setIsExiting(false);
        onExitRef.current();
        afterExit?.();
      };

      if (durationMs <= 0 || prefersReducedMotion()) {
        finishExit();
        return;
      }

      isExitingRef.current = true;
      setIsExiting(true);
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        finishExit();
      }, durationMs);
    },
    [durationMs],
  );

  return { isExiting, requestExit };
}
