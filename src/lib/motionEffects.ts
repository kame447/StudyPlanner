import { getMotionLevel, REDUCED_FADE_MS, subscribeMotion, type MotionLevel } from './motionPreference';

/**
 * One-shot feedback motion for elements that already exist in the DOM.
 *
 * These run through the Web Animations API instead of state or class toggles:
 * nothing re-renders, input is never blocked, and the animation leaves no fill
 * behind. They animate only the individual `opacity`, `scale` and `translate`
 * properties, so they compose with any layout `transform` the element already
 * has and never shift layout. A newer effect on the same element replaces the
 * running one, so rapid repeats cannot stack or leave an element mid-way.
 */

/** Mirror `--motion-duration-*` in src/styles/motion.css. */
export const MOTION_DURATION_MS = { fast: 150, base: 210, slow: 300 } as const;
const EMPHASIZED = 'cubic-bezier(0.22, 1, 0.36, 1)';
const STANDARD = 'cubic-bezier(0.2, 0, 0, 1)';

type Frames = Keyframe[];
interface EffectSpec {
  standard: { frames: Frames; duration: number; easing: string };
  /** Opacity-only variant for `reduced`, or null to show no motion there. */
  reduced: Frames | null;
}

// Entries live only while an effect runs (finish/cancel removes them).
const running = new Map<Element, Animation>();
let playedLevel: MotionLevel | null = null;

/** A level change also stops effects already in flight; nothing finishes at the old level. */
function cancelRunningOnLevelChange() {
  const next = getMotionLevel();
  if (next === playedLevel) return;
  playedLevel = next;
  for (const animation of [...running.values()]) animation.cancel();
  running.clear();
}

function play(element: Element | null | undefined, spec: EffectSpec, level: MotionLevel = getMotionLevel()): Animation | null {
  if (!element) return null;
  // A newer effect, or a newer decision to show none, replaces the running one.
  running.get(element)?.cancel();
  running.delete(element);
  if (level === 'off' || typeof element.animate !== 'function') return null;
  const frames = level === 'standard' ? spec.standard.frames : spec.reduced;
  if (!frames) return null;
  playedLevel = level;
  // Subscribing the same function again is a no-op.
  subscribeMotion(cancelRunningOnLevelChange);
  const animation = element.animate(frames, level === 'standard'
    ? { duration: spec.standard.duration, easing: spec.standard.easing }
    : { duration: REDUCED_FADE_MS, easing: 'ease-out' });
  running.set(element, animation);
  const release = () => { if (running.get(element) === animation) running.delete(element); };
  animation.addEventListener?.('finish', release);
  animation.addEventListener?.('cancel', release);
  return animation;
}

/**
 * Measures `element` where it rests once its running effect ends. Every
 * effect here ends at the element's own place, so the end state is its layout
 * position. The effect is parked at its end only for the measurement and then
 * resumes untouched, so a caller can find an item's destination while it is
 * still visibly moving.
 */
export function measureAtRest<T>(element: Element, measure: () => T): T {
  const animation = running.get(element);
  const end = animation?.effect?.getComputedTiming?.().endTime;
  if (!animation || typeof end !== 'number' || typeof animation.pause !== 'function') return measure();
  const wasPaused = animation.playState === 'paused';
  const time = animation.currentTime;
  animation.pause();
  animation.currentTime = end;
  try {
    return measure();
  } finally {
    animation.currentTime = time;
    if (!wasPaused) animation.play();
  }
}

const ENTRANCE: EffectSpec = {
  standard: {
    frames: [
      { opacity: 0, scale: '0.94', translate: '0 6px' },
      { opacity: 1, scale: '1', translate: '0 0' },
    ],
    duration: MOTION_DURATION_MS.base,
    easing: EMPHASIZED,
  },
  reduced: [{ opacity: 0 }, { opacity: 1 }],
};

const SETTLE: EffectSpec = {
  standard: {
    frames: [
      { scale: '0.94' },
      { scale: '1.03', offset: 0.6 },
      { scale: '1' },
    ],
    duration: MOTION_DURATION_MS.slow,
    easing: STANDARD,
  },
  reduced: [{ opacity: 0.45 }, { opacity: 1 }],
};

/** A newly added item arrives in place. */
export function playEntrance(element: Element | null | undefined) {
  return play(element, ENTRANCE);
}

/** An existing item whose time, date or content just changed lands in its new state. */
export function playSettle(element: Element | null | undefined) {
  return play(element, SETTLE);
}

export type NavigationDirection = 'forward' | 'backward';

/**
 * Content for a different day/week/month replaced the previous one. The new
 * content slides in from the side the user moved toward; it never waits for
 * the old content, so rapid navigation always shows the latest period.
 */
export function playNavigation(element: Element | null | undefined, direction: NavigationDirection) {
  const offset = direction === 'forward' ? '18px' : '-18px';
  return play(element, {
    standard: {
      frames: [
        { opacity: 0.35, translate: `${offset} 0` },
        { opacity: 1, translate: '0 0' },
      ],
      duration: MOTION_DURATION_MS.base,
      easing: EMPHASIZED,
    },
    reduced: [{ opacity: 0.35 }, { opacity: 1 }],
  });
}

/**
 * An unchanged item was pushed to a new place by a neighbouring change (a
 * removal closing up, an insertion making room). It glides from where it was
 * drawn (`x`, `y` px relative to its new place). Below standard it simply
 * appears in its new place: a fade would suggest the item itself changed.
 */
export function playShift(element: Element | null | undefined, x: number, y: number) {
  return play(element, {
    standard: {
      frames: [{ translate: `${x}px ${y}px` }, { translate: '0 0' }],
      duration: MOTION_DURATION_MS.base,
      easing: EMPHASIZED,
    },
    reduced: null,
  });
}
