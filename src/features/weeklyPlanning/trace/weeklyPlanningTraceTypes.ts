export const WEEKLY_PLANNING_TRACE_SCHEMA_VERSION = 1;

export type WeeklyPlanningTraceSessionStatus =
  | 'active'
  | 'completed'
  | 'abandoned'
  | 'failed';

export type WeeklyPlanningTraceResponseSource =
  | 'ai'
  | 'deterministic_fallback'
  | 'rules'
  | 'system';

export type WeeklyPlanningTraceEventType =
  | 'user_turn_received'
  | 'interpreter_completed'
  | 'candidate_accepted'
  | 'candidate_rejected'
  | 'assumption_proposed'
  | 'assumption_accepted'
  | 'assumption_rejected'
  | 'assumption_superseded'
  | 'correction_applied'
  | 'correction_rejected'
  | 'readiness_evaluated'
  | 'feasibility_evaluated'
  | 'dialogue_planned'
  | 'fallback_used'
  | 'preview_gate_evaluated'
  | 'preview_generated'
  | 'draft_promoted'
  | 'approval_started'
  | 'approval_item_saved'
  | 'approval_item_failed'
  | 'approval_completed'
  | 'stale_async_result_discarded'
  | 'trace_write_failed';

export type WeeklyPlanningTraceSeverity = 'debug' | 'info' | 'warn' | 'error';

export type WeeklyPlanningTraceSnapshotReason =
  | 'turn_completed'
  | 'correction_applied'
  | 'preview_generated'
  | 'approval_started'
  | 'approval_completed'
  | 'error'
  | 'manual_capture';

export interface WeeklyPlanningTraceSession {
  id: string;
  logicalConversationId: string;
  userId: string;
  status: WeeklyPlanningTraceSessionStatus;
  startedAt: string;
  lastActivityAt: string;
  endedAt?: string;
  planningRangeStart?: string;
  planningRangeEnd?: string;
  turnCount: number;
  entryCount: number;
  hasPreview: boolean;
  hasApprovalFailure: boolean;
  hasFallback: boolean;
  hasError: boolean;
  appVersion: string;
  schemaVersion: number;
  expireAt: string;
}

interface WeeklyPlanningTraceEntryBase {
  id: string;
  sessionId: string;
  logicalConversationId: string;
  userId: string;
  sequence: number;
  requestId?: string;
  stateRevision?: number;
  occurredAt: string;
  observedAt: string;
  schemaVersion: number;
  expireAt: string;
}

export interface WeeklyPlanningTraceTurnEntry extends WeeklyPlanningTraceEntryBase {
  kind: 'turn';
  role: 'user' | 'assistant';
  content: string;
  turnIndex: number;
  responseSource?: WeeklyPlanningTraceResponseSource;
}

export interface WeeklyPlanningTraceInternalEventEntry extends WeeklyPlanningTraceEntryBase {
  kind: 'internal_event';
  eventType: WeeklyPlanningTraceEventType;
  payload: unknown;
  severity: WeeklyPlanningTraceSeverity;
}

export interface WeeklyPlanningTraceStateSnapshotEntry extends WeeklyPlanningTraceEntryBase {
  kind: 'state_snapshot';
  snapshotReason: WeeklyPlanningTraceSnapshotReason;
  state: unknown;
}

export type WeeklyPlanningTraceEntry =
  | WeeklyPlanningTraceTurnEntry
  | WeeklyPlanningTraceInternalEventEntry
  | WeeklyPlanningTraceStateSnapshotEntry;

export interface WeeklyPlanningTraceSessionPatch {
  status?: WeeklyPlanningTraceSessionStatus;
  lastActivityAt: string;
  endedAt?: string;
  planningRangeStart?: string;
  planningRangeEnd?: string;
  turnCount: number;
  entryCount: number;
  hasPreview: boolean;
  hasApprovalFailure: boolean;
  hasFallback: boolean;
  hasError: boolean;
}

export interface WeeklyPlanningTraceRepository {
  upsertSession(session: WeeklyPlanningTraceSession): Promise<void>;
  appendEntries(params: {
    session: WeeklyPlanningTraceSession;
    entries: WeeklyPlanningTraceEntry[];
  }): Promise<void>;
  listSessions(userId: string): Promise<WeeklyPlanningTraceSession[]>;
  listSessionsForAdmin(): Promise<WeeklyPlanningTraceSession[]>;
  getSession(userId: string, sessionId: string): Promise<WeeklyPlanningTraceSession | null>;
  listEntries(userId: string, sessionId: string): Promise<WeeklyPlanningTraceEntry[]>;
}

export function isWeeklyPlanningTraceEntry(value: unknown): value is WeeklyPlanningTraceEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string'
    || typeof record.sessionId !== 'string'
    || typeof record.userId !== 'string'
    || !Number.isInteger(record.sequence)
    || typeof record.occurredAt !== 'string') {
    return false;
  }

  if (record.kind === 'turn') {
    return (record.role === 'user' || record.role === 'assistant')
      && typeof record.content === 'string'
      && Number.isInteger(record.turnIndex);
  }

  if (record.kind === 'internal_event') {
    return typeof record.eventType === 'string'
      && ['debug', 'info', 'warn', 'error'].includes(String(record.severity));
  }

  if (record.kind === 'state_snapshot') {
    return typeof record.snapshotReason === 'string';
  }

  return false;
}
