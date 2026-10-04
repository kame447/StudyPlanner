import { largestWeeklyPlanningStableV5Checkpoint, parseWeeklyPlanningStableV5PersistedSession, prepareWeeklyPlanningStableV5Checkpoint, serializeWeeklyPlanningStableV5CheckpointWithMessageCount } from '../weeklyPlanningStableV5SessionCodec';
import type { PlanningState } from '../../types';
import type { WeeklyPlanningFactGraphV5 } from '../../semantic/weeklyPlanningFactGraphV5';

export interface C5CheckpointWrite {
  status: 'committed' | 'failed' | 'unknown';
  /** Recovery checks the exact attempted bytes, including consumption; never retries the mutation. */
  recover(): 'committed' | 'failed' | 'unknown';
}

/** One synchronous graph+state+ledger envelope. Quota reduction only removes messages. */
export function writeC5Checkpoint(params: {
  ownerId: string; conversationId: string; graph: WeeklyPlanningFactGraphV5; planningState: PlanningState;
}): C5CheckpointWrite {
  const fixed = { ...params, weekStartDate: params.planningState.weekStartDate, savedAt: new Date().toISOString() };
  const key = `studyplanner.weeklyPlanning.stableV5.${params.ownerId}.${fixed.weekStartDate}`;
  const failed: C5CheckpointWrite = { status: 'failed', recover: () => 'failed' };
  if (typeof window === 'undefined') return failed;
  const preparation = prepareWeeklyPlanningStableV5Checkpoint(fixed);
  if (preparation.status !== 'ready') return failed;
  const initial = largestWeeklyPlanningStableV5Checkpoint({ ...fixed, planningState: preparation.planningState });
  if (!initial) return failed;
  let previous: string | null;
  try { previous = window.localStorage.getItem(key); }
  catch { return failed; } // No write attempted.
  const attempted = new Set<string>();
  const recover = (): C5CheckpointWrite['status'] => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null && attempted.has(raw)
        && parseWeeklyPlanningStableV5PersistedSession({ raw, ownerId: params.ownerId, weekStartDate: fixed.weekStartDate })) return 'committed';
      return raw === previous ? 'failed' : 'unknown';
    } catch { return 'unknown'; }
  };
  let count = initial.messageCount;
  let raw = initial.raw;
  while (true) {
    attempted.add(raw);
    try {
      window.localStorage.setItem(key, raw);
      const status = recover();
      return { status, recover };
    } catch {
      // Commit-then-throw and unreadable outcomes are not rollback evidence.
      const status = recover();
      if (status !== 'failed') return { status, recover };
      if (count === 0) return { status: 'failed', recover };
      count = Math.floor(count / 2);
      const reduced = serializeWeeklyPlanningStableV5CheckpointWithMessageCount({ ...fixed, planningState: preparation.planningState, messageCount: count });
      if (!reduced) return { status: 'failed', recover };
      raw = reduced;
    }
  }
}
