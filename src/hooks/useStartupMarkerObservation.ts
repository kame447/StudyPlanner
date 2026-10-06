import { useMemo } from 'react';
import { plannerRepository } from '../repositories';
import { startupMarkerObservation } from '../lib/startupMarkerObservation';
import type { StartupSessionCapability } from '../lib/startupSessionScope';
import type { AuthSessionService } from '../services/authSession';
import { useStartupObservation } from './useStartupObservation';

const unavailableScope: StartupSessionCapability = {
  isCurrent: () => false,
  onInvalidate: dispose => { dispose(); return () => {}; },
};
const observe = (owner: string, scope: StartupSessionCapability) =>
  plannerRepository.observeStartupScheduleMarker?.(owner, scope) ?? (() => {});

export function useStartupMarkerObservation({ ownerId, scope, authSession, allowed = true }: {
  ownerId: string;
  allowed?: boolean;
  scope?: StartupSessionCapability;
  authSession?: AuthSessionService;
}) {
  const eligibleScope = useMemo<StartupSessionCapability>(() => {
    if (!scope || !authSession) return unavailableScope;
    return {
      isCurrent() {
        if (!scope.isCurrent()) return false;
        try {
          const user = authSession.getCurrentUser();
          return Boolean(user && user.id === ownerId && !user.requiresEmailVerification);
        } catch { return false; }
      },
      onInvalidate: dispose => scope.onInvalidate(dispose),
    };
  }, [authSession, ownerId, scope]);
  // This hook is mounted only inside the post-preferences bootstrap shell.
  // Settlement closes it permanently; later rerenders/recovery cannot reopen it.
  return useStartupObservation({ ownerId, scope: eligibleScope, status: allowed ? 'loading' : 'blocked',
    enabled: startupMarkerObservation === 'observe', observe });
}
