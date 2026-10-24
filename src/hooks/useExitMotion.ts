import { useCallback, useEffect, useRef, useState } from 'react';
import { getMotionLevel, resolveExitDurationMs, STANDARD_EXIT_MS } from '../lib/motionPreference';

export const DEFAULT_EXIT_MOTION_MS = STANDARD_EXIT_MS;

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

      // Read at the moment of exit: the user may have changed the level since mount.
      const exitMs = resolveExitDurationMs(getMotionLevel(), durationMs);
      if (exitMs <= 0) {
        finishExit();
        return;
      }

      isExitingRef.current = true;
      setIsExiting(true);
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        finishExit();
      }, exitMs);
    },
    [durationMs],
  );

  return { isExiting, requestExit };
}
