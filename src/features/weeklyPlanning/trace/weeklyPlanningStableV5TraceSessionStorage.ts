import {
  WEEKLY_PLANNING_TRACE_SCHEMA_VERSION,
  type WeeklyPlanningTraceSession,
} from './weeklyPlanningTraceTypes';

export const WEEKLY_PLANNING_STABLE_V5_TRACE_CURSOR_VERSION =
  'studyplanner-weekly-planning-stable-v5-trace-cursor-v1' as const;

const STORAGE_KEY_PREFIX = 'studyplanner.weeklyPlanning.trace.stableV5.';
const MAX_CURSOR_BYTES = 64 * 1024;
const MAX_PERSISTED_CURSORS = 24;
const MAX_REQUEST_IDS = 128;
const CURSOR_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

const SESSION_KEYS = [
  'id',
  'logicalConversationId',
  'userId',
  'status',
  'startedAt',
  'lastActivityAt',
  'endedAt',
  'archivedAt',
  'planningRangeStart',
  'planningRangeEnd',
  'turnCount',
  'entryCount',
  'hasPreview',
  'hasApprovalFailure',
  'hasFallback',
  'hasError',
  'appVersion',
  'schemaVersion',
  'expireAt',
] as const;

const CURSOR_KEYS = [
  'version',
  'userId',
  'conversationId',
  'session',
  'nextSequence',
  'nextTurnIndex',
  'lastActivityMs',
  'requestIds',
  'savedAt',
] as const;

export interface WeeklyPlanningStableV5TraceCursor {
  version: typeof WEEKLY_PLANNING_STABLE_V5_TRACE_CURSOR_VERSION;
  userId: string;
  conversationId: string;
  session: WeeklyPlanningTraceSession;
  nextSequence: number;
  nextTurnIndex: number;
  lastActivityMs: number;
  requestIds: string[];
  savedAt: string;
}

function storageKey(userId: string, conversationId: string): string {
  return `${STORAGE_KEY_PREFIX}${encodeURIComponent(userId)}::${encodeURIComponent(conversationId)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isNonEmptyString(value: unknown, maxLength = 512): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= maxLength;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isSessionStatus(value: unknown): value is WeeklyPlanningTraceSession['status'] {
  return value === 'active'
    || value === 'completed'
    || value === 'abandoned'
    || value === 'failed';
}

function parseSession(
  value: unknown,
  userId: string,
  conversationId: string,
): WeeklyPlanningTraceSession | null {
  if (!isRecord(value)
    || !hasOnlyKeys(value, SESSION_KEYS)
    || !isNonEmptyString(value.id)
    || value.userId !== userId
    || value.logicalConversationId !== conversationId
    || !isSessionStatus(value.status)
    || !isTimestamp(value.startedAt)
    || !isTimestamp(value.lastActivityAt)
    || (value.endedAt !== undefined && !isTimestamp(value.endedAt))
    || (value.archivedAt !== undefined && !isTimestamp(value.archivedAt))
    || (value.planningRangeStart !== undefined && !isNonEmptyString(value.planningRangeStart))
    || (value.planningRangeEnd !== undefined && !isNonEmptyString(value.planningRangeEnd))
    || !isNonNegativeInteger(value.turnCount)
    || !isNonNegativeInteger(value.entryCount)
    || typeof value.hasPreview !== 'boolean'
    || typeof value.hasApprovalFailure !== 'boolean'
    || typeof value.hasFallback !== 'boolean'
    || typeof value.hasError !== 'boolean'
    || !isNonEmptyString(value.appVersion)
    || value.schemaVersion !== WEEKLY_PLANNING_TRACE_SCHEMA_VERSION
    || !isTimestamp(value.expireAt)) {
    return null;
  }

  const startedAtMs = Date.parse(value.startedAt);
  const lastActivityAtMs = Date.parse(value.lastActivityAt);
  const endedAtMs = value.endedAt === undefined ? null : Date.parse(value.endedAt);
  const archivedAtMs = value.archivedAt === undefined ? null : Date.parse(value.archivedAt);
  const expireAtMs = Date.parse(value.expireAt);
  if (lastActivityAtMs < startedAtMs
    || (endedAtMs !== null && endedAtMs < lastActivityAtMs)
    || (archivedAtMs !== null && archivedAtMs < startedAtMs)
    || expireAtMs < lastActivityAtMs) {
    return null;
  }

  return {
    id: value.id,
    logicalConversationId: conversationId,
    userId,
    status: value.status,
    startedAt: value.startedAt,
    lastActivityAt: value.lastActivityAt,
    ...(value.endedAt ? { endedAt: value.endedAt } : {}),
    ...(value.archivedAt ? { archivedAt: value.archivedAt } : {}),
    ...(value.planningRangeStart ? { planningRangeStart: value.planningRangeStart } : {}),
    ...(value.planningRangeEnd ? { planningRangeEnd: value.planningRangeEnd } : {}),
    turnCount: value.turnCount,
    entryCount: value.entryCount,
    hasPreview: value.hasPreview,
    hasApprovalFailure: value.hasApprovalFailure,
    hasFallback: value.hasFallback,
    hasError: value.hasError,
    appVersion: value.appVersion,
    schemaVersion: WEEKLY_PLANNING_TRACE_SCHEMA_VERSION,
    expireAt: value.expireAt,
  };
}

function parseCursor(
  value: unknown,
  userId: string,
  conversationId: string,
): WeeklyPlanningStableV5TraceCursor | null {
  if (!isRecord(value)
    || !hasOnlyKeys(value, CURSOR_KEYS)
    || value.version !== WEEKLY_PLANNING_STABLE_V5_TRACE_CURSOR_VERSION
    || value.userId !== userId
    || value.conversationId !== conversationId
    || !isNonNegativeInteger(value.nextSequence)
    || !isNonNegativeInteger(value.nextTurnIndex)
    || typeof value.lastActivityMs !== 'number'
    || !Number.isFinite(value.lastActivityMs)
    || value.lastActivityMs < 0
    || !Array.isArray(value.requestIds)
    || value.requestIds.length > MAX_REQUEST_IDS
    || !value.requestIds.every((requestId) => isNonEmptyString(requestId, 512))
    || new Set(value.requestIds).size !== value.requestIds.length
    || !isTimestamp(value.savedAt)) {
    return null;
  }

  const session = parseSession(value.session, userId, conversationId);
  if (!session
    || value.nextSequence !== session.entryCount
    || value.nextTurnIndex !== session.turnCount
    || Date.parse(session.lastActivityAt) !== value.lastActivityMs) {
    return null;
  }

  return {
    version: WEEKLY_PLANNING_STABLE_V5_TRACE_CURSOR_VERSION,
    userId,
    conversationId,
    session,
    nextSequence: value.nextSequence,
    nextTurnIndex: value.nextTurnIndex,
    lastActivityMs: value.lastActivityMs,
    requestIds: [...value.requestIds],
    savedAt: value.savedAt,
  };
}

function cursorKeys(): string[] {
  if (typeof window === 'undefined') return [];
  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(STORAGE_KEY_PREFIX)) keys.push(key);
  }
  return keys;
}

function pruneStoredCursors(nowMs = Date.now()): void {
  if (typeof window === 'undefined') return;
  const retained = cursorKeys().flatMap((key) => {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw || new TextEncoder().encode(raw).byteLength > MAX_CURSOR_BYTES) {
        window.localStorage.removeItem(key);
        return [];
      }
      const value: unknown = JSON.parse(raw);
      if (!isRecord(value)
        || typeof value.lastActivityMs !== 'number'
        || !Number.isFinite(value.lastActivityMs)
        || value.lastActivityMs > nowMs + MAX_CLOCK_SKEW_MS
        || nowMs - value.lastActivityMs > CURSOR_RETENTION_MS) {
        window.localStorage.removeItem(key);
        return [];
      }
      return [{ key, lastActivityMs: value.lastActivityMs }];
    } catch {
      window.localStorage.removeItem(key);
      return [];
    }
  }).sort((left, right) => right.lastActivityMs - left.lastActivityMs);

  retained.slice(MAX_PERSISTED_CURSORS).forEach(({ key }) => {
    window.localStorage.removeItem(key);
  });
}

export function loadWeeklyPlanningStableV5TraceCursor(params: {
  userId: string;
  conversationId: string;
}): WeeklyPlanningStableV5TraceCursor | null {
  if (typeof window === 'undefined') return null;
  const key = storageKey(params.userId, params.conversationId);
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    if (new TextEncoder().encode(raw).byteLength > MAX_CURSOR_BYTES) {
      window.localStorage.removeItem(key);
      return null;
    }
    const parsed = parseCursor(JSON.parse(raw) as unknown, params.userId, params.conversationId);
    if (!parsed) window.localStorage.removeItem(key);
    return parsed;
  } catch {
    window.localStorage.removeItem(key);
    return null;
  }
}

export function saveWeeklyPlanningStableV5TraceCursor(params: {
  userId: string;
  conversationId: string;
  session: WeeklyPlanningTraceSession;
  nextSequence: number;
  nextTurnIndex: number;
  lastActivityMs: number;
  requestIds: Iterable<string>;
}): boolean {
  if (typeof window === 'undefined') return false;
  const requestIds = Array.from(params.requestIds).slice(-MAX_REQUEST_IDS);
  const cursor: WeeklyPlanningStableV5TraceCursor = {
    version: WEEKLY_PLANNING_STABLE_V5_TRACE_CURSOR_VERSION,
    userId: params.userId,
    conversationId: params.conversationId,
    session: { ...params.session },
    nextSequence: params.nextSequence,
    nextTurnIndex: params.nextTurnIndex,
    lastActivityMs: params.lastActivityMs,
    requestIds,
    savedAt: new Date().toISOString(),
  };
  if (!parseCursor(cursor, params.userId, params.conversationId)) return false;

  try {
    const raw = JSON.stringify(cursor);
    if (new TextEncoder().encode(raw).byteLength > MAX_CURSOR_BYTES) return false;
    window.localStorage.setItem(storageKey(params.userId, params.conversationId), raw);
    pruneStoredCursors(params.lastActivityMs);
    return true;
  } catch {
    return false;
  }
}

export function clearWeeklyPlanningStableV5TraceCursor(params: {
  userId: string;
  conversationId: string;
}): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKey(params.userId, params.conversationId));
  } catch {
    // Trace persistence is best effort and must not break the planning flow.
  }
}

export function clearAllWeeklyPlanningStableV5TraceCursorsForTest(): void {
  if (typeof window === 'undefined') return;
  cursorKeys().forEach((key) => window.localStorage.removeItem(key));
}

export function getWeeklyPlanningStableV5TraceCursorStorageKeyForTest(
  userId: string,
  conversationId: string,
): string {
  return storageKey(userId, conversationId);
}
