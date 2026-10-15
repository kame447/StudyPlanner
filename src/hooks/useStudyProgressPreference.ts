import { useLayoutEffect, useRef, useState } from 'react';

import { DEFAULT_STUDY_PROGRESS_PREFERENCES, type StudyProgressPreferences } from '../lib/studyProgressPolicy';

const STORAGE_KEY_PREFIX = 'study-planner-study-progress:';

function readPreference(userId: string): StudyProgressPreferences {
  if (!userId || typeof window === 'undefined') return DEFAULT_STUDY_PROGRESS_PREFERENCES;
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY_PREFIX + encodeURIComponent(userId)) ?? 'null');
    return { includeGeneralEvents: saved?.includeGeneralEvents === true, includeTimetable: saved?.includeTimetable === true };
  } catch {
    return DEFAULT_STUDY_PROGRESS_PREFERENCES;
  }
}

function initialState(userId: string) {
  return {
    userId,
    session: Symbol(),
    preferences: readPreference(userId),
    error: null as string | null,
  };
}

// A progress inclusion preference, kept on this browser like the theme, but isolated by owner.
export function useStudyProgressPreference(ownerId?: string) {
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

  function setPreferences(preferences: StudyProgressPreferences) {
    if (!userId || activeSession.current !== state.session) return;
    try {
      window.localStorage.setItem(STORAGE_KEY_PREFIX + encodeURIComponent(userId), JSON.stringify(preferences));
      setState(current => current.session === state.session
        ? { ...current, preferences, error: null }
        : current);
    } catch {
      setState(current => current.session === state.session
        ? { ...current, error: '設定を保存できませんでした。ブラウザの保存設定を確認して、もう一度お試しください。' }
        : current);
    }
  }

  return { preferences: state.preferences, setPreferences, error: state.error };
}
