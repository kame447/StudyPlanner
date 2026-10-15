import { getMotionLevel, REDUCED_FADE_MS, type MotionLevel } from './motionPreference';

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

const running = new WeakMap<Element, Animation>();

function play(element: Element | null | undefined, spec: EffectSpec, level: MotionLevel = getMotionLevel()): Animation | null {
  if (!element || level === 'off' || typeof element.animate !== 'function') return null;
  const frames = level === 'standard' ? spec.standard.frames : spec.reduced;
  if (!frames) return null;
  running.get(element)?.cancel();
  const animation = element.animate(frames, level === 'standard'
    ? { duration: spec.standard.duration, easing: spec.standard.easing }
    : { duration: REDUCED_FADE_MS, easing: 'ease-out' });
  running.set(element, animation);
  const release = () => { if (running.get(element) === animation) running.delete(element); };
  animation.addEventListener?.('finish', release);
  animation.addEventListener?.('cancel', release);
  return animation;
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
