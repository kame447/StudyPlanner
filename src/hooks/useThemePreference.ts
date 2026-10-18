import { useCallback, useLayoutEffect, useState, type SetStateAction } from 'react';
import {
  getThemePaletteCssVariables,
  isThemePalette,
  type ThemeMode,
  type ThemePalette,
} from '../lib/themePalette';

const THEME_MODE_STORAGE_KEY = 'study-planner-theme-mode';
const THEME_PALETTE_STORAGE_KEY = 'study-planner-theme-palette';
const READ_ERROR = '表示設定を読み込めませんでした。初期設定で表示しています。';
const SAVE_ERROR = '表示設定を保存できませんでした。再読み込みで元に戻る場合があります。';

function readStoredThemeMode(): { value: ThemeMode; canPersist: boolean } {
  try {
    const storedTheme = typeof window === 'undefined' ? null : window.localStorage.getItem(THEME_MODE_STORAGE_KEY);
    return { value: storedTheme === 'dark' ? 'dark' : 'light', canPersist: true };
  } catch {
    return { value: 'light', canPersist: false };
  }
}

function readStoredThemePalette(): { value: ThemePalette; canPersist: boolean } {
  try {
    const storedPalette = typeof window === 'undefined' ? null : window.localStorage.getItem(THEME_PALETTE_STORAGE_KEY);
    return { value: isThemePalette(storedPalette) ? storedPalette : 'forest', canPersist: true };
  } catch {
    return { value: 'forest', canPersist: false };
  }
}

export function useThemePreference() {
  const [modePreference, setModePreference] = useState(readStoredThemeMode);
  const [palettePreference, setPalettePreference] = useState(readStoredThemePalette);
  const [modeSaveFailed, setModeSaveFailed] = useState(false);
  const [paletteSaveFailed, setPaletteSaveFailed] = useState(false);
  const themeMode = modePreference.value;
  const themePalette = palettePreference.value;

  // A read fallback must not overwrite an unknown saved value. An explicit
  // choice permits a write, including retrying the currently displayed value.
  const setThemeMode = useCallback((next: SetStateAction<ThemeMode>) => {
    setModePreference(previous => ({
      value: typeof next === 'function' ? next(previous.value) : next,
      canPersist: true,
    }));
  }, []);
  const setThemePalette = useCallback((next: SetStateAction<ThemePalette>) => {
    setPalettePreference(previous => ({
      value: typeof next === 'function' ? next(previous.value) : next,
      canPersist: true,
    }));
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = modePreference.value;
    if (!modePreference.canPersist) return;
    try {
      window.localStorage.setItem(THEME_MODE_STORAGE_KEY, modePreference.value);
      setModeSaveFailed(false);
    } catch {
      setModeSaveFailed(true);
    }
  }, [modePreference]);

  useLayoutEffect(() => {
    const rootStyle = document.documentElement.style;
    const paletteVariables = getThemePaletteCssVariables(palettePreference.value, themeMode);

    for (const [variableName, value] of Object.entries(paletteVariables)) {
      rootStyle.setProperty(variableName, value);
    }

    if (!palettePreference.canPersist) return;
    try {
      window.localStorage.setItem(THEME_PALETTE_STORAGE_KEY, palettePreference.value);
      setPaletteSaveFailed(false);
    } catch {
      setPaletteSaveFailed(true);
    }
  }, [themeMode, palettePreference]);

  return {
    themeMode,
    setThemeMode,
    themePalette,
    setThemePalette,
    error: modeSaveFailed || paletteSaveFailed ? SAVE_ERROR
      : !modePreference.canPersist || !palettePreference.canPersist ? READ_ERROR : null,
  };
}
