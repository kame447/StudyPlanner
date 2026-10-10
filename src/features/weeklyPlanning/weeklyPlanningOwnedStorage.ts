import {
  getWeeklyPlanningStableV5RuntimeSession,
  getWeeklyPlanningStableV5RuntimeSessionForOwner,
} from './application/weeklyPlanningStableV5RuntimeSession';
import {
  clearWeeklyPlanningStableV5PersistedSession,
  getWeeklyPlanningStableV5StorageSnapshot,
  loadWeeklyPlanningStableV5PersistedSession,
  readWeeklyPlanningStableV5PersistedSession,
  saveWeeklyPlanningStableV5PersistedSession,
  type WeeklyPlanningStableV5PersistedSession,
} from './application/weeklyPlanningStableV5SessionStorage';
import type { PlanningState } from './types';
import { createInitialPlanningState } from './weeklyPlanningReducer';
import {
  getWeeklyPlanningCompatibilityStorageSnapshot,
  parseWeeklyPlanningCompatibilitySnapshot,
  saveWeeklyPlanningState as saveLegacyWeeklyPlanningState,
} from './weeklyPlanningStorage';
import {
  clearWeeklyPlanningStorageSnapshot,
  conversationIdFromState,
  hasActiveConversationState,
  inspectWeeklyPlanningStorageRecovery,
  prepareWeeklyPlanningStorageMutation,
  recoverQuarantinedWeeklyPlanningStorage,
  retainedWeeklyPlanningWeekStarts,
  type WeeklyPlanningStorageRecoverySignal,
} from './weeklyPlanningStorageRetention';

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
  return (!state.approvalRecovery || state.approvalRecovery.operation.userId === userId)
    && state.draftBlocks.every((block) =>
    block.userId === userId
    && (!block.behaviorMetadata?.previewMetadata
      || block.behaviorMetadata.previewMetadata.authorizedUserId === userId),
  );
}

function removeInvalidSessionIndex(userId: string): void {
  // Disposable navigation metadata; opaque conversation checkpoints use retention instead.
  try {
    window.localStorage.removeItem(getActiveSessionIndexKey(userId));
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

type ActiveSessionIndexRead =
  | { status: 'available'; index: ActiveWeeklyPlanningSessionIndex | undefined }
  | { status: 'unavailable' };

function readActiveSessionIndex(userId: string): ActiveSessionIndexRead {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(getActiveSessionIndexKey(userId));
  } catch {
    // An unread selection may still be valid; do not remove it or infer absence.
    return { status: 'unavailable' };
  }
  if (!raw) return { status: 'available', index: undefined };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isActiveSessionIndex(parsed, userId)) return { status: 'available', index: parsed };
  } catch {
    // Observably invalid metadata remains disposable under the existing policy.
  }
  removeInvalidSessionIndex(userId);
  return { status: 'available', index: undefined };
}

/** Permit hydration only for a missing index or a validated selected session. */
export function canRestoreOwnedWeeklyPlanningSession(userId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(getActiveSessionIndexKey(userId));
    if (raw === null) return true;
    const parsed: unknown = JSON.parse(raw);
    return isActiveSessionIndex(parsed, userId) && parsed.weekStartDate !== null;
  } catch { return false; }
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

function clearCompatibilityCheckpoint(userId: string, weekStartDate: string): boolean {
  return clearWeeklyPlanningStorageSnapshot(getWeeklyPlanningCompatibilityStorageSnapshot(userId, weekStartDate));
}

function readOwnedCompatibilityState(userId: string, weekStartDate: string, key: string):
  { status: 'ready'; state: PlanningState } | { status: 'unavailable' } {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return { status: 'unavailable' };
  }
  if (raw === null) return { status: 'ready', state: createInitialPlanningState(weekStartDate) };
  const state = parseWeeklyPlanningCompatibilitySnapshot(raw, userId, weekStartDate);
  if (!state) {
    prepareWeeklyPlanningStorageMutation(getWeeklyPlanningCompatibilityStorageSnapshot(userId, weekStartDate));
    return { status: 'ready', state: createInitialPlanningState(weekStartDate) };
  }
  if ((JSON.parse(raw) as Record<string, unknown>).version !== OWNED_STORAGE_VERSION) saveCompatibilityEnvelope(userId, state, key);
  return { status: 'ready', state };
}

function loadOwnedCompatibilityState(userId: string, weekStartDate: string, key: string): PlanningState {
  const read = readOwnedCompatibilityState(userId, weekStartDate, key);
  return read.status === 'ready' ? read.state : createInitialPlanningState(weekStartDate);
}

function saveCompatibilityEnvelope(userId: string, state: PlanningState, key = getStorageKey(userId, state.weekStartDate)): boolean {
  if (!saveLegacyWeeklyPlanningState(userId, state)) return false;
  try {
    const payloadRaw = window.localStorage.getItem(key);
    if (payloadRaw === null) return true;
    if (!parseWeeklyPlanningCompatibilitySnapshot(payloadRaw, userId, state.weekStartDate)) {
      prepareWeeklyPlanningStorageMutation(getWeeklyPlanningCompatibilityStorageSnapshot(userId, state.weekStartDate));
      return false;
    }
    const envelope: OwnedPlanningStateEnvelope = {
      version: OWNED_STORAGE_VERSION, ownerId: userId, payload: JSON.parse(payloadRaw) as unknown,
    };
    window.localStorage.setItem(key, JSON.stringify(envelope));
    return true;
  } catch {
    // The readable v2 checkpoint is still a valid recovery source if wrapping fails.
    return false;
  }
}

function recoverySnapshots(userId: string, weekStartDate: string) {
  return [getWeeklyPlanningStableV5StorageSnapshot(userId, weekStartDate), getWeeklyPlanningCompatibilityStorageSnapshot(userId, weekStartDate)];
}

export function getWeeklyPlanningStorageRecoverySignal(userId: string, weekStartDate: string): WeeklyPlanningStorageRecoverySignal {
  return inspectWeeklyPlanningStorageRecovery({ ownerId: userId, weekStartDate, snapshots: recoverySnapshots(userId, weekStartDate) });
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
  persistedSession: WeeklyPlanningStableV5PersistedSession | null;
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
      persistedSession: session,
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
      persistedSession: null,
      timestamp: Date.parse(state.updatedAt),
    }));

  const latest = [...stableCandidates, ...compatibilityCandidates]
    .filter((candidate) => Number.isFinite(candidate.timestamp))
    .sort((left, right) => right.timestamp - left.timestamp)[0];
  return latest
    ? { state: latest.state, conversationId: latest.conversationId, persistedSession: latest.persistedSession }
    : null;
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
  clearCompatibilityCheckpoint(params.userId, previousWeek);
}

function activateRecoveredState(
  userId: string,
  recovered: {
    state: PlanningState;
    conversationId: string | null;
    persistedSession: WeeklyPlanningStableV5PersistedSession | null;
  },
): Extract<OwnedWeeklyPlanningStateRead, { status: 'ready' }> {
  writeActiveSessionIndex({
    userId,
    weekStartDate: recovered.state.weekStartDate,
    conversationId: recovered.conversationId,
  });
  return { status: 'ready', state: recovered.state, persistedSession: recovered.persistedSession };
}

interface ReadyOwnedWeeklyPlanningState {
  state: PlanningState;
  persistedSession: WeeklyPlanningStableV5PersistedSession | null;
}

export type OwnedWeeklyPlanningStateRead =
  | ({ status: 'ready' } & ReadyOwnedWeeklyPlanningState)
  | { status: 'unavailable' };

export function readOwnedWeeklyPlanningState(userId: string, weekStartDate: string): OwnedWeeklyPlanningStateRead {
  if (typeof window === 'undefined') return { status: 'ready', state: createInitialPlanningState(weekStartDate), persistedSession: null };
  const selection = readActiveSessionIndex(userId);
  if (selection.status === 'unavailable') return { status: 'unavailable' };
  return loadSelectedWeeklyPlanningState(userId, weekStartDate, selection.index);
}

/** Compatibility reader; application hydration uses the typed read result. */
export function loadOwnedWeeklyPlanningState(userId: string, weekStartDate: string): PlanningState {
  const read = readOwnedWeeklyPlanningState(userId, weekStartDate);
  return read.status === 'ready' ? read.state : createInitialPlanningState(weekStartDate);
}

function loadSelectedWeeklyPlanningState(
  userId: string,
  weekStartDate: string,
  active: ActiveWeeklyPlanningSessionIndex | undefined,
): OwnedWeeklyPlanningStateRead {
  // A deliberately empty session must not be revived from opaque recovery data.
  // Older automatic clears share this index shape, so retain their data without
  // guessing that recovery is authorized or moving the retained bytes.
  if (active?.weekStartDate === null) return { status: 'ready', state: createInitialPlanningState(weekStartDate), persistedSession: null };
  const weeks = new Set([weekStartDate, ...retainedWeeklyPlanningWeekStarts(userId)]);
  if (active?.weekStartDate) weeks.add(active.weekStartDate);
  for (const week of weeks) {
    recoverQuarantinedWeeklyPlanningStorage({ ownerId: userId, weekStartDate: week, snapshots: recoverySnapshots(userId, week) });
  }
  if (active) {
    const stableRead = readWeeklyPlanningStableV5PersistedSession({
      ownerId: userId,
      weekStartDate: active.weekStartDate,
    });
    if (stableRead.status === 'unavailable') return stableRead;
    const persisted = stableRead.session;
    if (persisted && (!active.conversationId || active.conversationId === persisted.conversationId)) {
      return { status: 'ready', state: persisted.planningState, persistedSession: persisted };
    }
    const compatibilityRead = readOwnedCompatibilityState(
      userId,
      active.weekStartDate,
      getStorageKey(userId, active.weekStartDate),
    );
    if (compatibilityRead.status === 'unavailable') return compatibilityRead;
    const compatibility = compatibilityRead.state;
    if (hasActiveConversationState(compatibility) && active.conversationId === null) {
      return { status: 'ready', state: compatibility, persistedSession: null };
    }

    const recovered = migrateMostRecentActiveState(userId);
    if (recovered) return activateRecoveredState(userId, recovered);

    if (recoverySnapshots(userId, active.weekStartDate).every(prepareWeeklyPlanningStorageMutation)) {
      writeActiveSessionIndex({ userId, weekStartDate: null, conversationId: null });
    }
    return { status: 'ready', state: createInitialPlanningState(weekStartDate), persistedSession: null };
  }

  const migrated = migrateMostRecentActiveState(userId);
  if (migrated) return activateRecoveredState(userId, migrated);

  writeActiveSessionIndex({ userId, weekStartDate: null, conversationId: null });
  return { status: 'ready', state: createInitialPlanningState(weekStartDate), persistedSession: null };
}

export function saveOwnedWeeklyPlanningState(
  userId: string,
  state: PlanningState,
): void {
  if (typeof window === 'undefined') return;
  const key = getStorageKey(userId, state.weekStartDate);
  const selection = readActiveSessionIndex(userId);
  if (selection.status === 'unavailable') return;
  const active = selection.index;

  // Invalid incoming ownership never authorizes erasing an existing conversation.
  if (!belongsToUser(state, userId)) return;

  if (state.pendingTurn || state.pendingApproval) return;

  if (!hasActiveConversationState(state)) {
    clearCompatibilityCheckpoint(userId, state.weekStartDate);
    clearWeeklyPlanningStableV5PersistedSession({ ownerId: userId, weekStartDate: state.weekStartDate });
    // Selection is independent of cleanup: opaque bytes stay protected, while
    // the authoritative empty state must not revive them on a later load.
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
      clearCompatibilityCheckpoint(userId, state.weekStartDate);
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
    if (!clearWeeklyPlanningStableV5PersistedSession({ ownerId: userId, weekStartDate: state.weekStartDate })) return;
  }

  if (!prepareWeeklyPlanningStorageMutation(getWeeklyPlanningStableV5StorageSnapshot(userId, state.weekStartDate))) return;
  if (!saveCompatibilityEnvelope(userId, state, key)) return;
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
