import type { HomeNextPlanVisualKind } from '../../lib/homeNextPlanVisual';
import { DEFAULT_HOME_SCENE_PREFERENCES, type HomeScenePreferences } from '../../lib/homeScenePreferences';
import { CozyScene } from './scenes/CozyScene';
import { MinimalScene } from './scenes/MinimalScene';
import { PixelScene } from './scenes/PixelScene';
import { PixelCompanionScene } from './scenes/PixelCompanionScene';

export function HomeScene({
  kind,
  preferences = DEFAULT_HOME_SCENE_PREFERENCES,
  preview = false,
}: {
  kind: HomeNextPlanVisualKind;
  preferences?: HomeScenePreferences;
  preview?: boolean;
}) {
  return <div
    className={preview ? 'home-scene-preview' : 'home-study-scene'}
    data-scene-style={preferences.style}
    data-scene-kind={kind}
    data-scene-motion={preferences.animated && !preview ? 'on' : 'off'}
    aria-hidden="true"
  >
    <svg className="home-scene-art" viewBox={preview ? '0 0 320 200' : '64 0 256 200'} fill="none" focusable="false" preserveAspectRatio="xMaxYMax meet">
      {preferences.style === 'cozy' ? <CozyScene kind={kind} />
        : preferences.style === 'minimal' ? <MinimalScene kind={kind} />
        : preferences.style === 'pixel-cat' ? <PixelCompanionScene kind={kind} companion="cat" />
        : preferences.style === 'pixel-turtle' ? <PixelCompanionScene kind={kind} companion="turtle" />
        : <PixelScene kind={kind} />}
    </svg>
  </div>;
}
