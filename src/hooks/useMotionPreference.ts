import { useCallback, useState, useSyncExternalStore } from 'react';
import {
  getMotionLevel,
  getMotionPreference,
  setMotionPreference,
  subscribeMotion,
  systemPrefersReducedMotion,
  type MotionLevel,
  type MotionPreference,
} from '../lib/motionPreference';

const SAVE_ERROR = 'アニメーションの設定を保存できませんでした。ブラウザの保存設定を確認して、もう一度お試しください。';

/** The effective motion level, re-rendering only when it changes. */
export function useMotionLevel(): MotionLevel {
  return useSyncExternalStore(subscribeMotion, getMotionLevel, () => 'standard');
}

// Browser-wide presentation, like the theme: no owner data or network involved.
export function useMotionPreference() {
  const preference = useSyncExternalStore<MotionPreference>(subscribeMotion, getMotionPreference, () => 'standard');
  const level = useMotionLevel();
  const systemReduced = useSyncExternalStore(subscribeMotion, systemPrefersReducedMotion, () => false);
  const [error, setError] = useState<string | null>(null);

  const setPreference = useCallback((next: MotionPreference) => {
    setError(setMotionPreference(next) ? null : SAVE_ERROR);
  }, []);

  return { preference, level, systemReduced, setPreference, error };
}
