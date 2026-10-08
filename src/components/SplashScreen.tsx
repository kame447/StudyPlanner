import { useEffect } from 'react';
import { startupTiming } from '../lib/startupTiming';
import splashLogo from '../assets/studyplanner-logo.png';
import startupVideo from '../assets/laplans_blackhole_1080x1920.mp4';
import startupPoster from '../assets/laplans-startup-poster.jpg';
import startupStill from '../assets/laplans-startup-still.jpg';
import { StartupVideo } from './StartupVideo';
import { useRootStartupReady } from './RootStartupReadyContext';

export function SplashScreen({ fixedLight = false }: { fixedLight?: boolean }) {
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
        {playIntro ? (
          <StartupVideo src={startupVideo} poster={startupPoster}>
            <img src={startupStill} alt="Laplans" className="startup-video__still" />
          </StartupVideo>
        ) : (
          <img src={splashLogo} alt="Study Planner" className="splash-screen__logo" />
        )}
        <p className="splash-screen__message" role="status">アプリを準備しています...</p>
      </div>
    </main>
  );
}
