import { sanitizeWeeklyPlanningTraceValue } from './weeklyPlanningTraceRedaction';
import {
  getWeeklyPlanningTraceRepository,
  isWeeklyPlanningTraceEnabled,
} from './weeklyPlanningTraceRepository';
import {
  clearAllWeeklyPlanningStableV5TraceCursorsForTest,
  clearWeeklyPlanningStableV5TraceCursor,
  loadWeeklyPlanningStableV5TraceCursor,
  saveWeeklyPlanningStableV5TraceCursor,
} from './weeklyPlanningStableV5TraceSessionStorage';
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
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

interface ActiveStableV5TraceSession {
  session: WeeklyPlanningTraceSession;
  nextSequence: number;
  nextTurnIndex: number;
  lastActivityMs: number;
  requestIds: Set<string>;
  writeQueue: Promise<void>;
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

function randomId(prefix: string): string {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${suffix}`;
}

function sessionKey(userId: string, conversationId: string): string {
  return `${userId}:${conversationId}`;
}

function createSession(params: WeeklyPlanningStableV5TraceInput, now: string) {
  const sessionId = randomId('weekly-trace-stable-v5');
  const session: WeeklyPlanningTraceSession = {
    id: sessionId,
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

function restoreSession(
  params: WeeklyPlanningStableV5TraceInput,
  nowMs: number,
): ActiveStableV5TraceSession | null {
  const persisted = loadWeeklyPlanningStableV5TraceCursor({
    userId: params.userId,
    conversationId: params.conversationId,
  });
  if (!persisted) return null;
  if (persisted.session.status !== 'active'
    || nowMs - persisted.lastActivityMs > SESSION_IDLE_TIMEOUT_MS) {
    clearWeeklyPlanningStableV5TraceCursor({
      userId: params.userId,
      conversationId: params.conversationId,
    });
    return null;
  }
  return {
    session: { ...persisted.session },
    nextSequence: persisted.nextSequence,
    nextTurnIndex: persisted.nextTurnIndex,
    lastActivityMs: persisted.lastActivityMs,
    requestIds: new Set(persisted.requestIds),
    writeQueue: Promise.resolve(),
  };
}

function abandonSession(
  active: ActiveStableV5TraceSession,
  now: string,
): void {
  const abandoned = {
    ...active.session,
    status: 'abandoned' as const,
    lastActivityAt: now,
    endedAt: now,
    expireAt: expireAt(now, SESSION_RETENTION_DAYS),
  };
  clearWeeklyPlanningStableV5TraceCursor({
    userId: active.session.userId,
    conversationId: active.session.logicalConversationId,
  });
  void getWeeklyPlanningTraceRepository().upsertSession(abandoned).catch(() => undefined);
}

function ensureSession(
  params: WeeklyPlanningStableV5TraceInput,
  now: string,
): ActiveStableV5TraceSession {
  const key = sessionKey(params.userId, params.conversationId);
  const current = activeSessions.get(key);
  const nowMs = Date.parse(now);
  if (current && nowMs - current.lastActivityMs <= SESSION_IDLE_TIMEOUT_MS) {
    return current;
  }
  if (current) abandonSession(current, now);

  const restored = restoreSession(params, nowMs);
  const next = restored ?? createSession(params, now);
  activeSessions.set(key, next);
  return next;
}

function cloneWorkingSession(
  active: ActiveStableV5TraceSession,
): ActiveStableV5TraceSession {
  return {
    session: { ...active.session },
    nextSequence: active.nextSequence,
    nextTurnIndex: active.nextTurnIndex,
    lastActivityMs: active.lastActivityMs,
    requestIds: new Set(active.requestIds),
    writeQueue: Promise.resolve(),
  };
}

function commitWorkingSession(
  active: ActiveStableV5TraceSession,
  working: ActiveStableV5TraceSession,
): void {
  active.session = { ...working.session };
  active.nextSequence = working.nextSequence;
  active.nextTurnIndex = working.nextTurnIndex;
  active.lastActivityMs = working.lastActivityMs;
  active.requestIds = new Set(working.requestIds);
}

function persistSession(active: ActiveStableV5TraceSession): void {
  saveWeeklyPlanningStableV5TraceCursor({
    userId: active.session.userId,
    conversationId: active.session.logicalConversationId,
    session: active.session,
    nextSequence: active.nextSequence,
    nextTurnIndex: active.nextTurnIndex,
    lastActivityMs: active.lastActivityMs,
    requestIds: active.requestIds,
  });
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

function createTurnEntries(
  active: ActiveStableV5TraceSession,
  params: WeeklyPlanningStableV5TraceInput,
  occurredAt: string,
): WeeklyPlanningTraceEntry[] {
  active.requestIds.add(params.requestId);
  active.session.hasPreview ||= params.previewCount > 0;
  active.session.hasError ||= Boolean(params.errorCode);
  if (params.planningRangeStart) {
    active.session.planningRangeStart = params.planningRangeStart;
  }
  if (params.planningRangeEnd) {
    active.session.planningRangeEnd = params.planningRangeEnd;
  }

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
  return entries;
}

async function appendWorkingSession(
  active: ActiveStableV5TraceSession,
  working: ActiveStableV5TraceSession,
  entries: WeeklyPlanningTraceEntry[],
): Promise<void> {
  working.session.entryCount = working.nextSequence;
  working.session.lastActivityAt = entries[entries.length - 1]?.observedAt ?? nowIso();
  working.session.expireAt = expireAt(working.session.lastActivityAt, SESSION_RETENTION_DAYS);
  working.lastActivityMs = Date.parse(working.session.lastActivityAt);
  await getWeeklyPlanningTraceRepository().appendEntries({
    session: { ...working.session },
    entries,
  });
  commitWorkingSession(active, working);
  persistSession(active);
}

export async function recordWeeklyPlanningStableV5TurnTrace(
  params: WeeklyPlanningStableV5TraceInput,
): Promise<void> {
  if (!isWeeklyPlanningTraceEnabled()) return;
  const occurredAt = nowIso();
  const active = ensureSession(params, occurredAt);
  const operation = active.writeQueue.catch(() => undefined).then(async () => {
    if (active.requestIds.has(params.requestId)) return;
    const working = cloneWorkingSession(active);
    const entries = createTurnEntries(working, params, occurredAt);
    await appendWorkingSession(active, working, entries);
  });
  active.writeQueue = operation.catch(() => undefined);

  try {
    await operation;
  } catch (error) {
    console.warn('[WeeklyPlanning Stable V5 Trace] write failed', {
      conversationId: params.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function clearWeeklyPlanningStableV5TraceSession(params: {
  userId: string;
  conversationId: string;
}): void {
  activeSessions.delete(sessionKey(params.userId, params.conversationId));
  clearWeeklyPlanningStableV5TraceCursor(params);
}

export function resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest(): void {
  activeSessions.clear();
}

export function resetWeeklyPlanningStableV5TraceRuntimeForTest(): void {
  activeSessions.clear();
  clearAllWeeklyPlanningStableV5TraceCursorsForTest();
}
