import { getFirebaseAuth } from '../../../lib/firebaseClient';
import type { WeeklyPlanDraftBlock } from '../types';
import type {
  WeeklyPlanningBehaviorAwarePipelineOptions,
  WeeklyPlanningBehaviorAwarePipelineOutput,
} from '../pipeline/weeklyPlanningBehaviorAwareIntakePipeline';
import type { WeeklyPlanningIntakePipelineInput } from '../pipeline/weeklyPlanningIntakePipeline';
import { sanitizeWeeklyPlanningTraceValue } from './weeklyPlanningTraceRedaction';
import { getWeeklyPlanningTraceRepository, isWeeklyPlanningTraceEnabled } from './weeklyPlanningTraceRepository';
import {
  WEEKLY_PLANNING_TRACE_SCHEMA_VERSION,
  type WeeklyPlanningTraceEntry,
  type WeeklyPlanningTraceEventType,
  type WeeklyPlanningTraceInternalEventEntry,
  type WeeklyPlanningTraceResponseSource,
  type WeeklyPlanningTraceSession,
  type WeeklyPlanningTraceStateSnapshotEntry,
  type WeeklyPlanningTraceTurnEntry,
} from './weeklyPlanningTraceTypes';

const SESSION_RETENTION_DAYS = 90;
const SNAPSHOT_RETENTION_DAYS = 30;
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_PENDING_WRITE_FAILURES = 10;

interface PendingWriteFailure {
  id: string;
  failedAt: string;
  errorCode: string;
}

interface TraceRequestContext {
  conversationId: string;
  requestId: string;
}

interface ActiveTraceSession {
  session: WeeklyPlanningTraceSession;
  nextSequence: number;
  nextTurnIndex: number;
  lastActivityMs: number;
  pendingAssistantRequestId?: string;
  pendingStateRevision?: number;
  requestIds: Set<string>;
  pendingWriteFailures: PendingWriteFailure[];
  nextWriteFailureSequence: number;
  writeQueue: Promise<void>;
}

const activeSessions = new Map<string, ActiveTraceSession>();
const conversationIdByPreviewKey = new Map<string, string>();
let conversationIdsByState = new WeakMap<object, string>();
let traceContextByInput = new WeakMap<object, TraceRequestContext>();

function nowIso(): string {
  return new Date().toISOString();
}

function expireAt(now: string, retentionDays: number): string {
  return new Date(new Date(now).getTime() + retentionDays * 86400000).toISOString();
}

function randomId(prefix: string): string {
  const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${uuid}`;
}

function resolveTraceUserId(explicitUserId?: string): string | null {
  const value = explicitUserId?.trim() || getFirebaseAuth()?.currentUser?.uid?.trim();
  if (value) return value;
  return import.meta.env.DEV ? 'local-debug-user' : null;
}

function correlationUserId(options: WeeklyPlanningBehaviorAwarePipelineOptions): string {
  return options.userId?.trim()
    || getFirebaseAuth()?.currentUser?.uid?.trim()
    || 'session-local-user';
}

function resolveLogicalConversationId(params: {
  input: WeeklyPlanningIntakePipelineInput;
  options: WeeklyPlanningBehaviorAwarePipelineOptions;
  cached?: TraceRequestContext;
}): string {
  const explicit = params.options.conversationId?.trim();
  if (explicit) return explicit;

  const previousState = params.input.previousState;
  if (previousState && typeof previousState === 'object') {
    const mapped = conversationIdsByState.get(previousState);
    if (mapped) return mapped;
  }

  if (params.cached?.conversationId) return params.cached.conversationId;
  return randomId('weekly-planning-conversation');
}

export function prepareWeeklyPlanningTraceOptions(
  input: WeeklyPlanningIntakePipelineInput,
  options: WeeklyPlanningBehaviorAwarePipelineOptions,
): WeeklyPlanningBehaviorAwarePipelineOptions {
  const cached = input && typeof input === 'object' ? traceContextByInput.get(input) : undefined;
  const conversationId = resolveLogicalConversationId({ input, options, cached });
  const explicitRequestId = options.traceRequestId?.trim();
  const requestId = explicitRequestId
    || (cached?.conversationId === conversationId ? cached.requestId : randomId('weekly-request'));
  if (input && typeof input === 'object') {
    traceContextByInput.set(input, { conversationId, requestId });
  }
  return {
    ...options,
    userId: options.userId?.trim() || correlationUserId(options),
    conversationId,
    traceRequestId: requestId,
  };
}

function activeSessionKey(userId: string, logicalConversationId: string): string {
  return `${userId}:${logicalConversationId}`;
}

function createSession(params: {
  userId: string;
  logicalConversationId: string;
  planningRangeStart?: string;
  planningRangeEnd?: string;
  now: string;
}): ActiveTraceSession {
  const sessionId = randomId('weekly-trace');
  return {
    session: {
      id: sessionId,
      logicalConversationId: params.logicalConversationId,
      userId: params.userId,
      status: 'active',
      startedAt: params.now,
      lastActivityAt: params.now,
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
      expireAt: expireAt(params.now, SESSION_RETENTION_DAYS),
    },
    nextSequence: 0,
    nextTurnIndex: 0,
    lastActivityMs: new Date(params.now).getTime(),
    requestIds: new Set<string>(),
    pendingWriteFailures: [],
    nextWriteFailureSequence: 0,
    writeQueue: Promise.resolve(),
  };
}

function abandonExpiredSession(active: ActiveTraceSession, now: string): void {
  active.session.status = 'abandoned';
  active.session.endedAt = now;
  active.session.lastActivityAt = now;
  void getWeeklyPlanningTraceRepository().upsertSession({ ...active.session }).catch(() => undefined);
}

function ensureActiveSession(params: {
  userId: string;
  logicalConversationId: string;
  planningRangeStart?: string;
  planningRangeEnd?: string;
  now: string;
}): ActiveTraceSession {
  const key = activeSessionKey(params.userId, params.logicalConversationId);
  const existing = activeSessions.get(key);
  const nowMs = new Date(params.now).getTime();
  if (existing && nowMs - existing.lastActivityMs <= SESSION_IDLE_TIMEOUT_MS) {
    existing.lastActivityMs = nowMs;
    existing.session.lastActivityAt = params.now;
    existing.session.expireAt = expireAt(params.now, SESSION_RETENTION_DAYS);
    if (params.planningRangeStart) existing.session.planningRangeStart = params.planningRangeStart;
    if (params.planningRangeEnd) existing.session.planningRangeEnd = params.planningRangeEnd;
    return existing;
  }

  if (existing) abandonExpiredSession(existing, params.now);
  const created = createSession(params);
  activeSessions.set(key, created);
  return created;
}

function entryId(sessionId: string, sequence: number): string {
  return `${sessionId}-${String(sequence).padStart(8, '0')}`;
}

function commonEntry(
  active: ActiveTraceSession,
  params: {
    requestId?: string;
    stateRevision?: number;
    occurredAt: string;
    retentionDays?: number;
  },
) {
  const sequence = active.nextSequence++;
  return {
    id: entryId(active.session.id, sequence),
    sessionId: active.session.id,
    logicalConversationId: active.session.logicalConversationId,
    userId: active.session.userId,
    sequence,
    ...(params.requestId ? { requestId: params.requestId } : {}),
    ...(typeof params.stateRevision === 'number' ? { stateRevision: params.stateRevision } : {}),
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
  active: ActiveTraceSession,
  params: {
    role: 'user' | 'assistant';
    content: string;
    occurredAt: string;
    requestId?: string;
    stateRevision?: number;
    responseSource?: WeeklyPlanningTraceResponseSource;
  },
): WeeklyPlanningTraceTurnEntry {
  const turnIndex = active.nextTurnIndex++;
  active.session.turnCount += 1;
  return {
    ...commonEntry(active, params),
    kind: 'turn',
    role: params.role,
    content: params.content,
    turnIndex,
    ...(params.responseSource ? { responseSource: params.responseSource } : {}),
  };
}

function finiteSanitizedValue(value: unknown): unknown {
  const sanitized = sanitizeWeeklyPlanningTraceValue(value);
  if (!sanitized.truncated) return sanitized.value;
  return {
    errorCode: 'trace-payload-truncated',
    serializedBytes: sanitized.serializedBytes,
    value: sanitized.value,
  };
}

function eventEntry(
  active: ActiveTraceSession,
  params: {
    eventType: WeeklyPlanningTraceEventType;
    payload: unknown;
    occurredAt: string;
    requestId?: string;
    stateRevision?: number;
    severity?: WeeklyPlanningTraceInternalEventEntry['severity'];
  },
): WeeklyPlanningTraceInternalEventEntry {
  return {
    ...commonEntry(active, params),
    kind: 'internal_event',
    eventType: params.eventType,
    payload: finiteSanitizedValue(params.payload),
    severity: params.severity ?? 'info',
  };
}

function snapshotEntry(
  active: ActiveTraceSession,
  params: {
    state: unknown;
    occurredAt: string;
    requestId?: string;
    stateRevision?: number;
    reason: WeeklyPlanningTraceStateSnapshotEntry['snapshotReason'];
  },
): WeeklyPlanningTraceStateSnapshotEntry {
  return {
    ...commonEntry(active, { ...params, retentionDays: SNAPSHOT_RETENTION_DAYS }),
    kind: 'state_snapshot',
    snapshotReason: params.reason,
    state: finiteSanitizedValue(params.state),
  };
}

function finiteErrorCode(error: unknown): string {
  if (!(error instanceof Error) || !error.message.trim()) return 'trace-write-failed';
  return error.message.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 120)
    || 'trace-write-failed';
}

function pendingFailureEntries(
  active: ActiveTraceSession,
  failures: readonly PendingWriteFailure[],
  occurredAt: string,
): WeeklyPlanningTraceInternalEventEntry[] {
  return failures.map((failure) => eventEntry(active, {
    eventType: 'trace_write_failed',
    payload: failure,
    occurredAt,
    severity: 'error',
  }));
}

async function appendBestEffort(
  active: ActiveTraceSession,
  entries: WeeklyPlanningTraceEntry[],
  requestIdForRetry?: string,
): Promise<void> {
  if (entries.length === 0) return;
  const operation = active.writeQueue.catch(() => undefined).then(async () => {
    const failuresToReport = [...active.pendingWriteFailures];
    if (failuresToReport.length > 0) active.session.hasError = true;
    const failureEntries = pendingFailureEntries(
      active,
      failuresToReport,
      entries[0]?.occurredAt ?? nowIso(),
    );
    const allEntries = [...entries, ...failureEntries];
    active.session.entryCount = Math.max(active.session.entryCount, active.nextSequence);
    active.session.lastActivityAt = allEntries[allEntries.length - 1]?.observedAt ?? nowIso();
    try {
      await getWeeklyPlanningTraceRepository().appendEntries({
        session: { ...active.session },
        entries: allEntries,
      });
      if (failuresToReport.length > 0) {
        const persistedFailureIds = new Set(failuresToReport.map((failure) => failure.id));
        active.pendingWriteFailures = active.pendingWriteFailures.filter(
          (failure) => !persistedFailureIds.has(failure.id),
        );
      }
    } catch (error) {
      active.session.hasError = true;
      if (requestIdForRetry) active.requestIds.delete(requestIdForRetry);
      const failure: PendingWriteFailure = {
        id: `${active.session.id}:write-failure:${active.nextWriteFailureSequence++}`,
        failedAt: nowIso(),
        errorCode: finiteErrorCode(error),
      };
      active.pendingWriteFailures = [
        ...active.pendingWriteFailures,
        failure,
      ].slice(-MAX_PENDING_WRITE_FAILURES);
      console.warn('[WeeklyPlanningTrace] write failed', {
        sessionId: active.session.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  active.writeQueue = operation;
  await operation;
}

function pipelineEventEntries(params: {
  active: ActiveTraceSession;
  output: WeeklyPlanningBehaviorAwarePipelineOutput;
  requestId: string;
  occurredAt: string;
  stateRevision: number;
}): WeeklyPlanningTraceEntry[] {
  const { active, output, requestId, occurredAt, stateRevision } = params;
  const entries: WeeklyPlanningTraceEntry[] = [];
  const diagnostics = output.interpreterDiagnostics;
  if (diagnostics) {
    entries.push(eventEntry(active, {
      eventType: 'interpreter_started',
      payload: { previousStateRevision: Math.max(0, stateRevision - 1) },
      requestId,
      stateRevision: Math.max(0, stateRevision - 1),
      occurredAt,
      severity: 'debug',
    }));
    entries.push(eventEntry(active, {
      eventType: 'interpreter_completed',
      payload: {
        acceptedCount: diagnostics.accepted.length,
        acceptedWithConfirmationCount: diagnostics.acceptedWithConfirmation.length,
        rejectedCount: diagnostics.rejected.length,
        clarificationRequestCount: diagnostics.clarificationRequests.length,
        parseRejections: diagnostics.parseRejections,
      },
      requestId,
      stateRevision,
      occurredAt,
    }));
    diagnostics.accepted.forEach((command) => entries.push(eventEntry(active, {
      eventType: 'candidate_accepted',
      payload: command,
      requestId,
      stateRevision,
      occurredAt,
    })));
    diagnostics.rejected.forEach((rejection) => entries.push(eventEntry(active, {
      eventType: 'candidate_rejected',
      payload: rejection,
      requestId,
      stateRevision,
      occurredAt,
      severity: 'warn',
    })));
  }

  output.assumptionProposalDiagnostics?.accepted.forEach((proposal) => entries.push(eventEntry(active, {
    eventType: 'assumption_proposed',
    payload: proposal,
    requestId,
    stateRevision,
    occurredAt,
  })));
  output.assumptionProposalDiagnostics?.rejected.forEach((rejection) => entries.push(eventEntry(active, {
    eventType: 'assumption_rejected',
    payload: rejection,
    requestId,
    stateRevision,
    occurredAt,
    severity: 'warn',
  })));

  if (output.lifecycleDiagnostics) {
    if (output.lifecycleDiagnostics.acceptedDecisionCount > 0) {
      entries.push(eventEntry(active, {
        eventType: 'assumption_accepted',
        payload: { count: output.lifecycleDiagnostics.acceptedDecisionCount },
        requestId,
        stateRevision,
        occurredAt,
      }));
    }
    output.lifecycleDiagnostics.rejectedDecisions.forEach((rejection) => entries.push(eventEntry(active, {
      eventType: 'assumption_rejected',
      payload: rejection,
      requestId,
      stateRevision,
      occurredAt,
      severity: 'warn',
    })));
    if (output.lifecycleDiagnostics.acceptedCorrectionCount > 0) {
      entries.push(eventEntry(active, {
        eventType: 'correction_applied',
        payload: { count: output.lifecycleDiagnostics.acceptedCorrectionCount },
        requestId,
        stateRevision,
        occurredAt,
      }));
    }
    output.lifecycleDiagnostics.rejectedCorrections.forEach((rejection) => entries.push(eventEntry(active, {
      eventType: 'correction_rejected',
      payload: rejection,
      requestId,
      stateRevision,
      occurredAt,
      severity: 'warn',
    })));
  }

  entries.push(eventEntry(active, {
    eventType: 'readiness_evaluated',
    payload: output.behavior.snapshot.readiness,
    requestId,
    stateRevision,
    occurredAt,
  }));
  entries.push(eventEntry(active, {
    eventType: 'feasibility_evaluated',
    payload: output.feasibility,
    requestId,
    stateRevision,
    occurredAt,
  }));
  entries.push(eventEntry(active, {
    eventType: 'dialogue_planned',
    payload: {
      actionIds: output.behavior.actions.map((action) => action.actionId),
      decisionKind: output.decision.kind,
      responseSource: output.behaviorDialogue.source,
    },
    requestId,
    stateRevision,
    occurredAt,
  }));
  entries.push(eventEntry(active, {
    eventType: 'preview_gate_evaluated',
    payload: output.behavior.gate,
    requestId,
    stateRevision,
    occurredAt,
    severity: output.behavior.gate.allowed ? 'info' : 'debug',
  }));

  if (!output.behavior.gate.allowed) {
    const reason = String((output.behavior.gate as { reason?: unknown }).reason ?? '');
    if (reason.includes('stale')) {
      entries.push(eventEntry(active, {
        eventType: 'preview_rejected_stale',
        payload: output.behavior.gate,
        requestId,
        stateRevision,
        occurredAt,
        severity: 'warn',
      }));
    }
    if (reason.includes('pending') && reason.includes('assumption')) {
      entries.push(eventEntry(active, {
        eventType: 'preview_rejected_pending_assumption',
        payload: output.behavior.gate,
        requestId,
        stateRevision,
        occurredAt,
        severity: 'warn',
      }));
    }
  }

  const previewCount = output.draftCandidates?.length ?? 0;
  if (previewCount > 0) {
    active.session.hasPreview = true;
    const previewId = `behavior-preview:${stateRevision}`;
    conversationIdByPreviewKey.set(
      `${active.session.userId}:${previewId}`,
      active.session.logicalConversationId,
    );
    entries.push(eventEntry(active, {
      eventType: 'preview_generated',
      payload: {
        previewId,
        candidateCount: previewCount,
        scheduledMinutes: output.feasibility.scheduledMinutes,
        unscheduledMinutes: output.feasibility.unscheduledMinutes,
      },
      requestId,
      stateRevision,
      occurredAt,
    }));
  }

  entries.push(snapshotEntry(active, {
    state: output.state,
    requestId,
    stateRevision,
    occurredAt,
    reason: previewCount > 0 ? 'preview_generated' : 'turn_completed',
  }));
  return entries;
}

function behaviorResponseSource(
  output: WeeklyPlanningBehaviorAwarePipelineOutput,
  options: WeeklyPlanningBehaviorAwarePipelineOptions,
): WeeklyPlanningTraceResponseSource {
  if (output.behaviorDialogue.source === 'ai') return 'ai';
  if (options.useAiDialoguePlanner || options.dialoguePlanner) return 'deterministic_fallback';
  return 'rules';
}

export function recordWeeklyPlanningPipelineTrace(params: {
  input: WeeklyPlanningIntakePipelineInput;
  options: WeeklyPlanningBehaviorAwarePipelineOptions;
  output: WeeklyPlanningBehaviorAwarePipelineOutput;
}): void {
  if (!isWeeklyPlanningTraceEnabled()) return;
  const userId = resolveTraceUserId(params.options.userId);
  if (!userId) return;
  const occurredAt = nowIso();
  const logicalConversationId = resolveLogicalConversationId({
    input: params.input,
    options: params.options,
  });
  const active = ensureActiveSession({
    userId,
    logicalConversationId,
    planningRangeStart: params.output.state.range?.startDateTime ?? params.input.planningStartDate,
    planningRangeEnd: params.output.state.range?.endDateTime,
    now: occurredAt,
  });
  if (params.output.state && typeof params.output.state === 'object') {
    conversationIdsByState.set(params.output.state, logicalConversationId);
  }

  const stateRevision = params.output.behavior.snapshot.stateRevision;
    const previousRevision = Math.max(0, stateRevision - 1);
    const requestId = params.options.traceRequestId?.trim() || randomId('weekly-request');
    if (active.requestIds.has(requestId)) return;
    active.requestIds.add(requestId);
  const entries: WeeklyPlanningTraceEntry[] = [
    turnEntry(active, {
      role: 'user',
      content: params.input.userText,
      requestId,
      stateRevision: previousRevision,
      occurredAt,
    }),
    eventEntry(active, {
      eventType: 'user_turn_received',
      payload: {
        planningStartDate: params.input.planningStartDate,
        planningDayCount: params.input.planningDayCount,
        recentTurnCount: params.input.recentTurns?.length ?? 0,
      },
      requestId,
      stateRevision: previousRevision,
      occurredAt,
    }),
    ...pipelineEventEntries({ active, output: params.output, requestId, occurredAt, stateRevision }),
  ];

  if (params.output.state.examPrepScope) {
    active.pendingAssistantRequestId = requestId;
    active.pendingStateRevision = stateRevision;
  } else {
    const responseSource = behaviorResponseSource(params.output, params.options);
    if (responseSource === 'deterministic_fallback') {
      active.session.hasFallback = true;
      entries.push(eventEntry(active, {
        eventType: 'fallback_used',
        payload: { category: 'behavior_dialogue_fallback' },
        requestId,
        stateRevision,
        occurredAt,
        severity: 'warn',
      }));
    }
    entries.push(turnEntry(active, {
      role: 'assistant',
      content: params.output.behaviorDialogue.message,
      responseSource,
      requestId,
      stateRevision,
      occurredAt,
    }));
  }

  void appendBestEffort(active, entries, requestId);
}

function activeSessionForConversation(
  userId: string,
  logicalConversationId: string,
): [string, ActiveTraceSession] | null {
  const key = activeSessionKey(userId, logicalConversationId);
  const active = activeSessions.get(key);
  return active ? [key, active] : null;
}

function onlyActiveSessionForUser(userId: string): [string, ActiveTraceSession] | null {
  const candidates = Array.from(activeSessions.entries()).filter(
    ([, active]) => active.session.userId === userId && active.session.status === 'active',
  );
  return candidates.length === 1 ? candidates[0] : null;
}

function payloadRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
}

function correlatedSession(params: {
  userId: string;
  logicalConversationId?: string;
  previewId?: string;
}): [string, ActiveTraceSession] | null {
  const explicit = params.logicalConversationId?.trim();
  if (explicit) return activeSessionForConversation(params.userId, explicit);
  const previewId = params.previewId?.trim();
  if (previewId) {
    const mapped = conversationIdByPreviewKey.get(`${params.userId}:${previewId}`);
    if (mapped) return activeSessionForConversation(params.userId, mapped);
  }
  return onlyActiveSessionForUser(params.userId);
}

export function recordWeeklyPlanningRenderedAssistantTurn(params: {
  content: string;
  responseSource: WeeklyPlanningTraceResponseSource;
  state?: object;
  logicalConversationId?: string;
  userId?: string;
}): void {
  if (!isWeeklyPlanningTraceEnabled()) return;
  const userId = resolveTraceUserId(params.userId);
  if (!userId) return;
  const stateConversationId = params.state ? conversationIdsByState.get(params.state) : undefined;
  const candidate = correlatedSession({
    userId,
    logicalConversationId: params.logicalConversationId ?? stateConversationId,
  });
  if (!candidate) return;
  const [, active] = candidate;
  if (!active.pendingAssistantRequestId) return;
  const occurredAt = nowIso();
  const requestId = active.pendingAssistantRequestId;
  const stateRevision = active.pendingStateRevision;
  active.pendingAssistantRequestId = undefined;
  active.pendingStateRevision = undefined;
  if (params.responseSource === 'deterministic_fallback') active.session.hasFallback = true;
  const entries: WeeklyPlanningTraceEntry[] = [turnEntry(active, {
    role: 'assistant',
    content: params.content,
    responseSource: params.responseSource,
    requestId,
    stateRevision,
    occurredAt,
  })];
  if (params.responseSource === 'deterministic_fallback') {
    entries.push(eventEntry(active, {
      eventType: 'fallback_used',
      payload: { category: 'dialogue_renderer_fallback' },
      requestId,
      stateRevision,
      occurredAt,
      severity: 'warn',
    }));
  }
  void appendBestEffort(active, entries);
}

export function recordWeeklyPlanningDraftPromotion(params: {
  userId: string;
  blocks: WeeklyPlanDraftBlock[];
}): void {
  if (!isWeeklyPlanningTraceEnabled() || params.blocks.length === 0) return;
  const metadata = params.blocks[0]?.behaviorMetadata?.previewMetadata;
  const previewId = metadata?.previewId?.trim();
  const candidate = correlatedSession({
    userId: params.userId,
    logicalConversationId: metadata?.conversationId,
    previewId,
  });
  if (!candidate) return;
  const [, active] = candidate;
  if (previewId) {
    conversationIdByPreviewKey.set(
      `${params.userId}:${previewId}`,
      active.session.logicalConversationId,
    );
  }
  const occurredAt = nowIso();
  void appendBestEffort(active, [eventEntry(active, {
    eventType: 'draft_promoted',
    payload: {
      blockCount: params.blocks.length,
      blockIds: params.blocks.map((block) => block.id),
      previewId,
    },
    stateRevision: metadata?.stateRevision,
    occurredAt,
  })]);
}

function approvalItemEntries(
  active: ActiveTraceSession,
  payload: unknown,
  occurredAt: string,
): WeeklyPlanningTraceInternalEventEntry[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const status = String(record.status ?? '');
    if (status === 'saved' || status === 'skipped_duplicate') {
      return [eventEntry(active, {
        eventType: 'approval_item_saved',
        payload: {
          sourceDraftBlockId: record.sourceDraftBlockId,
          savedPlanId: record.savedPlanId,
          status,
          duplicateSuppressed: status === 'skipped_duplicate',
        },
        occurredAt,
      })];
    }
    if (status === 'failed') {
      return [eventEntry(active, {
        eventType: 'approval_item_failed',
        payload: {
          sourceDraftBlockId: record.sourceDraftBlockId,
          errorCode: record.lastErrorCode ?? 'save-failed',
        },
        occurredAt,
        severity: 'error',
      })];
    }
    return [];
  });
}

export function recordWeeklyPlanningApprovalTrace(params: {
  userId: string;
  phase: 'started' | 'completed';
  payload: unknown;
  failed?: boolean;
  logicalConversationId?: string;
}): void {
  if (!isWeeklyPlanningTraceEnabled()) return;
  const record = payloadRecord(params.payload);
  const previewId = typeof record.previewId === 'string' ? record.previewId : undefined;
  const payloadConversationId = typeof record.logicalConversationId === 'string'
    ? record.logicalConversationId
    : typeof record.conversationId === 'string'
      ? record.conversationId
      : undefined;
  const candidate = correlatedSession({
    userId: params.userId,
    logicalConversationId: params.logicalConversationId ?? payloadConversationId,
    previewId,
  });
  if (!candidate) return;
  const [, active] = candidate;
  const occurredAt = nowIso();
  const eventType = params.phase === 'started' ? 'approval_started' : 'approval_completed';
  if (params.failed) {
    active.session.hasApprovalFailure = true;
    active.session.hasError = true;
  }
  if (params.phase === 'completed' && !params.failed) {
    active.session.status = 'completed';
    active.session.endedAt = occurredAt;
  }
  const entries: WeeklyPlanningTraceEntry[] = [eventEntry(active, {
    eventType,
    payload: params.payload,
    occurredAt,
    severity: params.failed ? 'error' : 'info',
  })];
  if (params.phase === 'completed') {
    entries.push(...approvalItemEntries(active, params.payload, occurredAt));
  }
  void appendBestEffort(active, entries);
}

export function resetWeeklyPlanningTraceRuntimeForTests(): void {
  activeSessions.clear();
  conversationIdByPreviewKey.clear();
  conversationIdsByState = new WeakMap<object, string>();
  traceContextByInput = new WeakMap<object, TraceRequestContext>();
}
