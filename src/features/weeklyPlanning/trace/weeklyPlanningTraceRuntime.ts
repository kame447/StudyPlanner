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

const TRACE_RETENTION_DAYS = 90;
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

interface ActiveTraceSession {
  session: WeeklyPlanningTraceSession;
  nextSequence: number;
  nextTurnIndex: number;
  lastActivityMs: number;
  pendingAssistantRequestId?: string;
  pendingStateRevision?: number;
}

const activeSessions = new Map<string, ActiveTraceSession>();
let lastActiveSessionKey: string | undefined;

function nowIso(): string {
  return new Date().toISOString();
}

function expireAt(now: string): string {
  return new Date(new Date(now).getTime() + TRACE_RETENTION_DAYS * 86400000).toISOString();
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
      expireAt: expireAt(params.now),
    },
    nextSequence: 0,
    nextTurnIndex: 0,
    lastActivityMs: new Date(params.now).getTime(),
  };
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
    existing.session.expireAt = expireAt(params.now);
    if (params.planningRangeStart) existing.session.planningRangeStart = params.planningRangeStart;
    if (params.planningRangeEnd) existing.session.planningRangeEnd = params.planningRangeEnd;
    lastActiveSessionKey = key;
    return existing;
  }

  const created = createSession(params);
  activeSessions.set(key, created);
  lastActiveSessionKey = key;
  return created;
}

function entryId(sessionId: string, sequence: number): string {
  return `${sessionId}-${String(sequence).padStart(8, '0')}`;
}

function commonEntry(
  active: ActiveTraceSession,
  params: { requestId?: string; stateRevision?: number; occurredAt: string },
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
    expireAt: active.session.expireAt,
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
    payload: sanitizeWeeklyPlanningTraceValue(params.payload).value,
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
    ...commonEntry(active, params),
    kind: 'state_snapshot',
    snapshotReason: params.reason,
    state: sanitizeWeeklyPlanningTraceValue(params.state).value,
  };
}

async function appendBestEffort(
  active: ActiveTraceSession,
  entries: WeeklyPlanningTraceEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  active.session.entryCount = Math.max(active.session.entryCount, active.nextSequence);
  active.session.lastActivityAt = entries[entries.length - 1]?.observedAt ?? nowIso();
  try {
    await getWeeklyPlanningTraceRepository().appendEntries({
      session: { ...active.session },
      entries,
    });
  } catch (error) {
    console.warn('[WeeklyPlanningTrace] write failed', {
      sessionId: active.session.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
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

  const previewCount = output.draftCandidates?.length ?? 0;
  if (previewCount > 0) {
    active.session.hasPreview = true;
    entries.push(eventEntry(active, {
      eventType: 'preview_generated',
      payload: {
        previewId: `behavior-preview:${stateRevision}`,
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

export function recordWeeklyPlanningPipelineTrace(params: {
  input: WeeklyPlanningIntakePipelineInput;
  options: WeeklyPlanningBehaviorAwarePipelineOptions;
  output: WeeklyPlanningBehaviorAwarePipelineOutput;
}): void {
  if (!isWeeklyPlanningTraceEnabled()) return;
  const userId = resolveTraceUserId(params.options.userId);
  if (!userId) return;
  const occurredAt = nowIso();
  const logicalConversationId = params.options.conversationId?.trim() || 'weekly-planning-session';
  const active = ensureActiveSession({
    userId,
    logicalConversationId,
    planningRangeStart: params.output.state.range?.startDateTime ?? params.input.planningStartDate,
    planningRangeEnd: params.output.state.range?.endDateTime,
    now: occurredAt,
  });
  const requestId = randomId('weekly-request');
  const stateRevision = params.output.behavior.snapshot.stateRevision;
  const entries: WeeklyPlanningTraceEntry[] = [
    turnEntry(active, {
      role: 'user',
      content: params.input.userText,
      requestId,
      stateRevision: Math.max(0, stateRevision - 1),
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
      stateRevision: Math.max(0, stateRevision - 1),
      occurredAt,
    }),
    ...pipelineEventEntries({ active, output: params.output, requestId, occurredAt, stateRevision }),
  ];

  if (params.output.state.examPrepScope) {
    active.pendingAssistantRequestId = requestId;
    active.pendingStateRevision = stateRevision;
  } else {
    entries.push(turnEntry(active, {
      role: 'assistant',
      content: params.output.behaviorDialogue.message,
      responseSource: params.options.useAiDialoguePlanner ? 'ai' : 'rules',
      requestId,
      stateRevision,
      occurredAt,
    }));
  }

  void appendBestEffort(active, entries);
}

export function recordWeeklyPlanningRenderedAssistantTurn(
  content: string,
  responseSource: WeeklyPlanningTraceResponseSource,
): void {
  if (!isWeeklyPlanningTraceEnabled() || !lastActiveSessionKey) return;
  const active = activeSessions.get(lastActiveSessionKey);
  if (!active?.pendingAssistantRequestId) return;
  const occurredAt = nowIso();
  const requestId = active.pendingAssistantRequestId;
  const stateRevision = active.pendingStateRevision;
  active.pendingAssistantRequestId = undefined;
  active.pendingStateRevision = undefined;
  if (responseSource === 'deterministic_fallback') active.session.hasFallback = true;
  void appendBestEffort(active, [turnEntry(active, {
    role: 'assistant',
    content,
    responseSource,
    requestId,
    stateRevision,
    occurredAt,
  }), ...(responseSource === 'deterministic_fallback'
    ? [eventEntry(active, {
        eventType: 'fallback_used',
        payload: { category: 'dialogue_renderer_fallback' },
        requestId,
        stateRevision,
        occurredAt,
        severity: 'warn',
      })]
    : [])]);
}

export function recordWeeklyPlanningDraftPromotion(params: {
  userId: string;
  blocks: WeeklyPlanDraftBlock[];
}): void {
  if (!isWeeklyPlanningTraceEnabled()) return;
  const candidates = Array.from(activeSessions.entries())
    .filter(([, active]) => active.session.userId === params.userId)
    .sort(([, left], [, right]) => right.lastActivityMs - left.lastActivityMs);
  const [key, active] = candidates[0] ?? [];
  if (!key || !active || params.blocks.length === 0) return;
  lastActiveSessionKey = key;
  const occurredAt = nowIso();
  const metadata = params.blocks[0]?.behaviorMetadata?.previewMetadata;
  void appendBestEffort(active, [eventEntry(active, {
    eventType: 'draft_promoted',
    payload: {
      blockCount: params.blocks.length,
      blockIds: params.blocks.map((block) => block.id),
      previewId: metadata?.previewId,
    },
    stateRevision: metadata?.stateRevision,
    occurredAt,
  })]);
}

export function recordWeeklyPlanningApprovalTrace(params: {
  userId: string;
  phase: 'started' | 'completed';
  payload: unknown;
  failed?: boolean;
}): void {
  if (!isWeeklyPlanningTraceEnabled()) return;
  const candidates = Array.from(activeSessions.entries())
    .filter(([, active]) => active.session.userId === params.userId)
    .sort(([, left], [, right]) => right.lastActivityMs - left.lastActivityMs);
  const [key, active] = candidates[0] ?? [];
  if (!key || !active) return;
  lastActiveSessionKey = key;
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
  void appendBestEffort(active, [eventEntry(active, {
    eventType,
    payload: params.payload,
    occurredAt,
    severity: params.failed ? 'error' : 'info',
  })]);
}

export function resetWeeklyPlanningTraceRuntimeForTests(): void {
  activeSessions.clear();
  lastActiveSessionKey = undefined;
}
