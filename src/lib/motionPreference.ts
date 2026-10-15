/**
 * Motion policy owner.
 *
 * The user chooses how much interface motion they want; the device may ask for
 * less. This module combines both into one effective level and is the only
 * place that reads `prefers-reduced-motion`, persists the choice, or publishes
 * `<html data-motion>` for CSS. React reads it through `useMotionPreference`;
 * imperative motion (exit waits, gesture settles, smooth scroll) calls
 * `getMotionLevel()` at the moment it would animate.
 *
 * Levels:
 * - standard: spatial motion (movement, scale, sheets) and opted-in ambience.
 * - reduced:  no movement or scale and no ambient loops; short opacity fades
 *             only. The device reduced-motion setting caps `standard` here.
 * - off:      no animation or transition. Meaningful state changes must stay
 *             recognisable from colour, shape, text and focus alone.
 */
export type MotionPreference = 'standard' | 'reduced' | 'off';
export type MotionLevel = MotionPreference;

export const MOTION_PREFERENCE_OPTIONS: ReadonlyArray<{ id: MotionPreference; label: string }> = [
  { id: 'standard', label: '標準' },
  { id: 'reduced', label: '控えめ' },
  { id: 'off', label: 'オフ' },
];

export const DEFAULT_MOTION_PREFERENCE: MotionPreference = 'standard';
export const MOTION_STORAGE_KEY = 'study-planner-motion';
const SYSTEM_REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

/** Exit animation length in `standard`; mirrors `--motion-duration-exit` in motion.css. */
export const STANDARD_EXIT_MS = 220;
/** Opacity-only fade used by `reduced`; mirrors `--motion-duration-fade` in motion.css. */
export const REDUCED_FADE_MS = 120;

export function isMotionPreference(value: unknown): value is MotionPreference {
  return value === 'standard' || value === 'reduced' || value === 'off';
}

export function resolveMotionLevel(preference: MotionPreference, systemPrefersReduced: boolean): MotionLevel {
  if (preference === 'standard' && systemPrefersReduced) return 'reduced';
  return preference;
}

/**
 * Whether movement, scale, smooth scrolling, momentum and decorative loops may
 * run right now. Fades are still allowed under `reduced`.
 */
export function allowsSpatialMotion(): boolean {
  return getMotionLevel() === 'standard';
}

/**
 * How long a surface may keep the user waiting for its exit animation.
 * `off` never waits; `reduced` waits only for the short fade.
 */
export function resolveExitDurationMs(level: MotionLevel, standardMs: number): number {
  if (level === 'off' || standardMs <= 0) return 0;
  return level === 'reduced' ? Math.min(standardMs, REDUCED_FADE_MS) : standardMs;
}

function systemQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(SYSTEM_REDUCED_QUERY) ?? null;
}

export function systemPrefersReducedMotion(): boolean {
  return systemQuery()?.matches === true;
}

function readStoredPreference(): MotionPreference {
  try {
    const stored = typeof window === 'undefined' ? null : window.localStorage.getItem(MOTION_STORAGE_KEY);
    return isMotionPreference(stored) ? stored : DEFAULT_MOTION_PREFERENCE;
  } catch {
    return DEFAULT_MOTION_PREFERENCE;
  }
}

let preference: MotionPreference | undefined;
const listeners = new Set<() => void>();
let detachSources: (() => void) | null = null;
let installed = false;

export function getMotionPreference(): MotionPreference {
  return preference ??= readStoredPreference();
}

/** The effective level, read live so a device setting change applies immediately. */
export function getMotionLevel(): MotionLevel {
  return resolveMotionLevel(getMotionPreference(), systemPrefersReducedMotion());
}

function writeRootLevel() {
  const root = typeof document === 'undefined' ? undefined : document.documentElement;
  if (root?.dataset) root.dataset.motion = getMotionLevel();
}

function publish() {
  writeRootLevel();
  for (const listener of [...listeners]) listener();
}

function attachSources() {
  const query = systemQuery();
  const onSystemChange = () => publish();
  // Another tab of this browser changed the stored choice.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== MOTION_STORAGE_KEY) return;
    preference = isMotionPreference(event.newValue) ? event.newValue : DEFAULT_MOTION_PREFERENCE;
    publish();
  };
  query?.addEventListener?.('change', onSystemChange);
  window.addEventListener?.('storage', onStorage);
  return () => {
    query?.removeEventListener?.('change', onSystemChange);
    window.removeEventListener?.('storage', onStorage);
  };
}

export function subscribeMotion(listener: () => void): () => void {
  listeners.add(listener);
  if (!detachSources && typeof window !== 'undefined') detachSources = attachSources();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && detachSources && !installed) {
      detachSources();
      detachSources = null;
    }
  };
}

/**
 * Persists the choice. Returns false, leaving the current level untouched, when
 * storage refuses it: a failed save must not look saved.
 */
export function setMotionPreference(next: MotionPreference): boolean {
  if (!isMotionPreference(next)) return false;
  try {
    window.localStorage.setItem(MOTION_STORAGE_KEY, next);
  } catch {
    return false;
  }
  preference = next;
  publish();
  return true;
}


/**
 * Publishes the effective level on `<html>` before the first render and keeps
 * it current for the life of the page, independently of which React tree
 * (startup, auth, app, admin) is mounted.
 */
export function installMotionPreference() {
  writeRootLevel();
  if (installed || typeof window === 'undefined') return;
  installed = true;
  detachSources ??= attachSources();
}

/** Test-only: forget cached state and listeners between isolated cases. */
export function resetMotionPreferenceForTests() {
  detachSources?.();
  detachSources = null;
  installed = false;
  preference = undefined;
  listeners.clear();
  const root = typeof document === 'undefined' ? undefined : document.documentElement;
  if (root?.dataset) delete root.dataset.motion;
}
