import { createContext, useContext, type ReactNode } from 'react';
import { useAppearancePreference } from '../hooks/useAppearancePreference';

const AppearanceContext = createContext<ReturnType<typeof useAppearancePreference> | null>(null);

function AppearanceOwner({ children }: { children: ReactNode }) {
  const preference = useAppearancePreference();
  return <AppearanceContext.Provider value={preference}>{children}</AppearanceContext.Provider>;
}

// Startup can show consent or week-start before App exists. Standalone App is
// also a supported entry. Nested boundaries reuse the root owner and never read
// another preference, request another stylesheet, or create competing state.
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const inherited = useContext(AppearanceContext);
  return inherited ? <>{children}</> : <AppearanceOwner>{children}</AppearanceOwner>;
}

export function useAppAppearance() {
  const preference = useContext(AppearanceContext);
  if (!preference) throw new Error('AppearanceProvider is required.');
  return preference;
}
