import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS } from '../../../../shared/weeklyPlanningTraceContract';
import { sanitizeWeeklyPlanningTraceValue } from './weeklyPlanningTraceRedaction';
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
const DEBUG_INLINE_MAX_BYTES = WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.debugRawChunkBytes;
const DEBUG_CHUNK_BYTES = WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.debugRawChunkBytes;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const POST_CANONICALIZATION_STAGES = new Set([
  'semantic_canonicalization_evaluated',
  'scheduler_compilation_evaluated',
  'semantic_pipeline_decision',
  'runtime_semantic_result_received',
  'runtime_graph_staged',
  'runtime_scheduler_dialogue_evaluated',
  'runtime_preview_scheduler_evaluated',
  'runtime_branch_selected',
  'runtime_turn_output',
]);

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
  debugTraceEvents?: WeeklyPlanningStableV5DebugTraceEvent[];
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
): ActiveStableV5TraceSession | null {
  const persisted = loadWeeklyPlanningStableV5TraceCursor({
    userId: params.userId,
    conversationId: params.conversationId,
  });
  if (!persisted) return null;
  if (persisted.session.status !== 'active') {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integerField(value: unknown, key: string): number | null {
  if (!isRecord(value)) return null;
  const candidate = value[key];
  return Number.isInteger(candidate) && Number(candidate) >= 0 ? Number(candidate) : null;
}

function nestedIntegerField(value: unknown, path: string[]): number | null {
  let current: unknown = value;
  for (const key of path.slice(0, -1)) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return integerField(current, path[path.length - 1]);
}

function eventGraphRevision(
  event: WeeklyPlanningStableV5DebugTraceEvent,
  inputRevision: number,
  outputRevision: number,
): number {
  return integerField(event.data, 'graphRevision')
    ?? integerField(event.data, 'expectedRevision')
    ?? nestedIntegerField(event.data, ['graph', 'revision'])
    ?? nestedIntegerField(event.data, ['input', 'graph', 'revision'])
    ?? nestedIntegerField(event.data, ['runtimeSession', 'graph', 'revision'])
    ?? nestedIntegerField(event.data, ['result', 'graph', 'revision'])
    ?? nestedIntegerField(event.data, ['stagedGraph', 'revision'])
    ?? nestedIntegerField(event.data, ['schedulerInput', 'graph', 'revision'])
    ?? (POST_CANONICALIZATION_STAGES.has(event.stage) ? outputRevision : inputRevision);
}

function inputGraphRevision(params: WeeklyPlanningStableV5TraceInput): number {
  const events = params.debugTraceEvents ?? [];
  for (const stage of ['runtime_session_context_prepared', 'semantic_pipeline_input']) {
    const event = events.find((candidate) => candidate.stage === stage);
    if (!event) continue;
    const revision = integerField(event.data, 'graphRevision')
      ?? integerField(event.data, 'expectedRevision')
      ?? nestedIntegerField(event.data, ['runtimeSession', 'graph', 'revision'])
      ?? nestedIntegerField(event.data, ['graph', 'revision']);
    if (revision !== null) return revision;
  }
  return Math.max(0, params.graphRevision - 1);
}

function prepareDebugData(value: unknown) {
  return sanitizeWeeklyPlanningTraceValue(value, {
    maxDepth: 256,
    maxArrayItems: 1_000_000,
    maxObjectKeys: 1_000_000,
    maxStringLength: 100_000_000,
    maxSerializedBytes: Number.MAX_SAFE_INTEGER,
  });
}

function encodeBase64(bytes: Uint8Array): string {
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const second = hasSecond ? bytes[index + 1] : 0;
    const third = hasThird ? bytes[index + 2] : 0;
    const value = (first << 16) | (second << 8) | third;
    output += BASE64_ALPHABET[(value >> 18) & 63];
    output += BASE64_ALPHABET[(value >> 12) & 63];
    output += hasSecond ? BASE64_ALPHABET[(value >> 6) & 63] : '=';
    output += hasThird ? BASE64_ALPHABET[value & 63] : '=';
  }
  return output;
}

function debugEventPayloads(event: WeeklyPlanningStableV5DebugTraceEvent): unknown[] {
  const prepared = prepareDebugData(event.data);
  const serialized = JSON.stringify(prepared.value) ?? 'null';
  const bytes = new TextEncoder().encode(serialized);
  const common = {
    debugSchemaVersion: event.schemaVersion,
    debugSequence: event.sequence,
    stage: event.stage,
    stageOccurredAt: event.occurredAt,
    sourceSanitizerTruncated: prepared.truncated,
  };
  if (bytes.byteLength <= DEBUG_INLINE_MAX_BYTES) {
    return [{
      ...common,
      storage: 'inline_json',
      serializedBytes: bytes.byteLength,
      data: prepared.value,
    }];
  }

  const chunkCount = Math.ceil(bytes.byteLength / DEBUG_CHUNK_BYTES);
  return Array.from({ length: chunkCount }, (_, chunkIndex) => {
    const start = chunkIndex * DEBUG_CHUNK_BYTES;
    const chunk = bytes.slice(start, Math.min(bytes.byteLength, start + DEBUG_CHUNK_BYTES));
    return {
      ...common,
      storage: 'base64_utf8_json_chunk',
      encoding: 'base64-utf8-json',
      chunkIndex,
      chunkCount,
      totalSerializedBytes: bytes.byteLength,
      chunkBytes: chunk.byteLength,
      dataChunk: encodeBase64(chunk),
    };
  });
}

function debugStageEntries(
  active: ActiveStableV5TraceSession,
  params: WeeklyPlanningStableV5TraceInput,
  occurredAt: string,
  inputRevision: number,
): WeeklyPlanningTraceInternalEventEntry[] {
  return (params.debugTraceEvents ?? [])
    .slice()
    .sort((left, right) => left.sequence - right.sequence)
    .flatMap((event) => debugEventPayloads(event).map((payload) => eventEntry(active, {
      eventType: 'stable_v5_debug_stage',
      payload,
      occurredAt,
      requestId: params.requestId,
      stateRevision: eventGraphRevision(event, inputRevision, params.graphRevision),
      severity: event.severity,
    })));
}

function createDiscardEvent(
  active: ActiveStableV5TraceSession,
  params: WeeklyPlanningStableV5TraceInput,
  occurredAt: string,
): WeeklyPlanningTraceInternalEventEntry | null {
  if (params.errorCode === 'stale_async_result_discarded') {
    return eventEntry(active, {
      eventType: 'stale_async_result_discarded',
      payload: {
        runtime: 'stable_v5',
        outcome: params.outcome,
        graphRevision: params.graphRevision,
      },
      occurredAt,
      requestId: params.requestId,
      stateRevision: params.graphRevision,
      severity: 'warn',
    });
  }
  if (params.errorCode === 'commit_rejected') {
    return eventEntry(active, {
      eventType: 'request_cancelled',
      payload: {
        runtime: 'stable_v5',
        reason: 'commit_rejected',
        graphRevision: params.graphRevision,
      },
      occurredAt,
      requestId: params.requestId,
      stateRevision: params.graphRevision,
      severity: 'warn',
    });
  }
  return null;
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

  const previousRevision = inputGraphRevision(params);
  const entries: WeeklyPlanningTraceEntry[] = [];
  entries.push(turnEntry(active, {
    role: 'user',
    content: params.userText,
    occurredAt,
    requestId: params.requestId,
    stateRevision: previousRevision,
  }));
  entries.push(eventEntry(active, {
    eventType: 'user_turn_received',
    payload: {
      runtime: 'stable_v5',
      conversationId: params.conversationId,
    },
    occurredAt,
    requestId: params.requestId,
    stateRevision: previousRevision,
  }));
  entries.push(eventEntry(active, {
    eventType: 'interpreter_started',
    payload: {
      runtime: 'stable_v5',
      previousGraphRevision: previousRevision,
    },
    occurredAt,
    requestId: params.requestId,
    stateRevision: previousRevision,
    severity: 'debug',
  }));

  const debugEntries = debugStageEntries(active, params, occurredAt, previousRevision);
  entries.push(...debugEntries);
  entries.push(eventEntry(active, {
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
  }));
  entries.push(eventEntry(active, {
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
  }));

  const discardEvent = createDiscardEvent(active, params, occurredAt);
  if (discardEvent) entries.push(discardEvent);

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
      inputGraphRevision: previousRevision,
      graphRevision: params.graphRevision,
      graphSummary: params.graphSummary,
      compatibilityState: params.compatibilityState,
      debugTraceSummary: params.debugTraceEvents
        ? {
            storage: 'stable_v5_debug_stage_entries',
            eventCount: params.debugTraceEvents.length,
            persistedEntryCount: debugEntries.length,
          }
        : undefined,
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