import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
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
  const visible = !loading && outcome !== null;
  useEffect(() => { onVisibilityChange?.(visible); }, [onVisibilityChange, visible]);
  return <>
    <StartupContentVisibility.Provider value={visible}>
      <div style={visible ? undefined : { display: 'none' }}>{children}</div>
    </StartupContentVisibility.Provider>
    {!visible ? <SplashScreen fixedLight canSkip={!loading} videoOutcome={outcome} onVideoComplete={finishVideo} /> : null}
  </>;
}
