import { createContext, useContext, type PropsWithChildren } from 'react';

const RootStartupReadyContext = createContext<(() => void) | null>(null);

interface RootStartupReadyProviderProps extends PropsWithChildren {
  onReady: () => void;
}

export function RootStartupReadyProvider({
  children,
  onReady,
}: RootStartupReadyProviderProps) {
  return (
    <RootStartupReadyContext.Provider value={onReady}>
      {children}
    </RootStartupReadyContext.Provider>
  );
}

export function useRootStartupReady(): (() => void) | null {
  return useContext(RootStartupReadyContext);
}
