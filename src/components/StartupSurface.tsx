import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type PropsWithChildren } from 'react';
import { startupTiming } from '../lib/startupTiming';
import { SplashScreen } from './SplashScreen';
import type { StartupVideoOutcome } from './StartupVideo';

const StartupContentVisibility = createContext(true);
export const useStartupContentVisible = () => useContext(StartupContentVisibility);

/** Media is presentation only. Neither its completion nor a gesture makes data ready. */
export function StartupSurface({ children, loading, isCurrent, onVisibilityChange }: PropsWithChildren<{
  loading: boolean;
  isCurrent?: () => boolean;
  onVisibilityChange?: (visible: boolean) => void;
}>) {
  const [outcome, setOutcome] = useState<StartupVideoOutcome | null>(null);
  const loadingNow = useRef(loading);
  loadingNow.current = loading;
  const finishVideo = useCallback((reason: StartupVideoOutcome) => {
    // Authorize and record the gesture synchronously. An auth event may revoke
    // this session before React commits its new loading state.
    if (reason === 'skipped' && (loadingNow.current || isCurrent?.() === false)) return false;
    setOutcome(previous => previous ?? reason);
    return true;
  }, [isCurrent]);
  // Observe the existing presentation gate, including error/onboarding exits.
  // This is not a second definition of successful data readiness.
  const waitingObserved = useRef(true);
  useLayoutEffect(() => {
    if (loading) { waitingObserved.current = true; return; }
    if (!waitingObserved.current || isCurrent?.() === false) return;
    waitingObserved.current = false;
    startupTiming.begin('startup-wait-ended')();
  }, [isCurrent, loading]);
  useLayoutEffect(() => {
    if (outcome) startupTiming.markIntroComplete(outcome);
  }, [outcome]);
  const visible = !loading && outcome !== null;
  useEffect(() => { onVisibilityChange?.(visible); }, [onVisibilityChange, visible]);
  return <>
    <StartupContentVisibility.Provider value={visible}>
      <div style={visible ? undefined : { display: 'none' }}>{children}</div>
    </StartupContentVisibility.Provider>
    {!visible ? <SplashScreen fixedLight canSkip={!loading} videoOutcome={outcome} onVideoComplete={finishVideo} /> : null}
  </>;
}
