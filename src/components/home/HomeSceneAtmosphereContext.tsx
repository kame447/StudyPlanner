import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { resolveHomeSceneAtmosphere, type HomeSceneAtmosphere } from '../../lib/homeSceneAtmosphere';
import { useHomeDisplayClock } from './HomeDisplayClockContext';

const HomeSceneAtmosphereContext = createContext<HomeSceneAtmosphere | null>(null);

export function HomeSceneAtmosphereProvider({ children }: { children: ReactNode }) {
  const now = useHomeDisplayClock();
  const atmosphere = useMemo(() => resolveHomeSceneAtmosphere(now), [now]);
  return <HomeSceneAtmosphereContext.Provider value={atmosphere}>{children}</HomeSceneAtmosphereContext.Provider>;
}

export function useHomeSceneAtmosphere(): HomeSceneAtmosphere {
  const atmosphere = useContext(HomeSceneAtmosphereContext);
  // Standalone renderers can inject a snapshot; they do not create extra timers.
  return atmosphere ?? resolveHomeSceneAtmosphere(new Date());
}
