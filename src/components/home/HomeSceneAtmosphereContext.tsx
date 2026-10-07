import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { resolveHomeSceneAtmosphere, type HomeSceneAtmosphere } from '../../lib/homeSceneAtmosphere';

const HomeSceneAtmosphereContext = createContext<HomeSceneAtmosphere | null>(null);

export function HomeSceneAtmosphereProvider({ active, children }: { active: boolean; children: ReactNode }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active || typeof window === 'undefined' || typeof document === 'undefined'
      || !window.addEventListener || !document.addEventListener) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'hidden') return;
      const instant = Date.now();
      setNow(new Date(instant));
      timer = setTimeout(refresh, 60_000 - ((instant % 60_000) + 60_000) % 60_000);
    };
    refresh();
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
    };
  }, [active]);
  const atmosphere = useMemo(() => resolveHomeSceneAtmosphere(now), [now]);
  return <HomeSceneAtmosphereContext.Provider value={atmosphere}>{children}</HomeSceneAtmosphereContext.Provider>;
}

export function useHomeSceneAtmosphere(): HomeSceneAtmosphere {
  const atmosphere = useContext(HomeSceneAtmosphereContext);
  // Standalone renderers can inject a snapshot; they do not create extra timers.
  return atmosphere ?? resolveHomeSceneAtmosphere(new Date());
}
