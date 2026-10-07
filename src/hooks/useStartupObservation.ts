import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import type { StartupSessionCapability } from '../lib/startupSessionScope';

type StartupObservationStatus = 'loading' | 'ready' | 'blocked';
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

export function useStartupObservation({ ownerId, scope, status,
  enabled, observe,
}: { ownerId: string; scope: StartupSessionCapability; status: StartupObservationStatus; enabled: boolean; observe?: (ownerId: string, scope: StartupSessionCapability) => () => void }) {
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
    if (status === 'blocked') { closeObservation(lifetime); return; }
    if (!enabled || lifetime.started || lifetime.closed || status !== 'loading' || !scope.isCurrent()) return;
    lifetime.started = true;
    try { lifetime.stop = observe?.(ownerId, scope) ?? null; }
    catch { closeObservation(lifetime); }
  }, [binding, enabled, observe, ownerId, status, scope]);
  return useCallback(() => {
    const lifetime = current.current;
    if (lifetime?.binding === binding) closeObservation(lifetime);
  }, [binding]);
}
