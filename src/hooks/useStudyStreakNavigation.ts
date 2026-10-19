import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { subscribeAppHistory } from '../lib/appHistory';

const HISTORY_KEY = 'studyPlannerStudyStreak';
function matchesOwner(ownerId: string | undefined): boolean {
  return Boolean(ownerId && typeof window !== 'undefined' && window.history?.state?.[HISTORY_KEY] === ownerId);
}
function removeEntry() {
  const state = { ...window.history.state };
  delete state[HISTORY_KEY];
  window.history.replaceState(state, '');
}

/** Keep the learning-record page in the browser history without changing planner state. */
export function useStudyStreakNavigation(ownerId: string | undefined, ready = true) {
  const [openOwner, setOpenOwner] = useState<string | null>(() => ready && matchesOwner(ownerId) ? ownerId! : null);
  const token = useMemo(() => ({}), [ownerId, ready]);
  const session = useRef<object | null>(null);
  const activeOwner = useRef(ownerId);
  const initialized = useRef(false);
  const openRef = useRef(openOwner !== null);
  const closing = useRef(false);
  const origin = useRef<{ element: HTMLElement | null; x: number; y: number } | null>(null);
  const isOpen = Boolean(ready && ownerId && openOwner === ownerId);

  useLayoutEffect(() => {
    if (!ready) { session.current = null; return; }
    session.current = token;
    if (!initialized.current) {
      initialized.current = true;
      activeOwner.current = ownerId;
      const restored = matchesOwner(ownerId);
      openRef.current = restored;
      setOpenOwner(restored ? ownerId! : null);
      if (!restored && typeof window !== 'undefined' && window.history?.state?.[HISTORY_KEY]) removeEntry();
    }
    if (activeOwner.current !== ownerId) {
      activeOwner.current = ownerId;
      openRef.current = false;
      closing.current = false;
      origin.current = null;
      setOpenOwner(null);
      if (typeof window !== 'undefined' && window.history?.state?.[HISTORY_KEY]) removeEntry();
    }
    return () => { if (session.current === token) session.current = null; };
  }, [ownerId, ready, token]);

  const rememberOrigin = useCallback(() => {
    origin.current = {
      element: typeof document !== 'undefined' && typeof HTMLElement !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null,
      x: window.scrollX, y: window.scrollY,
    };
  }, []);

  useEffect(() => subscribeAppHistory(() => {
    if (!ready) return;
    const next = matchesOwner(ownerId);
    if (next && !openRef.current) rememberOrigin();
    openRef.current = next;
    closing.current = false;
    setOpenOwner(next ? ownerId! : null);
  }), [ownerId, ready, rememberOrigin]);

  useEffect(() => {
    if (isOpen || !origin.current) return;
    if (origin.current.element?.isConnected) origin.current.element.focus({ preventScroll: true });
    window.scrollTo(origin.current.x, origin.current.y);
    origin.current = null;
  }, [isOpen]);

  const open = useCallback(() => {
    if (!ready || !ownerId || activeOwner.current !== ownerId || session.current !== token || openRef.current || typeof window === 'undefined') return;
    rememberOrigin();
    window.history.pushState({ ...window.history.state, [HISTORY_KEY]: ownerId }, '');
    openRef.current = true;
    closing.current = false;
    setOpenOwner(ownerId);
  }, [ownerId, ready, rememberOrigin, token]);

  const close = useCallback(() => {
    if (activeOwner.current !== ownerId || session.current !== token || !openRef.current || closing.current) return;
    if (matchesOwner(ownerId) && window.history.length > 1) {
      closing.current = true;
      window.history.back();
    } else {
      if (matchesOwner(ownerId)) removeEntry();
      openRef.current = false;
      setOpenOwner(null);
    }
  }, [ownerId, ready, token]);

  return { isOpen, open, close };
}
