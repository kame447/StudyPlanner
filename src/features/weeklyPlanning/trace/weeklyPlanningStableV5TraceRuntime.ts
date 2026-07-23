import { sanitizeWeeklyPlanningTraceValue } from './weeklyPlanningTraceRedaction';
import {
  getWeeklyPlanningTraceRepository,
  isWeeklyPlanningTraceEnabled,
} from './weeklyPlanningTraceRepository';
import {
  WEEKLY_PLANNING_TRACE_SCHEMA_VERSION,
  type WeeklyPlanningTraceEntry,
  type WeeklyPlanningTraceInternalEventEntry,
  type WeeklyPlanningTraceSession,
  type WeeklyPlanningTraceStateSnapshotEntry,
  type WeeklyPlanningTraceTurnEntry,
} from './weeklyPlanningTraceTypes';

const SESSION_RETENTION_DAYS = 90;
const SNAPSHOT_RETENTION_DAYS = 30;
const TRACE_CONTINUITY_STORAGE_VERSION =
  'studyplanner-weekly-planning-stable-v5-trace-continuity-v1' as const;
const MAX_PERSISTED_REQUEST_IDS = 200;

interface ActiveStableV5TraceSession {
  session: WeeklyPlanningTraceSession;
  nextSequence: number;
  nextTurnIndex: number;
  lastActivityMs: number;
  requestIds: Set<string>;
  writeQueue: Promise<void>;
}

interface PersistedStableV5TraceContinuity {
  version: typeof TRACE_CONTINUITY_STORAGE_VERSION;
  userId: string;
  conversationId: string;
  session: WeeklyPlanningTraceSession;
  nextSequence: number;
  nextTurnIndex: number;
  requestIds: string[];
  savedAt: string;
}

export interface WeeklyPlanningStableV5TraceInput {
  userId: string;
  conversationId: string;
  requestId: string;
  userText: string;
  assistantMessage?: string;
  outcome: string;
  graphRevision: number;
  graphSummary: Record<string, unknown>;
  compatibilityState?: unknown;
  previewCount: number;
  planningRangeStart?: string;
  planningRangeEnd?: string;
  errorCode?: string;
}

const activeSessions = new Map<string, ActiveStableV5TraceSession>();

function nowIso(): string {
  return new Date().toISOString();
}

function expireAt(now: string, retentionDays: number): string {
  return new Date(new Date(now).getTime() + retentionDays * 86_400_000).toISOString();
}

function sessionKey(userId: string, conversationId: string): string {
  return `${userId}:${conversationId}`;
}

function stableLocalSessionId(conversationId: string): string {
  return `weekly-trace-stable-v5:${conversationId}`;
}

function continuityStorageKey(userId: string, conversationId: string): string {
  return [
    'studyplanner.weeklyPlanning.traceContinuity.v1',
    encodeURIComponent(userId),
    encodeURIComponent(conversationId),
  ].join('.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isPersistedSession(
  value: unknown,
  userId: string,
  conversationId: string,
): value is WeeklyPlanningTraceSession {
  if (!isRecord(value)) return false;
  return value.id === stableLocalSessionId(conversationId)
    && value.logicalConversationId === conversationId
    && value.userId === userId
    && (value.status === 'active'
      || value.status === 'completed'
      || value.status === 'abandoned'
      || value.status === 'failed')
    && isTimestamp(value.startedAt)
    && isTimestamp(value.lastActivityAt)
    && (value.endedAt === undefined || isTimestamp(value.endedAt))
    && isNonNegativeInteger(value.turnCount)
    && isNonNegativeInteger(value.entryCount)
    && typeof value.hasPreview === 'boolean'
    && typeof value.hasApprovalFailure === 'boolean'
    && typeof value.hasFallback === 'boolean'
    && typeof value.hasError === 'boolean'
    && typeof value.appVersion === 'string'
    && isNonNegativeInteger(value.schemaVersion)
    && isTimestamp(value.expireAt);
}

function persistContinuity(active: ActiveStableV5TraceSession): void {
  if (typeof window === 'undefined') return;
  const payload: PersistedStableV5TraceContinuity = {
    version: TRACE_CONTINUITY_STORAGE_VERSION,
    userId: active.session.userId,
    conversationId: active.session.logicalConversationId,
    session: { ...active.session },
    nextSequence: active.nextSequence,
    nextTurnIndex: active.nextTurnIndex,
    requestIds: Array.from(active.requestIds).slice(-MAX_PERSISTED_REQUEST_IDS),
    savedAt: nowIso(),
  };
  try {
    window.localStorage.setItem(
      continuityStorageKey(payload.userId, payload.conversationId),
      JSON.stringify(payload),
    );
  } catch {
    // Trace continuity is best effort. The trace repository remains authoritative.
  }
}

function loadContinuity(
  userId: string,
  conversationId: string,
  now: string,
): ActiveStableV5TraceSession | null {
  if (typeof window === 'undefined') return null;
  const key = continuityStorageKey(userId, conversationId);
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)
      || value.version !== TRACE_CONTINUITY_STORAGE_VERSION
      || value.userId !== userId
      || value.conversationId !== conversationId
      || !isPersistedSession(value.session, userId, conversationId)
      || !isNonNegativeInteger(value.nextSequence)
      || !isNonNegativeInteger(value.nextTurnIndex)
      || !Array.isArray(value.requestIds)
      || !value.requestIds.every((requestId) => typeof requestId === 'string')
      || !isTimestamp(value.savedAt)) {
      window.localStorage.removeItem(key);
      return null;
    }
    const { endedAt: _endedAt, ...sessionWithoutEnd } = value.session;
    const session: WeeklyPlanningTraceSession = {
      ...sessionWithoutEnd,
      status: 'active',
      lastActivityAt: now,
      expireAt: expireAt(now, SESSION_RETENTION_DAYS),
    };
    return {
      session,
      nextSequence: Math.max(value.nextSequence, session.entryCount),
      nextTurnIndex: Math.max(value.nextTurnIndex, session.turnCount),
      lastActivityMs: Date.parse(now),
      requestIds: new Set(value.requestIds.slice(-MAX_PERSISTED_REQUEST_IDS)),
      writeQueue: Promise.resolve(),
    };
  } catch {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore storage cleanup failures.
    }
    return null;
  }
}

function createSession(params: WeeklyPlanningStableV5TraceInput, now: string) {
  const session: WeeklyPlanningTraceSession = {
    id: stableLocalSessionId(params.conversationId),
    logicalConversationId: params.conversationId,
    userId: params.userId,
    status: 'active',
    startedAt: now,
    lastActivityAt: now,
    ...(params.planningRangeStart
      ? { planningRangeStart: params.planningRangeStart }
      : {}),
    ...(params.planningRangeEnd ? { planningRangeEnd: params.planningRangeEnd } : {}),
    turnCount: 0,
    entryCount: 0,
    hasPreview: false,
    hasApprovalFailure: false,
    hasFallback: false,
    hasError: false,
    appVersion: import.meta.env.VITE_APP_VERSION ?? '0.1.0',
    schemaVersion: WEEKLY_PLANNING_TRACE_SCHEMA_VERSION,
    expireAt: expireAt(now, SESSION_RETENTION_DAYS),
  };
  return {
    session,
    nextSequence: 0,
    nextTurnIndex: 0,
    lastActivityMs: Date.parse(now),
    requestIds: new Set<string>(),
    writeQueue: Promise.resolve(),
  } satisfies ActiveStableV5TraceSession;
}

function ensureSession(
  params: WeeklyPlanningStableV5TraceInput,
  now: string,
): ActiveStableV5TraceSession {
  const key = sessionKey(params.userId, params.conversationId);
  const current = activeSessions.get(key)
    ?? loadContinuity(params.userId, params.conversationId, now)
    ?? createSession(params, now);

  current.lastActivityMs = Date.parse(now);
  current.session.status = 'active';
  current.session.lastActivityAt = now;
  current.session.expireAt = expireAt(now, SESSION_RETENTION_DAYS);
  delete current.session.endedAt;
  if (params.planningRangeStart) {
    current.session.planningRangeStart = params.planningRangeStart;
  }
  if (params.planningRangeEnd) {
    current.session.planningRangeEnd = params.planningRangeEnd;
  }
  activeSessions.set(key, current);
  persistContinuity(current);
  return current;
}

function commonEntry(
  active: ActiveStableV5TraceSession,
  params: {
    occurredAt: string;
    requestId: string;
    stateRevision: number;
    retentionDays?: number;
  },
) {
  const sequence = active.nextSequence;
  active.nextSequence += 1;
  return {
    id: `${active.session.id}-${String(sequence).padStart(8, '0')}`,
    sessionId: active.session.id,
    logicalConversationId: active.session.logicalConversationId,
    userId: active.session.userId,
    sequence,
    requestId: params.requestId,
    stateRevision: params.stateRevision,
    occurredAt: params.occurredAt,
    observedAt: nowIso(),
    schemaVersion: WEEKLY_PLANNING_TRACE_SCHEMA_VERSION,
    expireAt: expireAt(
      params.occurredAt,
      params.retentionDays ?? SESSION_RETENTION_DAYS,
    ),
  };
}

function turnEntry(
  active: ActiveStableV5TraceSession,
  params: {
    role: 'user' | 'assistant';
    content: string;
    occurredAt: string;
    requestId: string;
    stateRevision: number;
  },
): WeeklyPlanningTraceTurnEntry {
  const turnIndex = active.nextTurnIndex;
  active.nextTurnIndex += 1;
  active.session.turnCount += 1;
  return {
    ...commonEntry(active, params),
    kind: 'turn',
    role: params.role,
    content: params.content,
    turnIndex,
    ...(params.role === 'assistant' ? { responseSource: 'system' as const } : {}),
  };
}

function eventEntry(
  active: ActiveStableV5TraceSession,
  params: {
    eventType: WeeklyPlanningTraceInternalEventEntry['eventType'];
    payload: unknown;
    occurredAt: string;
    requestId: string;
    stateRevision: number;
    severity?: WeeklyPlanningTraceInternalEventEntry['severity'];
  },
): WeeklyPlanningTraceInternalEventEntry {
  return {
    ...commonEntry(active, params),
    kind: 'internal_event',
    eventType: params.eventType,
    payload: sanitizeWeeklyPlanningTraceValue(params.payload).value,
    severity: params.severity ?? 'info',
  };
}

function snapshotEntry(
  active: ActiveStableV5TraceSession,
  params: {
    state: unknown;
    occurredAt: string;
    requestId: string;
    stateRevision: number;
    reason: WeeklyPlanningTraceStateSnapshotEntry['snapshotReason'];
  },
): WeeklyPlanningTraceStateSnapshotEntry {
  return {
    ...commonEntry(active, {
      ...params,
      retentionDays: SNAPSHOT_RETENTION_DAYS,
    }),
    kind: 'state_snapshot',
    snapshotReason: params.reason,
    state: sanitizeWeeklyPlanningTraceValue(params.state).value,
  };
}

async function appendBestEffort(
  active: ActiveStableV5TraceSession,
  entries: WeeklyPlanningTraceEntry[],
): Promise<void> {
  active.session.entryCount = active.nextSequence;
  active.session.lastActivityAt = entries[entries.length - 1]?.observedAt ?? nowIso();
  persistContinuity(active);

  const operation = active.writeQueue.catch(() => undefined).then(async () => {
    await getWeeklyPlanningTraceRepository().appendEntries({
      session: { ...active.session },
      entries,
    });
    persistContinuity(active);
  });
  active.writeQueue = operation.catch(() => undefined);
  await operation;
}

export async function recordWeeklyPlanningStableV5TurnTrace(
  params: WeeklyPlanningStableV5TraceInput,
): Promise<void> {
  if (!isWeeklyPlanningTraceEnabled()) return;
  const occurredAt = nowIso();
  const active = ensureSession(params, occurredAt);
  if (active.requestIds.has(params.requestId)) return;
  active.requestIds.add(params.requestId);
  active.session.hasPreview ||= params.previewCount > 0;
  active.session.hasError ||= Boolean(params.errorCode);

  const previousRevision = Math.max(0, params.graphRevision - 1);
  const entries: WeeklyPlanningTraceEntry[] = [
    turnEntry(active, {
      role: 'user',
      content: params.userText,
      occurredAt,
      requestId: params.requestId,
      stateRevision: previousRevision,
    }),
    eventEntry(active, {
      eventType: 'user_turn_received',
      payload: {
        runtime: 'stable_v5',
        conversationId: params.conversationId,
      },
      occurredAt,
      requestId: params.requestId,
      stateRevision: previousRevision,
    }),
    eventEntry(active, {
      eventType: 'interpreter_started',
      payload: {
        runtime: 'stable_v5',
        previousGraphRevision: previousRevision,
      },
      occurredAt,
      requestId: params.requestId,
      stateRevision: previousRevision,
      severity: 'debug',
    }),
    eventEntry(active, {
      eventType: 'interpreter_completed',
      payload: {
        runtime: 'stable_v5',
        outcome: params.outcome,
        graphRevision: params.graphRevision,
        ...(params.errorCode ? { errorCode: params.errorCode } : {}),
      },
      occurredAt,
      requestId: params.requestId,
      stateRevision: params.graphRevision,
      severity: params.errorCode ? 'error' : 'info',
    }),
    eventEntry(active, {
      eventType: 'dialogue_planned',
      payload: {
        runtime: 'stable_v5',
        outcome: params.outcome,
        previewCount: params.previewCount,
      },
      occurredAt,
      requestId: params.requestId,
      stateRevision: params.graphRevision,
      severity: params.errorCode ? 'warn' : 'info',
    }),
  ];

  if (params.previewCount > 0) {
    entries.push(eventEntry(active, {
      eventType: 'preview_generated',
      payload: {
        runtime: 'stable_v5',
        previewId: `stable-v5-preview:${params.conversationId}:${params.graphRevision}`,
        candidateCount: params.previewCount,
      },
      occurredAt,
      requestId: params.requestId,
      stateRevision: params.graphRevision,
    }));
  }
  if (params.assistantMessage) {
    entries.push(turnEntry(active, {
      role: 'assistant',
      content: params.assistantMessage,
      occurredAt,
      requestId: params.requestId,
      stateRevision: params.graphRevision,
    }));
  }
  entries.push(snapshotEntry(active, {
    state: {
      runtime: 'stable_v5',
      graphRevision: params.graphRevision,
      graphSummary: params.graphSummary,
      compatibilityState: params.compatibilityState,
    },
    occurredAt,
    requestId: params.requestId,
    stateRevision: params.graphRevision,
    reason: params.errorCode
      ? 'error'
      : params.previewCount > 0
        ? 'preview_generated'
        : 'turn_completed',
  }));

  persistContinuity(active);
  try {
    await appendBestEffort(active, entries);
  } catch (error) {
    console.warn('[WeeklyPlanning Stable V5 Trace] write failed', {
      conversationId: params.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function resetWeeklyPlanningStableV5TraceRuntimeForTest(): void {
  activeSessions.clear();
}

export function clearWeeklyPlanningStableV5TraceContinuityForTest(params: {
  userId: string;
  conversationId: string;
}): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(continuityStorageKey(params.userId, params.conversationId));
}
