import { useEffect } from 'react';
import { startupTiming } from '../lib/startupTiming';
import startupVideo from '../assets/laplance_blackhole_1080x1920.mp4';
import startupPoster from '../assets/laplance-startup-poster.jpg';
import startupStill from '../assets/laplance-startup-still.jpg';
import { StartupVideo, type StartupVideoOutcome } from './StartupVideo';
import { StudyPlannerLogo } from './StudyPlannerLogo';
import { useRootStartupReady } from './RootStartupReadyContext';

export function SplashScreen({ fixedLight = false, canSkip = false, videoOutcome = null, onVideoComplete }: {
  fixedLight?: boolean; canSkip?: boolean; videoOutcome?: StartupVideoOutcome | null;
  onVideoComplete?: (reason: StartupVideoOutcome) => boolean | void;
}) {
  // An inner App may still be booting behind the root's hidden-child boundary.
  // Only the root-owned visible splash (or a standalone App) plays the intro.
  const rootStartupOwner = useRootStartupReady();
  const playIntro = fixedLight && rootStartupOwner === null;
  useEffect(() => { startupTiming.markOnce('splash-mounted'); }, []);
  return (
    <main
      className={
        fixedLight
          ? `loading-screen splash-screen splash-screen--startup-light${playIntro ? ' startup-splash' : ''}`
          : 'loading-screen splash-screen'
      }
      aria-label="アプリ起動中"
    >
      <div className="splash-screen__inner">
        {playIntro && videoOutcome ? <img src={startupStill} alt="Laplance" className="startup-video__still" /> : playIntro ? (
          <StartupVideo src={startupVideo} poster={startupPoster} canSkip={canSkip} onComplete={onVideoComplete}>
            <img src={startupStill} alt="Laplance" className="startup-video__still" />
          </StartupVideo>
        ) : (
          <StudyPlannerLogo />
        )}
        <p className="splash-screen__message" role="status">{playIntro && canSkip ? '準備できました' : 'アプリを準備しています...'}</p>
      </div>
    </main>
  );
}
