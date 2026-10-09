import { useStartupMarkerObservation } from '../hooks/useStartupMarkerObservation';
import type { StartupSessionCapability } from '../lib/startupSessionScope';
import type { AuthSessionService } from '../services/authSession';
import { useCallback, useState, type ReactNode } from 'react';
import { usePlannerAppState } from '../hooks/usePlannerAppState';

export type PlannerAppSnapshot = ReturnType<typeof usePlannerAppState>;

// Hydrate planner data while sibling startup work runs. The caller still owns
// the visibility boundary; no interactive/AI surface is mounted by this shell.
export function PlannerAppBootstrap({ ownerId, children, startupScope, authSession, startupObservationAllowed = true }: {
  ownerId: string;
  startupScope?: StartupSessionCapability;
  startupObservationAllowed?: boolean;
  authSession?: AuthSessionService;
  children: (state: PlannerAppSnapshot, onReady: () => void) => ReactNode;
}) {
  const [surfaceReady, setSurfaceReady] = useState(false);
  const onBootstrapSettled = useStartupMarkerObservation({ ownerId, scope: startupScope, authSession, allowed: startupObservationAllowed });
  const state = usePlannerAppState({ noticeAutoDismiss: surfaceReady, expectedUserId: ownerId, onBootstrapSettled });
  const onReady = useCallback(() => setSurfaceReady(true), []);
  return children(state, onReady);
}
