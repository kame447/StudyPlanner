import type { PlanningState } from '../types';
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import {
  largestWeeklyPlanningStableV5Checkpoint,
  parseWeeklyPlanningStableV5PersistedSession,
  prepareWeeklyPlanningStableV5Checkpoint,
  serializeWeeklyPlanningStableV5CheckpointWithMessageCount,
} from './weeklyPlanningStableV5SessionCodec';

export {
  WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION,
} from './weeklyPlanningStableV5SessionCodec';
export type {
  WeeklyPlanningStableV5PersistedSession,
} from './weeklyPlanningStableV5SessionCodec';

function storageKey(ownerId: string, weekStartDate: string): string {
  return `studyplanner.weeklyPlanning.stableV5.${ownerId}.${weekStartDate}`;
}

function writeCheckpointWithQuotaFallback(params: {
  key: string;
  ownerId: string;
  weekStartDate: string;
  conversationId: string;
  graph: WeeklyPlanningFactGraphV5;
  planningState: PlanningState;
  savedAt: string;
}): boolean {
  const initial = largestWeeklyPlanningStableV5Checkpoint(params);
  if (!initial) return false;

  let messageCount = initial.messageCount;
  let raw = initial.raw;
  while (true) {
    try {
      window.localStorage.setItem(params.key, raw);
      return true;
    } catch {
      if (messageCount === 0) return false;
      messageCount = Math.floor(messageCount / 2);
      const nextRaw = serializeWeeklyPlanningStableV5CheckpointWithMessageCount({
        ...params,
        messageCount,
      });
      if (!nextRaw) return false;
      raw = nextRaw;
    }
  }
}

export function loadWeeklyPlanningStableV5PersistedSession(params: {
  ownerId: string;
  weekStartDate: string;
}): import('./weeklyPlanningStableV5SessionCodec').WeeklyPlanningStableV5PersistedSession | null {
  if (typeof window === 'undefined') return null;
  const key = storageKey(params.ownerId, params.weekStartDate);
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const persisted = parseWeeklyPlanningStableV5PersistedSession({
      raw,
      ownerId: params.ownerId,
      weekStartDate: params.weekStartDate,
    });
    if (!persisted) {
      window.localStorage.removeItem(key);
      return null;
    }
    return persisted;
  } catch {
    window.localStorage.removeItem(key);
    return null;
  }
}

export function saveWeeklyPlanningStableV5PersistedSession(params: {
  ownerId: string;
  weekStartDate: string;
  conversationId: string;
  graph: WeeklyPlanningFactGraphV5;
  planningState: PlanningState;
}): boolean {
  if (typeof window === 'undefined') return false;
  const key = storageKey(params.ownerId, params.weekStartDate);
  const preparation = prepareWeeklyPlanningStableV5Checkpoint(params);
  if (preparation.status === 'invalid') return false;
  if (preparation.status === 'empty') {
    window.localStorage.removeItem(key);
    return true;
  }

  return writeCheckpointWithQuotaFallback({
    key,
    ownerId: params.ownerId,
    weekStartDate: params.weekStartDate,
    conversationId: params.conversationId,
    graph: params.graph,
    planningState: preparation.planningState,
    savedAt: new Date().toISOString(),
  });
}

export function clearWeeklyPlanningStableV5PersistedSession(params: {
  ownerId: string;
  weekStartDate: string;
}): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKey(params.ownerId, params.weekStartDate));
  } catch {
    // localStorage is best effort; the in-memory session is cleared independently.
  }
}

export function getWeeklyPlanningStableV5SessionStorageKeyForTest(
  ownerId: string,
  weekStartDate: string,
): string {
  return storageKey(ownerId, weekStartDate);
}
