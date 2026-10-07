import { useCallback, useEffect, useRef, useState } from 'react';

const SETTINGS_HISTORY_KEY = 'studyPlannerSettings';
function isSettingsEntry(): boolean {
  return typeof window !== 'undefined' && window.history?.state?.[SETTINGS_HISTORY_KEY] === true;
}

/** A single same-document history entry; the planner keeps its own view state. */
export function useSettingsNavigation() {
  const [isOpen, setIsOpen] = useState(isSettingsEntry);
  const openRef = useRef(isOpen);
  const closingRef = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const returnScroll = useRef<{ x: number; y: number } | null>(null);

  const rememberOrigin = useCallback(() => {
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      returnFocus.current = document.activeElement;
    }
    returnScroll.current = { x: window.scrollX, y: window.scrollY };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const handlePopState = () => {
      const nextOpen = isSettingsEntry();
      if (nextOpen && !openRef.current) rememberOrigin();
      openRef.current = nextOpen;
      closingRef.current = false;
      setIsOpen(nextOpen);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [rememberOrigin]);

  useEffect(() => {
    if (isOpen) return;
    if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
    if (returnScroll.current) window.scrollTo(returnScroll.current.x, returnScroll.current.y);
    returnFocus.current = null;
    returnScroll.current = null;
  }, [isOpen]);

  const open = useCallback(() => {
    if (openRef.current) return;
    rememberOrigin();
    window.history.pushState({ ...window.history.state, [SETTINGS_HISTORY_KEY]: true }, '');
    openRef.current = true;
    setIsOpen(true);
  }, [rememberOrigin]);

  const close = useCallback(() => {
    if (!openRef.current || closingRef.current) return;
    if (isSettingsEntry() && window.history.length > 1) {
      closingRef.current = true;
      window.history.back();
    } else {
      if (isSettingsEntry()) {
        const nextState = { ...window.history.state };
        delete nextState[SETTINGS_HISTORY_KEY];
        window.history.replaceState(nextState, '');
      }
      openRef.current = false;
      setIsOpen(false);
    }
  }, []);

  return { isOpen, open, close };
}
