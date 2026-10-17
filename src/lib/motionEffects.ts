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
  // Only an effect that is still moving needs parking. A finished one
  // already draws the rest position, and resuming it would restart it.
  const state = animation?.playState;
  if (!animation || (state !== 'running' && state !== 'paused') || typeof end !== 'number'
    || typeof animation.pause !== 'function') return measure();
  const time = animation.currentTime;
  animation.pause();
  animation.currentTime = end;
  try {
    return measure();
  } finally {
    animation.currentTime = time;
    if (state === 'running') animation.play();
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

/** Stops `element`'s running effect at once, e.g. when a local motion setting is turned off. */
export function stopEffect(element: Element | null | undefined) {
  if (!element) return;
  running.get(element)?.cancel();
  running.delete(element);
}

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
 * A selection indicator moved to another control. It travels from where it
 * was (`fromOffsetX`, in px relative to its new place) instead of reappearing,
 * so the eye follows the selection. Below standard it only fades in place.
 */
export function playIndicatorTravel(element: Element | null | undefined, fromOffsetX: number) {
  return play(element, {
    standard: {
      frames: [
        { translate: `${fromOffsetX}px 0`, scale: '0.88' },
        { translate: '0 0', scale: '1.06', offset: 0.72 },
        { translate: '0 0', scale: '1' },
      ],
      duration: MOTION_DURATION_MS.slow,
      easing: EMPHASIZED,
    },
    reduced: [{ opacity: 0.4 }, { opacity: 1 }],
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

const MAX_GROWTH_SCALE = 50;

/**
 * A bar or gauge whose value changed grows or shrinks from its previous
 * length (`fromScale` of the new one) toward the new value, along `axis`
 * from its CSS transform-origin. The value itself is already shown; below
 * standard the bar only brightens briefly to mark the change.
 */
export function playGrowth(element: Element | null | undefined, fromScale: number, axis: 'x' | 'y' = 'y') {
  // A bar can shrink from full length to its few-percent minimum (~33×).
  const from = Math.min(Math.max(fromScale, 0), MAX_GROWTH_SCALE);
  return play(element, {
    standard: {
      frames: [{ scale: axis === 'y' ? `1 ${from}` : `${from} 1` }, { scale: '1 1' }],
      duration: MOTION_DURATION_MS.slow,
      easing: EMPHASIZED,
    },
    reduced: [{ opacity: 0.45 }, { opacity: 1 }],
  });
}

export interface MotionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The same thing the user just touched reappears in a new place (a cover
 * opening into its detail, or back). It grows from where it was, so the eye
 * keeps hold of it. Below standard it only fades in; with no usable origin
 * it simply appears.
 */
export function playFromRect(element: Element | null | undefined, from: MotionRect) {
  if (!element || typeof element.getBoundingClientRect !== 'function') return null;
  const to = element.getBoundingClientRect();
  if (!(to.width > 0 && to.height > 0 && from.width > 0 && from.height > 0)) return null;
  const x = Math.round(from.left + from.width / 2 - (to.left + to.width / 2));
  const y = Math.round(from.top + from.height / 2 - (to.top + to.height / 2));
  const scaleX = (from.width / to.width).toFixed(3);
  const scaleY = (from.height / to.height).toFixed(3);
  return play(element, {
    standard: {
      frames: [
        { translate: `${x}px ${y}px`, scale: `${scaleX} ${scaleY}` },
        { translate: '0 0', scale: '1 1' },
      ],
      duration: MOTION_DURATION_MS.slow,
      easing: EMPHASIZED,
    },
    reduced: [{ opacity: 0 }, { opacity: 1 }],
  });
}

/**
 * One step of a flow replaced the previous one in the same place (a timer
 * becoming its record form). The new step comes forward without moving
 * sideways, so it never widens a scroll area while it appears.
 */
export function playStepChange(element: Element | null | undefined) {
  return play(element, {
    standard: {
      frames: [{ opacity: 0.35, scale: '0.985' }, { opacity: 1, scale: '1' }],
      duration: MOTION_DURATION_MS.base,
      easing: EMPHASIZED,
    },
    reduced: [{ opacity: 0.35 }, { opacity: 1 }],
  });
}

/**
 * A decorative companion acknowledges something the user just achieved
 * with one small hop, stepped to match pixel art. Standard only: it is
 * ambience, so below standard nothing moves.
 */
export function playHop(element: Element | null | undefined) {
  return play(element, {
    standard: {
      frames: [
        { translate: '0 0' },
        { translate: '0 -6px', offset: 0.35 },
        { translate: '0 -2px', offset: 0.7 },
        { translate: '0 0' },
      ],
      duration: MOTION_DURATION_MS.slow + 120,
      easing: 'steps(6, end)',
    },
    reduced: null,
  });
}
