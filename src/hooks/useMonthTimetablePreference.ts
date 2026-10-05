import { useLayoutEffect, useRef, useState } from 'react';

const STORAGE_KEY_PREFIX = 'study-planner-month-timetable:';

function readPreference(userId: string): boolean {
  if (!userId || typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY_PREFIX + encodeURIComponent(userId)) !== 'false';
  } catch {
    return true;
  }
}

function initialState(userId: string) {
  return {
    userId,
    session: Symbol(),
    showTimetable: readPreference(userId),
    error: null as string | null,
  };
}

// A display preference, kept on this browser like the theme, but isolated by owner.
export function useMonthTimetablePreference(ownerId?: string) {
  const userId = ownerId ?? '';
  const [storedState, setState] = useState(() => initialState(userId));
  const state = storedState.userId === userId ? storedState : initialState(userId);
  if (storedState.userId !== userId) setState(state);

  const activeSession = useRef<symbol | null>(null);
  // Only committed sessions can save. A discarded render cannot activate a new
  // owner, and returning to the same owner does not reactivate an old callback.
  useLayoutEffect(() => {
    activeSession.current = state.session;
    return () => { activeSession.current = null; };
  }, [state.session]);

  function setShowTimetable(showTimetable: boolean) {
    if (!userId || activeSession.current !== state.session) return;
    try {
      window.localStorage.setItem(STORAGE_KEY_PREFIX + encodeURIComponent(userId), String(showTimetable));
      setState(current => current.session === state.session
        ? { ...current, showTimetable, error: null }
        : current);
    } catch {
      setState(current => current.session === state.session
        ? { ...current, error: '設定を保存できませんでした。ブラウザの保存設定を確認して、もう一度お試しください。' }
        : current);
    }
  }

  return { showTimetable: state.showTimetable, setShowTimetable, error: state.error };
}
