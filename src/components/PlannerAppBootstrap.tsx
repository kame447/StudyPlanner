import { useCallback, useState, type ReactNode } from 'react';
import { usePlannerAppState } from '../hooks/usePlannerAppState';

export type PlannerAppSnapshot = ReturnType<typeof usePlannerAppState>;

// Hydrate planner data while sibling startup work runs. The caller still owns
// the visibility boundary; no interactive/AI surface is mounted by this shell.
export function PlannerAppBootstrap({ children }: {
  children: (state: PlannerAppSnapshot, onReady: () => void) => ReactNode;
}) {
  const [surfaceReady, setSurfaceReady] = useState(false);
  const state = usePlannerAppState({ noticeAutoDismiss: surfaceReady });
  const onReady = useCallback(() => setSurfaceReady(true), []);
  return children(state, onReady);
}
