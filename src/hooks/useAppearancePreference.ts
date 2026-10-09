import { useEffect, useLayoutEffect, useState } from 'react';
import { isAppearance, type Appearance } from '../lib/appearance';

const STORAGE_KEY = 'study-planner-appearance';
const STYLE_ERROR = 'ドットテーマを読み込めませんでした。画面を再読み込みしてお試しください。';
const SAVE_ERROR = 'テーマを保存できませんでした。ブラウザの保存設定を確認して、もう一度お試しください。';

// Vite remembers CSS preload URLs before they settle and does not retry failed
// links. Retain the real result across selections, including a rejection, so a
// later effect never mistakes that cached URL for a successfully loaded theme.
let pixelStyles: Promise<unknown> | undefined;
function loadPixelStyles() {
  return pixelStyles ??= import('../styles/appearance-pixel.css');
}

function readStoredAppearance(): Appearance {
  try {
    const stored = typeof window === 'undefined' ? null : window.localStorage.getItem(STORAGE_KEY);
    return isAppearance(stored) ? stored : 'standard';
  } catch {
    return 'standard';
  }
}

// Browser-wide presentation, like the palette and Home illustration. No owner
// data, network read or startup readiness dependency belongs to this preference.
export function useAppearancePreference() {
  const [appearance, setAppearanceState] = useState<Appearance>(readStoredAppearance);
  const [error, setError] = useState<string | null>(null);
  const [styleError, setStyleError] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.appearance = appearance;
  }, [appearance]);

  useEffect(() => {
    let active = true;
    setStyleError(null);
    if (appearance === 'pixel') {
      // Optional paint and its font are fetched only after this choice. The
      // attribute scopes late CSS arrivals, including a switch back to standard.
      void loadPixelStyles().catch(() => {
        if (active) setStyleError(STYLE_ERROR);
      });
    }
    return () => { active = false; };
  }, [appearance]);

  function setAppearance(next: Appearance) {
    if (!isAppearance(next)) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
      setAppearanceState(next);
      setError(null);
    } catch {
      // Match the Home illustration contract: a failed save must not look saved.
      setError(SAVE_ERROR);
    }
  }

  return { appearance, setAppearance, error: error ?? styleError };
}
