import { useLayoutEffect, useState } from 'react';
import {
  getThemePaletteCssVariables,
  type ThemeMode,
  type ThemePalette,
} from '../lib/themePalette';

const THEME_MODE_STORAGE_KEY = 'study-planner-theme-mode';
const THEME_PALETTE_STORAGE_KEY = 'study-planner-theme-palette';

function readStoredThemeMode(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'light';
  }

  const storedTheme = window.localStorage.getItem(THEME_MODE_STORAGE_KEY);
  return storedTheme === 'dark' ? 'dark' : 'light';
}

function readStoredThemePalette(): ThemePalette {
  if (typeof window === 'undefined') {
    return 'forest';
  }

  const storedPalette = window.localStorage.getItem(THEME_PALETTE_STORAGE_KEY);
  switch (storedPalette) {
    case 'ocean':
    case 'sakura':
    case 'amber':
    case 'violet':
      return storedPalette;
    default:
      return 'forest';
  }
}

export function useThemePreference() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(readStoredThemeMode);
  const [themePalette, setThemePalette] =
    useState<ThemePalette>(readStoredThemePalette);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem(THEME_MODE_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useLayoutEffect(() => {
    const rootStyle = document.documentElement.style;
    const paletteVariables = getThemePaletteCssVariables(themePalette, themeMode);

    for (const [variableName, value] of Object.entries(paletteVariables)) {
      rootStyle.setProperty(variableName, value);
    }

    window.localStorage.setItem(THEME_PALETTE_STORAGE_KEY, themePalette);
  }, [themeMode, themePalette]);

  return {
    themeMode,
    setThemeMode,
    themePalette,
    setThemePalette,
  };
}
