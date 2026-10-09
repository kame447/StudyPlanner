import type { HomeNextPlanVisualKind } from '../../lib/homeNextPlanVisual';
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
}: {
  kind: HomeNextPlanVisualKind;
  preferences?: HomeScenePreferences;
  preview?: boolean;
  atmosphere?: HomeSceneAtmosphere;
  plan?: PixelStudentPlan | null;
}) {
  const now = useHomeDisplayClock();
  const student = useScheduledPixelStudent(plan, now, preferences.style === 'pixel' && !preview && kind !== 'other', preferences.animated);
  const currentAtmosphere = useHomeSceneAtmosphere();
  const atmosphere = suppliedAtmosphere ?? currentAtmosphere;
  const pixelStyle = preferences.style.startsWith('pixel');
  return <><div
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
