import { useCallback, useEffect, useLayoutEffect, useState, type SetStateAction } from 'react';
import { isFontPreset, isWebFontPreset, loadWebFontStylesheet, type FontPreset } from '../lib/fontPreset';
import {
  getThemePaletteCssVariables,
  isThemePalette,
  type ThemeMode,
  type ThemePalette,
} from '../lib/themePalette';

const THEME_MODE_STORAGE_KEY = 'study-planner-theme-mode';
const THEME_PALETTE_STORAGE_KEY = 'study-planner-theme-palette';
const FONT_PRESET_STORAGE_KEY = 'study-planner-font-preset';
const READ_ERROR = '表示設定を読み込めませんでした。初期設定で表示しています。';
const SAVE_ERROR = '表示設定を保存できませんでした。再読み込みで元に戻る場合があります。';
const FONT_SAVE_ERROR = 'フォント設定を保存できませんでした。再読み込みで元に戻る場合があります。';
const FONT_LOAD_ERROR = 'フォントを読み込めませんでした。端末の書体で表示しています。';

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

// Unlike mode and palette, the font is written only after an explicit choice:
// existing users keep no new key, and an unknown saved value is never replaced.
function readStoredFontPreset(): { value: FontPreset; chosen: boolean } {
  try {
    const storedFont = typeof window === 'undefined' ? null : window.localStorage.getItem(FONT_PRESET_STORAGE_KEY);
    return { value: isFontPreset(storedFont) ? storedFont : 'system', chosen: false };
  } catch {
    return { value: 'system', chosen: false };
  }
}

export function useThemePreference() {
  const [modePreference, setModePreference] = useState(readStoredThemeMode);
  const [palettePreference, setPalettePreference] = useState(readStoredThemePalette);
  const [modeSaveFailed, setModeSaveFailed] = useState(false);
  const [paletteSaveFailed, setPaletteSaveFailed] = useState(false);
  const [fontPreference, setFontPreference] = useState(readStoredFontPreset);
  const [fontSaveFailed, setFontSaveFailed] = useState(false);
  const [fontLoadFailed, setFontLoadFailed] = useState(false);
  const fontPreset = fontPreference.value;
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

  const setFontPreset = useCallback((next: FontPreset) => {
    if (!isFontPreset(next)) return;
    setFontPreference({ value: next, chosen: true });
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

  useLayoutEffect(() => {
    const { dataset } = document.documentElement;
    // The standard choice leaves the root exactly as before font presets existed.
    if (fontPreference.value === 'system') delete dataset.fontPreset;
    else dataset.fontPreset = fontPreference.value;
    if (!fontPreference.chosen) return;
    try {
      window.localStorage.setItem(FONT_PRESET_STORAGE_KEY, fontPreference.value);
      setFontSaveFailed(false);
    } catch {
      setFontSaveFailed(true);
    }
  }, [fontPreference]);

  useEffect(() => {
    setFontLoadFailed(false);
    if (!isWebFontPreset(fontPreset)) return;
    let active = true;
    // Requested only while selected; no startup gate waits for it. Text is
    // painted in the fallback stack until the font swaps in, or stays there.
    loadWebFontStylesheet(fontPreset).catch(() => {
      if (active) setFontLoadFailed(true);
    });
    return () => { active = false; };
  }, [fontPreset]);

  return {
    fontPreset,
    setFontPreset,
    fontError: fontSaveFailed ? FONT_SAVE_ERROR : fontLoadFailed ? FONT_LOAD_ERROR : null,
    themeMode,
    setThemeMode,
    themePalette,
    setThemePalette,
    error: modeSaveFailed || paletteSaveFailed ? SAVE_ERROR
      : !modePreference.canPersist || !palettePreference.canPersist ? READ_ERROR : null,
  };
}
