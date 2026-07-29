import type { WeeklyPlanningStableV5DebugTraceEvent } from './weeklyPlanningStableV5DebugTrace';
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
import { createWeeklyPlanningTurnDiagnosticV2 } from './weeklyPlanningTurnDiagnosticV2';
import {
  clearWeeklyPlanningTraceOutboxForTest,
  enqueueWeeklyPlanningTraceOutboxItem,
  listWeeklyPlanningTraceOutboxItems,
  removeWeeklyPlanningTraceOutboxItem,
} from './weeklyPlanningTraceOutbox';
import {
  WEEKLY_PLANNING_TRACE_SCHEMA_VERSION,
  type WeeklyPlanningTraceEntry,
  type WeeklyPlanningTraceSession,
} from './weeklyPlanningTraceTypes';

const SESSION_RETENTION_DAYS = 90;

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
  debugTraceEvents?: WeeklyPlanningStableV5DebugTraceEvent[];
  previewCount: number;
  planningRangeStart?: string;
  planningRangeEnd?: string;
  errorCode?: string;
  /** Legacy caller metadata accepted during migration. It is intentionally ignored and never persisted. */
  graphRevision?: number;
  graphSummary?: Record<string, unknown>;
  compatibilityState?: unknown;
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
    ...(params.planningRangeStart ? { planningRangeStart: params.planningRangeStart } : {}),
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
): ActiveStableV5TraceSession | null {
  const persisted = loadWeeklyPlanningStableV5TraceCursor({
    userId: params.userId,
    conversationId: params.conversationId,
  });
  if (!persisted) return null;
  if (persisted.session.status !== 'active'
    || persisted.session.schemaVersion !== WEEKLY_PLANNING_TRACE_SCHEMA_VERSION) {
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

function ensureSession(
  params: WeeklyPlanningStableV5TraceInput,
  now: string,
): ActiveStableV5TraceSession {
  const key = sessionKey(params.userId, params.conversationId);
  const current = activeSessions.get(key);
  if (current) return current;
  const restored = restoreSession(params);
  const next = restored ?? createSession(params, now);
  activeSessions.set(key, next);
  if (!restored) persistSession(next);
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
  const saved = saveWeeklyPlanningStableV5TraceCursor({
    userId: active.session.userId,
    conversationId: active.session.logicalConversationId,
    session: active.session,
    nextSequence: active.nextSequence,
    nextTurnIndex: active.nextTurnIndex,
    lastActivityMs: active.lastActivityMs,
    requestIds: active.requestIds,
  });
  if (!saved) {
    console.warn('[WeeklyPlanning Stable V5 Trace] cursor persistence failed', {
      conversationId: active.session.logicalConversationId,
      entryCount: active.session.entryCount,
      turnCount: active.session.turnCount,
    });
  }
}

function createTurnDiagnosticEntry(
  active: ActiveStableV5TraceSession,
  params: WeeklyPlanningStableV5TraceInput,
  occurredAt: string,
): WeeklyPlanningTraceEntry {
  const sequence = active.nextSequence;
  const turnIndex = active.nextTurnIndex;
  const observedAt = nowIso();
  active.nextSequence += 1;
  active.nextTurnIndex += 1;
  active.session.turnCount += 1;
  active.requestIds.add(params.requestId);
  active.session.hasPreview ||= params.previewCount > 0;
  active.session.hasFallback ||= params.outcome.includes('fallback');
  active.session.hasError ||= Boolean(params.errorCode)
    || params.outcome === 'failed'
    || params.outcome.includes('provider_failure')
    || params.outcome.includes('normalization_rejected')
    || params.outcome.includes('canonicalization_rejected');
  if (params.planningRangeStart) active.session.planningRangeStart = params.planningRangeStart;
  if (params.planningRangeEnd) active.session.planningRangeEnd = params.planningRangeEnd;

  return createWeeklyPlanningTurnDiagnosticV2({
    id: `${active.session.id}-${String(sequence).padStart(8, '0')}`,
    sessionId: active.session.id,
    logicalConversationId: active.session.logicalConversationId,
    sequence,
    turnIndex,
    requestId: params.requestId,
    occurredAt,
    observedAt,
    expireAt: expireAt(occurredAt, SESSION_RETENTION_DAYS),
    userText: params.userText,
    assistantMessage: params.assistantMessage,
    outcome: params.outcome,
    previewCount: params.previewCount,
    errorCode: params.errorCode,
    debugTraceEvents: params.debugTraceEvents,
  });
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

async function writeTraceInput(
  active: ActiveStableV5TraceSession,
  params: WeeklyPlanningStableV5TraceInput,
  occurredAt: string,
): Promise<void> {
  if (active.requestIds.has(params.requestId)) return;
  const working = cloneWorkingSession(active);
  const entry = createTurnDiagnosticEntry(working, params, occurredAt);
  await appendWorkingSession(active, working, [entry]);
}

function outboxIdentity(params: WeeklyPlanningStableV5TraceInput) {
  return {
    userId: params.userId,
    conversationId: params.conversationId,
    requestId: params.requestId,
  };
}

function enqueueFailedInput(
  params: WeeklyPlanningStableV5TraceInput,
  occurredAt: string,
  error: unknown,
): void {
  const result = enqueueWeeklyPlanningTraceOutboxItem({
    version: 'studyplanner-weekly-planning-trace-outbox-v1',
    occurredAt,
    input: params,
  });
  console.warn('[WeeklyPlanning Stable V5 Trace] write queued in outbox', {
    conversationId: params.conversationId,
    requestId: params.requestId,
    saved: result.saved,
    overflowed: result.overflowed,
    error: error instanceof Error ? error.message : String(error),
  });
}

async function flushOutbox(
  active: ActiveStableV5TraceSession,
  params: WeeklyPlanningStableV5TraceInput,
): Promise<boolean> {
  const pending = listWeeklyPlanningTraceOutboxItems({
    userId: params.userId,
    conversationId: params.conversationId,
  });
  for (const item of pending) {
    if (active.requestIds.has(item.input.requestId)) {
      removeWeeklyPlanningTraceOutboxItem(outboxIdentity(item.input));
      continue;
    }
    try {
      await writeTraceInput(active, item.input, item.occurredAt);
      removeWeeklyPlanningTraceOutboxItem(outboxIdentity(item.input));
    } catch (error) {
      console.warn('[WeeklyPlanning Stable V5 Trace] outbox retry failed', {
        conversationId: item.input.conversationId,
        requestId: item.input.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
  return true;
}

export async function recordWeeklyPlanningStableV5TurnTrace(
  params: WeeklyPlanningStableV5TraceInput,
): Promise<void> {
  if (!isWeeklyPlanningTraceEnabled()) return;
  const occurredAt = nowIso();
  const active = ensureSession(params, occurredAt);
  const operation = active.writeQueue.catch(() => undefined).then(async () => {
    const flushed = await flushOutbox(active, params);
    if (!flushed) {
      enqueueFailedInput(params, occurredAt, new Error('older trace outbox item is still pending'));
      return;
    }
    if (active.requestIds.has(params.requestId)) {
      removeWeeklyPlanningTraceOutboxItem(outboxIdentity(params));
      return;
    }
    try {
      await writeTraceInput(active, params, occurredAt);
      removeWeeklyPlanningTraceOutboxItem(outboxIdentity(params));
    } catch (error) {
      enqueueFailedInput(params, occurredAt, error);
    }
  });
  active.writeQueue = operation.catch(() => undefined);
  await operation;
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
  clearWeeklyPlanningTraceOutboxForTest();
}
