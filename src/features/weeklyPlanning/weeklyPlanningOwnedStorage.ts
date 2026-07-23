import {
  isWeeklyPlanningStableV5RuntimeEnabled,
} from './application/weeklyPlanningRuntimeMode';
import {
  getWeeklyPlanningStableV5RuntimeSessionForScope,
} from './application/weeklyPlanningStableV5RuntimeSession';
import {
  loadWeeklyPlanningStableV5PersistedSession,
  saveWeeklyPlanningStableV5PersistedSession,
} from './application/weeklyPlanningStableV5SessionStorage';
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

export function loadOwnedWeeklyPlanningState(
  userId: string,
  weekStartDate: string,
): PlanningState {
  if (typeof window === 'undefined') return createInitialPlanningState(weekStartDate);
  if (isWeeklyPlanningStableV5RuntimeEnabled()) {
    return loadWeeklyPlanningStableV5PersistedSession({
      ownerId: userId,
      weekStartDate,
    })?.planningState ?? createInitialPlanningState(weekStartDate);
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

  if (isWeeklyPlanningStableV5RuntimeEnabled()) {
    if (state.pendingTurn || state.pendingApproval) return;
    const runtimeSession = getWeeklyPlanningStableV5RuntimeSessionForScope({
      ownerId: userId,
      weekStartDate: state.weekStartDate,
    });
    if (!runtimeSession) return;
    saveWeeklyPlanningStableV5PersistedSession({
      ownerId: userId,
      weekStartDate: state.weekStartDate,
      conversationId: runtimeSession.conversationId,
      graph: runtimeSession.graph,
      planningState: state,
    });
    return;
  }

  saveLegacyWeeklyPlanningState(userId, state);
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
