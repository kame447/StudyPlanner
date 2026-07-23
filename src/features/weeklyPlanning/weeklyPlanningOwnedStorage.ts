import {
  isWeeklyPlanningStableV5RuntimeEnabled,
} from './application/weeklyPlanningRuntimeMode';
import type { PlanningState } from './types';
import { createInitialPlanningState } from './weeklyPlanningReducer';
import {
  loadWeeklyPlanningState as loadLegacyWeeklyPlanningState,
  saveWeeklyPlanningState as saveLegacyWeeklyPlanningState,
} from './weeklyPlanningStorage';

const OWNED_STORAGE_VERSION = 3;

interface OwnedPlanningStateEnvelope {
  version: 3;
  ownerId: string;
  payload: unknown;
}

function getStorageKey(userId: string, weekStartDate: string): string {
  return `studyplanner.weeklyPlanning.${userId}.${weekStartDate}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isOwnedEnvelope(value: unknown): value is OwnedPlanningStateEnvelope {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 3
    && keys.includes('version')
    && keys.includes('ownerId')
    && keys.includes('payload')
    && value.version === OWNED_STORAGE_VERSION
    && typeof value.ownerId === 'string';
}

function belongsToUser(state: PlanningState, userId: string): boolean {
  return state.draftBlocks.every((block) =>
    block.userId === userId
    && (!block.behaviorMetadata?.previewMetadata
      || block.behaviorMetadata.previewMetadata.authorizedUserId === userId),
  );
}

function decodePayload(
  userId: string,
  weekStartDate: string,
  payload: unknown,
): PlanningState {
  const key = getStorageKey(userId, weekStartDate);
  const previous = window.localStorage.getItem(key);
  try {
    window.localStorage.setItem(key, JSON.stringify(payload));
    return loadLegacyWeeklyPlanningState(userId, weekStartDate);
  } finally {
    if (previous === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, previous);
  }
}

function persistentPlanningState(state: PlanningState): PlanningState {
  if (!isWeeklyPlanningStableV5RuntimeEnabled()) return state;
  // Fact Graph V5 is intentionally session-memory only at this gate. Persisting the
  // conversation without its graph would restore a misleading, unusable session.
  return createInitialPlanningState(state.weekStartDate);
}

export function loadOwnedWeeklyPlanningState(
  userId: string,
  weekStartDate: string,
): PlanningState {
  if (typeof window === 'undefined') return createInitialPlanningState(weekStartDate);
  if (isWeeklyPlanningStableV5RuntimeEnabled()) {
    return createInitialPlanningState(weekStartDate);
  }
  const key = getStorageKey(userId, weekStartDate);

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return createInitialPlanningState(weekStartDate);
    const parsed: unknown = JSON.parse(raw);

    if (isOwnedEnvelope(parsed)) {
      if (parsed.ownerId !== userId) {
        window.localStorage.removeItem(key);
        return createInitialPlanningState(weekStartDate);
      }
      const state = decodePayload(userId, weekStartDate, parsed.payload);
      if (!belongsToUser(state, userId)) {
        window.localStorage.removeItem(key);
        return createInitialPlanningState(weekStartDate);
      }
      return state;
    }

    const legacyState = loadLegacyWeeklyPlanningState(userId, weekStartDate);
    if (!belongsToUser(legacyState, userId)) {
      window.localStorage.removeItem(key);
      return createInitialPlanningState(weekStartDate);
    }
    saveOwnedWeeklyPlanningState(userId, legacyState);
    return legacyState;
  } catch {
    window.localStorage.removeItem(key);
    return createInitialPlanningState(weekStartDate);
  }
}

export function saveOwnedWeeklyPlanningState(
  userId: string,
  state: PlanningState,
): void {
  if (typeof window === 'undefined') return;
  const key = getStorageKey(userId, state.weekStartDate);

  if (!belongsToUser(state, userId)) {
    window.localStorage.removeItem(key);
    return;
  }

  const persistentState = persistentPlanningState(state);
  saveLegacyWeeklyPlanningState(userId, persistentState);
  const payloadRaw = window.localStorage.getItem(key);
  if (!payloadRaw) return;

  try {
    const envelope: OwnedPlanningStateEnvelope = {
      version: OWNED_STORAGE_VERSION,
      ownerId: userId,
      payload: JSON.parse(payloadRaw) as unknown,
    };
    window.localStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    window.localStorage.removeItem(key);
  }
}
