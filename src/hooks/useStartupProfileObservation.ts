import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { authRepository } from '../repositories';
import { startupProfileObservation } from '../lib/startupProfileObservation';
import type { StartupSessionCapability } from '../lib/startupSessionScope';

type PreferenceStatus = 'loading' | 'ready' | 'blocked';
interface ObservationLifetime {
  binding: object;
  started: boolean;
  closed: boolean;
  stop: (() => void) | null;
}
function closeObservation(lifetime: ObservationLifetime) {
  if (lifetime.closed) return;
  lifetime.closed = true;
  try { lifetime.stop?.(); } catch { /* Optional observation cannot block normal startup. */ }
}

export function useStartupProfileObservation({ ownerId, scope, preferenceStatus,
  enabled = startupProfileObservation === 'observe',
}: { ownerId: string; scope: StartupSessionCapability; preferenceStatus: PreferenceStatus; enabled?: boolean }) {
  const binding = useMemo(() => ({}), [ownerId, scope]);
  const current = useRef<ObservationLifetime | null>(null);
  useLayoutEffect(() => {
    const lifetime: ObservationLifetime = { binding, started: false, closed: false, stop: null };
    current.current = lifetime;
    return () => {
      closeObservation(lifetime);
      if (current.current === lifetime) current.current = null;
    };
  }, [binding]);
  useLayoutEffect(() => {
    const lifetime = current.current;
    if (!lifetime || lifetime.binding !== binding) return;
    if (preferenceStatus === 'blocked') { closeObservation(lifetime); return; }
    if (!enabled || lifetime.started || lifetime.closed || preferenceStatus !== 'loading' || !scope.isCurrent()) return;
    lifetime.started = true;
    try { lifetime.stop = authRepository.observeStartupProfile?.(ownerId, scope) ?? null; }
    catch { closeObservation(lifetime); }
  }, [binding, enabled, ownerId, preferenceStatus, scope]);
  return useCallback(() => {
    const lifetime = current.current;
    if (lifetime?.binding === binding) closeObservation(lifetime);
  }, [binding]);
}
