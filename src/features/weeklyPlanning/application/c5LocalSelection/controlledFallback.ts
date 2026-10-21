import type { PlanningState, WeeklyPlanningAction, WeeklyPlanningPendingTurn } from '../../types';
import { weeklyPlanningTurnStagingLifecycle } from '../weeklyPlanningTurnSideEffects';
import { readC5RuntimeGraph } from './controlledCommit';
import { serializeC5ApplicationState, serializeC5Value } from './basis';
import { parseWeeklyPlanningStableV5PersistedSession } from '../weeklyPlanningStableV5SessionCodec';

/** Capture before any candidate await. An unreadable persistence basis cannot authorize fallback. */
export function captureControlledCandidateFallback(input: {
  ownerId: string; pending: WeeklyPlanningPendingTurn; snapshot: PlanningState; begun: PlanningState;
  isCurrent(): boolean; getState(): PlanningState; dispatch(action: WeeklyPlanningAction): PlanningState;
}): (() => boolean) | null {
  try {
    if (typeof window === 'undefined') return null;
    const key = `studyplanner.weeklyPlanning.stableV5.${input.ownerId}.${input.pending.weekStartDate}`;
    const checkpointBasis = () => {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return null;
      const decoded = parseWeeklyPlanningStableV5PersistedSession({ raw, ownerId: input.ownerId, weekStartDate: input.pending.weekStartDate });
      if (!decoded || decoded.conversationId !== input.pending.conversationId) throw new Error('Invalid fallback checkpoint scope.');
      // A real rollback dispatch persists the original state again with a new savedAt.
      // Compare the raw envelope, rather than the decoder's compatibility projection:
      // only this persistence timestamp may differ; every other field is retained.
      const { savedAt: _savedAt, ...meaning } = JSON.parse(raw);
      return serializeC5Value(meaning);
    };
    const checkpoint = checkpointBasis();
    const graph = serializeC5Value(readC5RuntimeGraph(input.ownerId, input.pending.conversationId));
    const snapshot = serializeC5ApplicationState(input.snapshot);
    const begun = serializeC5ApplicationState(input.begun);
    const basisUnchanged = () => input.isCurrent()
      && checkpointBasis() === checkpoint
      && serializeC5Value(readC5RuntimeGraph(input.ownerId, input.pending.conversationId)) === graph;
    return () => {
      try {
        if (!basisUnchanged()) return false;
        const current = serializeC5ApplicationState(input.getState());
        if (current !== begun && current !== snapshot) return false;
        weeklyPlanningTurnStagingLifecycle.discard(input.pending);
        // A verified rollback may have removed the begun user turn. Restore it once, without resubmission.
        if (current === snapshot) input.dispatch({ type: 'load_state', state: input.begun });
        return basisUnchanged() && serializeC5ApplicationState(input.getState()) === begun;
      } catch { return false; }
    };
  } catch { return null; }
}
