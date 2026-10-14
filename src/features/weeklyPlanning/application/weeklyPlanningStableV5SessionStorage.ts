import type { PlanningState } from '../types';
import {
  clearWeeklyPlanningStorageSnapshot,
  hasActiveConversationState,
  prepareWeeklyPlanningStorageMutation,
  type WeeklyPlanningStorageSnapshot,
} from '../weeklyPlanningStorageRetention';
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

export function getWeeklyPlanningStableV5StorageSnapshot(ownerId: string, weekStartDate: string): WeeklyPlanningStorageSnapshot {
  return {
    ownerId, weekStartDate, kind: 'stable_v5', key: storageKey(ownerId, weekStartDate),
    read: raw => {
      const session = parseWeeklyPlanningStableV5PersistedSession({ raw, ownerId, weekStartDate });
      if (!session) return null;
      const state = session.planningState;
      return {
        conversationId: session.conversationId, savedAt: session.savedAt,
        active: session.graph.revision > 0 || hasActiveConversationState(state),
      };
    },
  };
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

export type WeeklyPlanningStableV5SessionRead =
  | { status: 'ready'; session: import('./weeklyPlanningStableV5SessionCodec').WeeklyPlanningStableV5PersistedSession | null }
  | { status: 'unavailable' };

export function readWeeklyPlanningStableV5PersistedSession(params: {
  ownerId: string;
  weekStartDate: string;
}): WeeklyPlanningStableV5SessionRead {
  if (typeof window === 'undefined') return { status: 'ready', session: null };
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(storageKey(params.ownerId, params.weekStartDate));
  } catch {
    return { status: 'unavailable' };
  }
  if (raw === null) return { status: 'ready', session: null };
  const persisted = parseWeeklyPlanningStableV5PersistedSession({ raw, ...params });
  if (!persisted) prepareWeeklyPlanningStorageMutation(getWeeklyPlanningStableV5StorageSnapshot(params.ownerId, params.weekStartDate));
  return { status: 'ready', session: persisted };
}

export function loadWeeklyPlanningStableV5PersistedSession(params: {
  ownerId: string;
  weekStartDate: string;
}): import('./weeklyPlanningStableV5SessionCodec').WeeklyPlanningStableV5PersistedSession | null {
  const read = readWeeklyPlanningStableV5PersistedSession(params);
  return read.status === 'ready' ? read.session : null;
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
  if (!prepareWeeklyPlanningStorageMutation(getWeeklyPlanningStableV5StorageSnapshot(params.ownerId, params.weekStartDate))) return false;
  if (preparation.status === 'empty') {
    return clearWeeklyPlanningStorageSnapshot(getWeeklyPlanningStableV5StorageSnapshot(params.ownerId, params.weekStartDate));
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
}): boolean {
  return clearWeeklyPlanningStorageSnapshot(getWeeklyPlanningStableV5StorageSnapshot(params.ownerId, params.weekStartDate));
}

export function getWeeklyPlanningStableV5SessionStorageKeyForTest(
  ownerId: string,
  weekStartDate: string,
): string {
  return storageKey(ownerId, weekStartDate);
}
