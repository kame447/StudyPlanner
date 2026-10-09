import { useLayoutEffect, useRef, useState } from 'react';

export type TimetableDisplayView = 'month' | 'day';

function storageKey(userId: string, view: TimetableDisplayView) {
  return `study-planner-${view}-timetable:${encodeURIComponent(userId)}`;
}

function readPreference(userId: string, view: TimetableDisplayView): boolean {
  if (!userId || typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(storageKey(userId, view)) !== 'false';
  } catch {
    return true;
  }
}

function initialState(userId: string, view: TimetableDisplayView) {
  return {
    userId,
    view,
    session: Symbol(),
    showTimetable: readPreference(userId, view),
    error: null as string | null,
  };
}

// A display preference, kept on this browser like the theme, but isolated by owner.
export function useTimetableDisplayPreference(view: TimetableDisplayView, ownerId?: string) {
  const userId = ownerId ?? '';
  const [storedState, setState] = useState(() => initialState(userId, view));
  const state = storedState.userId === userId && storedState.view === view ? storedState : initialState(userId, view);
  if (storedState.userId !== userId || storedState.view !== view) setState(state);

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
      window.localStorage.setItem(storageKey(userId, view), String(showTimetable));
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
