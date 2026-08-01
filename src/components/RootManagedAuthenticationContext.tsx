import { createContext, useContext, type PropsWithChildren } from 'react';

const RootManagedAuthenticationContext = createContext(false);

export function RootManagedAuthenticationProvider({ children }: PropsWithChildren) {
  return (
    <RootManagedAuthenticationContext.Provider value>
      {children}
    </RootManagedAuthenticationContext.Provider>
  );
}

export function useRootManagedAuthentication(): boolean {
  return useContext(RootManagedAuthenticationContext);
}
