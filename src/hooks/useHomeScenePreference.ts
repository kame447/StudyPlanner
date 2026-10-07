import { useState } from 'react';
import {
  DEFAULT_HOME_SCENE_PREFERENCES,
  isHomeSceneStyle,
  type HomeSceneStyle,
} from '../lib/homeScenePreferences';

const STYLE_STORAGE_KEY = 'study-planner-home-scene-style';
const MOTION_STORAGE_KEY = 'study-planner-home-scene-motion';
const SAVE_ERROR = '設定を保存できませんでした。ブラウザの保存設定を確認して、もう一度お試しください。';

function readStored(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

// Appearance belongs to this browser, just like its theme and palette.
export function useHomeScenePreference() {
  const [style, setStyleState] = useState<HomeSceneStyle>(() => {
    const stored = readStored(STYLE_STORAGE_KEY);
    return isHomeSceneStyle(stored) ? stored : DEFAULT_HOME_SCENE_PREFERENCES.style;
  });
  const [animated, setAnimatedState] = useState(() => readStored(MOTION_STORAGE_KEY) === 'true');
  const [error, setError] = useState<string | null>(null);

  function setStyle(nextStyle: HomeSceneStyle) {
    if (!isHomeSceneStyle(nextStyle)) return;
    try {
      window.localStorage.setItem(STYLE_STORAGE_KEY, nextStyle);
      setStyleState(nextStyle);
      setError(null);
    } catch {
      setError(SAVE_ERROR);
    }
  }

  function setAnimated(nextAnimated: boolean) {
    try {
      window.localStorage.setItem(MOTION_STORAGE_KEY, String(nextAnimated));
      setAnimatedState(nextAnimated);
      setError(null);
    } catch {
      setError(SAVE_ERROR);
    }
  }

  return { preferences: { style, animated }, setStyle, setAnimated, error };
}
