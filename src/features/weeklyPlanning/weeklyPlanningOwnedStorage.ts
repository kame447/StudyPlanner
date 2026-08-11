import {
  getWeeklyPlanningStableV5RuntimeSession,
  getWeeklyPlanningStableV5RuntimeSessionForOwner,
} from './application/weeklyPlanningStableV5RuntimeSession';
import {
  clearWeeklyPlanningStableV5PersistedSession,
  loadWeeklyPlanningStableV5PersistedSession,
  saveWeeklyPlanningStableV5PersistedSession,
} from './application/weeklyPlanningStableV5SessionStorage';
import type { PlanningState } from './types';
import { createInitialPlanningState } from './weeklyPlanningReducer';
import {
  decodeWeeklyPlanningStatePayload,
  loadWeeklyPlanningState as loadLegacyWeeklyPlanningState,
  saveWeeklyPlanningState as saveLegacyWeeklyPlanningState,
} from './weeklyPlanningStorage';

const OWNED_STORAGE_VERSION = 3;
const ACTIVE_SESSION_INDEX_VERSION = 1;

interface OwnedPlanningStateEnvelope {
  version: 3;
  ownerId: string;
  payload: unknown;
}

interface ActiveWeeklyPlanningSessionIndex {
  version: 1;
  ownerId: string;
  weekStartDate: string | null;
  conversationId: string | null;
}

function getStorageKey(userId: string, weekStartDate: string): string {
  return `studyplanner.weeklyPlanning.${userId}.${weekStartDate}`;
}

function getActiveSessionIndexKey(userId: string): string {
  return `studyplanner.weeklyPlanning.activeSession.${userId}`;
}

function getStableV5StoragePrefix(userId: string): string {
  return `studyplanner.weeklyPlanning.stableV5.${userId}.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
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

function isActiveSessionIndex(
  value: unknown,
  userId: string,
): value is ActiveWeeklyPlanningSessionIndex {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 4
    && keys.includes('version')
    && keys.includes('ownerId')
    && keys.includes('weekStartDate')
    && keys.includes('conversationId')
    && value.version === ACTIVE_SESSION_INDEX_VERSION
    && value.ownerId === userId
    && (value.weekStartDate === null || isCalendarDate(value.weekStartDate))
    && (value.conversationId === null
      || (typeof value.conversationId === 'string' && value.conversationId.trim().length > 0));
}

function belongsToUser(state: PlanningState, userId: string): boolean {
  return state.draftBlocks.every((block) =>
    block.userId === userId
    && (!block.behaviorMetadata?.previewMetadata
      || block.behaviorMetadata.previewMetadata.authorizedUserId === userId),
  );
}

function hasActiveConversationState(state: PlanningState): boolean {
  return (state.conversationRequestSequence ?? 0) > 0
    || state.messages.length > 0
    || state.draftBlocks.length > 0
    || (state.previewCandidates?.length ?? 0) > 0
    || Boolean(state.intakeState)
    || Boolean(state.lastAssistantMessage);
}

function removeStorageKey(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage cleanup is best effort. Invalid payloads are still rejected in memory.
  }
}

function localStorageKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key) keys.push(key);
    }
  } catch {
    return [];
  }
  return keys;
}

function readActiveSessionIndex(
  userId: string,
): ActiveWeeklyPlanningSessionIndex | undefined {
  const key = getActiveSessionIndexKey(userId);
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!isActiveSessionIndex(parsed, userId)) {
      removeStorageKey(key);
      return undefined;
    }
    return parsed;
  } catch {
    removeStorageKey(key);
    return undefined;
  }
}

function writeActiveSessionIndex(params: {
  userId: string;
  weekStartDate: string | null;
  conversationId: string | null;
}): void {
  const value: ActiveWeeklyPlanningSessionIndex = {
    version: ACTIVE_SESSION_INDEX_VERSION,
    ownerId: params.userId,
    weekStartDate: params.weekStartDate,
    conversationId: params.conversationId,
  };
  try {
    window.localStorage.setItem(
      getActiveSessionIndexKey(params.userId),
      JSON.stringify(value),
    );
  } catch {
    // The state checkpoint remains authoritative when the small index cannot be written.
  }
}

function loadOwnedCompatibilityState(
  userId: string,
  weekStartDate: string,
  key: string,
): PlanningState {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return createInitialPlanningState(weekStartDate);
    const parsed: unknown = JSON.parse(raw);

    if (isOwnedEnvelope(parsed)) {
      if (parsed.ownerId !== userId) {
        removeStorageKey(key);
        return createInitialPlanningState(weekStartDate);
      }
      const state = decodeWeeklyPlanningStatePayload(parsed.payload, weekStartDate);
      if (!belongsToUser(state, userId)) {
        removeStorageKey(key);
        return createInitialPlanningState(weekStartDate);
      }
      return state;
    }

    const legacyState = loadLegacyWeeklyPlanningState(userId, weekStartDate);
    if (!belongsToUser(legacyState, userId)) {
      removeStorageKey(key);
      return createInitialPlanningState(weekStartDate);
    }
    saveCompatibilityEnvelope(userId, legacyState, key);
    return legacyState;
  } catch {
    removeStorageKey(key);
    return createInitialPlanningState(weekStartDate);
  }
}

function saveCompatibilityEnvelope(
  userId: string,
  state: PlanningState,
  key = getStorageKey(userId, state.weekStartDate),
): void {
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
    removeStorageKey(key);
  }
}

function stableWeekStartsForOwner(userId: string): string[] {
  const prefix = getStableV5StoragePrefix(userId);
  return localStorageKeys()
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length))
    .filter(isCalendarDate);
}

function compatibilityWeekStartsForOwner(userId: string): string[] {
  const prefix = `studyplanner.weeklyPlanning.${userId}.`;
  return localStorageKeys()
    .filter((key) => key.startsWith(prefix) && !key.includes('.stableV5.'))
    .map((key) => key.slice(prefix.length))
    .filter(isCalendarDate);
}

function migrateMostRecentActiveState(userId: string): {
  state: PlanningState;
  conversationId: string | null;
} | null {
  const stableCandidates = stableWeekStartsForOwner(userId)
    .map((weekStartDate) => loadWeeklyPlanningStableV5PersistedSession({
      ownerId: userId,
      weekStartDate,
    }))
    .filter((session): session is NonNullable<typeof session> => Boolean(session))
    .map((session) => ({
      state: session.planningState,
      conversationId: session.conversationId,
      timestamp: Date.parse(session.savedAt),
    }));

  const compatibilityCandidates = compatibilityWeekStartsForOwner(userId)
    .map((weekStartDate) => loadOwnedCompatibilityState(
      userId,
      weekStartDate,
      getStorageKey(userId, weekStartDate),
    ))
    .filter(hasActiveConversationState)
    .map((state) => ({
      state,
      conversationId: null,
      timestamp: Date.parse(state.updatedAt),
    }));

  const latest = [...stableCandidates, ...compatibilityCandidates]
    .filter((candidate) => Number.isFinite(candidate.timestamp))
    .sort((left, right) => right.timestamp - left.timestamp)[0];
  return latest
    ? { state: latest.state, conversationId: latest.conversationId }
    : null;
}

function conversationIdFromState(state: PlanningState): string | null {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const messageId = state.messages[index].id;
    const turnMarker = ':turn:';
    const markerIndex = messageId.indexOf(turnMarker);
    if (markerIndex > 0) return messageId.slice(0, markerIndex);
  }
  for (const block of state.draftBlocks) {
    const conversationId = block.behaviorMetadata?.conversationId?.trim()
      || block.behaviorMetadata?.previewMetadata?.conversationId?.trim();
    if (conversationId) return conversationId;
  }
  return null;
}

function runtimeSessionForState(userId: string, state: PlanningState) {
  const conversationId = conversationIdFromState(state);
  if (conversationId) {
    const exact = getWeeklyPlanningStableV5RuntimeSession(conversationId);
    if (exact?.ownerId === userId) return exact;
  }
  return getWeeklyPlanningStableV5RuntimeSessionForOwner(userId);
}

function clearPreviousCheckpointIfMoved(params: {
  userId: string;
  previous: ActiveWeeklyPlanningSessionIndex | undefined;
  nextWeekStartDate: string;
  conversationId: string | null;
}): void {
  const previousWeek = params.previous?.weekStartDate;
  if (!previousWeek || previousWeek === params.nextWeekStartDate) return;
  if (
    params.previous?.conversationId
    && params.conversationId
    && params.previous.conversationId !== params.conversationId
  ) {
    return;
  }
  clearWeeklyPlanningStableV5PersistedSession({
    ownerId: params.userId,
    weekStartDate: previousWeek,
  });
  removeStorageKey(getStorageKey(params.userId, previousWeek));
}

function activateRecoveredState(
  userId: string,
  recovered: {
    state: PlanningState;
    conversationId: string | null;
  },
): PlanningState {
  writeActiveSessionIndex({
    userId,
    weekStartDate: recovered.state.weekStartDate,
    conversationId: recovered.conversationId,
  });
  return recovered.state;
}

export function loadOwnedWeeklyPlanningState(
  userId: string,
  weekStartDate: string,
): PlanningState {
  if (typeof window === 'undefined') return createInitialPlanningState(weekStartDate);

  const active = readActiveSessionIndex(userId);
  if (active) {
    if (active.weekStartDate === null) return createInitialPlanningState(weekStartDate);
    const persisted = loadWeeklyPlanningStableV5PersistedSession({
      ownerId: userId,
      weekStartDate: active.weekStartDate,
    });
    if (persisted && (!active.conversationId || active.conversationId === persisted.conversationId)) {
      return persisted.planningState;
    }
    const compatibility = loadOwnedCompatibilityState(
      userId,
      active.weekStartDate,
      getStorageKey(userId, active.weekStartDate),
    );
    if (hasActiveConversationState(compatibility) && active.conversationId === null) {
      return compatibility;
    }

    const recovered = migrateMostRecentActiveState(userId);
    if (recovered) return activateRecoveredState(userId, recovered);

    writeActiveSessionIndex({
      userId,
      weekStartDate: null,
      conversationId: null,
    });
    return createInitialPlanningState(weekStartDate);
  }

  const migrated = migrateMostRecentActiveState(userId);
  if (migrated) return activateRecoveredState(userId, migrated);

  writeActiveSessionIndex({ userId, weekStartDate: null, conversationId: null });
  return createInitialPlanningState(weekStartDate);
}

export function saveOwnedWeeklyPlanningState(
  userId: string,
  state: PlanningState,
): void {
  if (typeof window === 'undefined') return;
  const key = getStorageKey(userId, state.weekStartDate);
  const active = readActiveSessionIndex(userId);

  if (!belongsToUser(state, userId)) {
    removeStorageKey(key);
    clearWeeklyPlanningStableV5PersistedSession({
      ownerId: userId,
      weekStartDate: state.weekStartDate,
    });
    if (active?.weekStartDate === state.weekStartDate) {
      writeActiveSessionIndex({ userId, weekStartDate: null, conversationId: null });
    }
    return;
  }

  if (state.pendingTurn || state.pendingApproval) return;

  if (!hasActiveConversationState(state)) {
    removeStorageKey(key);
    clearWeeklyPlanningStableV5PersistedSession({
      ownerId: userId,
      weekStartDate: state.weekStartDate,
    });
    writeActiveSessionIndex({ userId, weekStartDate: null, conversationId: null });
    return;
  }

  const runtimeSession = runtimeSessionForState(userId, state);
  if (runtimeSession) {
    const saved = saveWeeklyPlanningStableV5PersistedSession({
      ownerId: userId,
      weekStartDate: state.weekStartDate,
      conversationId: runtimeSession.conversationId,
      graph: runtimeSession.graph,
      planningState: state,
    });
    if (saved) {
      removeStorageKey(key);
      clearPreviousCheckpointIfMoved({
        userId,
        previous: active,
        nextWeekStartDate: state.weekStartDate,
        conversationId: runtimeSession.conversationId,
      });
      writeActiveSessionIndex({
        userId,
        weekStartDate: state.weekStartDate,
        conversationId: runtimeSession.conversationId,
      });
      return;
    }
    clearWeeklyPlanningStableV5PersistedSession({
      ownerId: userId,
      weekStartDate: state.weekStartDate,
    });
  }

  saveCompatibilityEnvelope(userId, state, key);
  clearPreviousCheckpointIfMoved({
    userId,
    previous: active,
    nextWeekStartDate: state.weekStartDate,
    conversationId: null,
  });
  writeActiveSessionIndex({
    userId,
    weekStartDate: state.weekStartDate,
    conversationId: null,
  });
}
