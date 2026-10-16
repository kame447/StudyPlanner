import { useLayoutEffect, useRef } from 'react';
import type { HomeNextPlanVisualKind } from '../../lib/homeNextPlanVisual';
import { playHop, stopEffect } from '../../lib/motionEffects';
import { DEFAULT_HOME_SCENE_PREFERENCES, type HomeScenePreferences } from '../../lib/homeScenePreferences';
import { useHomeDisplayClock } from './HomeDisplayClockContext';
import { useScheduledPixelStudent, type PixelStudentPlan } from './useScheduledPixelStudent';
import { CozyScene } from './scenes/CozyScene';
import { MinimalScene } from './scenes/MinimalScene';
import { PixelScene } from './scenes/PixelScene';
import { PixelCompanionScene } from './scenes/PixelCompanionScene';
import { useHomeSceneAtmosphere } from './HomeSceneAtmosphereContext';
import { HOME_MOON_PHASE_LABELS, HOME_SKY_PERIOD_LABELS, type HomeSceneAtmosphere } from '../../lib/homeSceneAtmosphere';

export function HomeScene({
  kind,
  preferences = DEFAULT_HOME_SCENE_PREFERENCES,
  preview = false,
  atmosphere: suppliedAtmosphere,
  plan,
  recorded,
}: {
  kind: HomeNextPlanVisualKind;
  preferences?: HomeScenePreferences;
  preview?: boolean;
  atmosphere?: HomeSceneAtmosphere;
  plan?: PixelStudentPlan | null;
  /** Study saved for this week (not clipped to the clock); the companion hops when it grows. */
  recorded?: { week: string; minutes: number };
}) {
  const now = useHomeDisplayClock();
  const student = useScheduledPixelStudent(plan, now, preferences.style === 'pixel' && !preview && kind !== 'other', preferences.animated);
  const currentAtmosphere = useHomeSceneAtmosphere();
  const atmosphere = suppliedAtmosphere ?? currentAtmosphere;
  const pixelStyle = preferences.style.startsWith('pixel');
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const shownRecord = useRef(recorded);
  const companionMoves = !preview && preferences.animated && preferences.style.startsWith('pixel-');
  const companion = () => {
    const scene = sceneRef.current;
    return scene && typeof scene.querySelector === 'function' ? scene.querySelector('[data-scene-companion]') : null;
  };
  // The cat or turtle hops once when the user saves more study for this week
  // while Home is open. Only saved records count (never the clock moving
  // through a record), it follows the illustration's own motion setting,
  // and it never runs on first paint, on a hidden page, for a decrease or
  // when a new week begins. The time-of-day sky is left alone.
  useLayoutEffect(() => {
    const before = shownRecord.current;
    shownRecord.current = recorded;
    if (!before || !recorded || before.week !== recorded.week || recorded.minutes <= before.minutes) return;
    if (!companionMoves) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    playHop(companion());
  }, [companionMoves, recorded?.minutes, recorded?.week]);
  // Turning the illustration's motion off stops a hop already in flight.
  useLayoutEffect(() => {
    if (!companionMoves) stopEffect(companion());
  }, [companionMoves]);
  return <><div
    ref={sceneRef}
    className={preview ? 'home-scene-preview' : 'home-study-scene'}
    data-scene-style={preferences.style}
    data-scene-kind={kind}
    data-scene-motion={preferences.animated && !preview ? 'on' : 'off'}
    data-scene-period={pixelStyle ? atmosphere.period : undefined}
    aria-hidden="true"
  >
    <svg className="home-scene-art" viewBox={preview ? '0 0 320 200' : '64 0 256 200'} fill="none" focusable="false" preserveAspectRatio="xMaxYMax meet">
      {preferences.style === 'cozy' ? <CozyScene kind={kind} />
        : preferences.style === 'minimal' ? <MinimalScene kind={kind} />
        : preferences.style === 'pixel-cat' ? <PixelCompanionScene kind={kind} companion="cat" atmosphere={atmosphere} />
        : preferences.style === 'pixel-turtle' ? <PixelCompanionScene kind={kind} companion="turtle" atmosphere={atmosphere} />
        : <PixelScene kind={kind} atmosphere={atmosphere} student={preview ? 'studying' : student} />}
    </svg>
  </div>{pixelStyle && !preview ? <span className="home-scene-time-description">
    空の演出：{HOME_SKY_PERIOD_LABELS[atmosphere.period]}。月の形：{HOME_MOON_PHASE_LABELS[atmosphere.moonStage]}（月相の近似）。
  </span> : null}</>;
}
