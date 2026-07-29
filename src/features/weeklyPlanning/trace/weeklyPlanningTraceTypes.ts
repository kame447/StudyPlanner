import {
  WEEKLY_PLANNING_TRACE_EVENT_TYPES,
  type WeeklyPlanningTraceEventTypeContract,
} from '../../../../shared/weeklyPlanningTraceContract';

export const WEEKLY_PLANNING_TRACE_SCHEMA_VERSION = 2;
export const WEEKLY_PLANNING_TRACE_LEGACY_SCHEMA_VERSION = 1;

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

export type WeeklyPlanningTraceEventType = WeeklyPlanningTraceEventTypeContract;
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
  archivedAt?: string;
  archivedEntryCount?: number;
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
  sequence: number;
  requestId?: string;
  occurredAt: string;
  observedAt: string;
  schemaVersion: number;
  expireAt: string;
  logicalConversationId?: string;
  userId?: string;
  stateRevision?: number;
}

interface WeeklyPlanningTraceLegacyEntryBase extends WeeklyPlanningTraceEntryBase {
  logicalConversationId: string;
  userId: string;
}

export interface WeeklyPlanningTraceTurnEntry extends WeeklyPlanningTraceLegacyEntryBase {
  kind: 'turn';
  role: 'user' | 'assistant';
  content: string;
  turnIndex: number;
  responseSource?: WeeklyPlanningTraceResponseSource;
}

export interface WeeklyPlanningTraceInternalEventEntry extends WeeklyPlanningTraceLegacyEntryBase {
  kind: 'internal_event';
  eventType: WeeklyPlanningTraceEventType;
  payload: unknown;
  severity: WeeklyPlanningTraceSeverity;
}

export interface WeeklyPlanningTraceStateSnapshotEntry extends WeeklyPlanningTraceLegacyEntryBase {
  kind: 'state_snapshot';
  snapshotReason: WeeklyPlanningTraceSnapshotReason;
  state: unknown;
}

export interface WeeklyPlanningTraceAiRequest {
  attempt: string;
  messages: Array<{ role: string; content: string }>;
  purpose: string | null;
  responseFormat: unknown;
  maxCompletionTokens: number | null;
  requestBytes: number | null;
}

export interface WeeklyPlanningTraceAiRawResponse {
  attempt: string;
  text: string;
  originalBytes?: number;
  truncated?: boolean;
  checksum?: string | null;
}

export interface WeeklyPlanningTraceAiValidationResult {
  attempt: string;
  accepted: boolean;
  errors: string[];
  structuredResult: unknown;
}

export interface WeeklyPlanningTraceParserDecision {
  parser: string;
  inputText: string | null;
  matchedText: string | null;
  candidateOperation: unknown;
  accepted: boolean;
  reason: string | null;
}

export interface WeeklyPlanningTraceRejectedOperation {
  operation: unknown;
  reason: string;
}

export interface WeeklyPlanningTraceRelevantBusyInterval {
  date: string;
  start: string;
  end: string;
  source: string;
}

export interface WeeklyPlanningTraceSchedulerSourceSummary {
  kind: string;
  status: string;
  failureKind: string | null;
  eventCount: number;
}

export interface WeeklyPlanningTraceSchedulerIssueSummary {
  code: string | null;
  domain: string | null;
  factId: string | null;
  blocking: boolean;
}

export interface WeeklyPlanningTraceSchedulerSummary {
  selectedDate: string | null;
  timeZone: string | null;
  planningHorizon: unknown;
  externalSources: WeeklyPlanningTraceSchedulerSourceSummary[];
  compilationStatus: string | null;
  issues: WeeklyPlanningTraceSchedulerIssueSummary[];
  dialogueStatus: string | null;
  selectedQuestionCode: string | null;
  preview: {
    schedulerVersion: string | null;
    status: string | null;
    candidateCount: number;
    unscheduledCount: number;
    representativeCandidates: unknown[];
  } | null;
  duplicateSuppressed: boolean;
}

export interface WeeklyPlanningTraceTruncationMetadata {
  applied: boolean;
  fields: string[];
  originalCounts: Record<string, number>;
}

export interface WeeklyPlanningTraceTurnDiagnosticEntry extends WeeklyPlanningTraceEntryBase {
  kind: 'turn_diagnostic';
  traceSchema: 'weekly-planning-turn-diagnostic-v2';
  turnIndex: number;
  userInput: {
    text: string;
  };
  aiInterpreter: {
    provider: string | null;
    model: string | null;
    promptVersion: string | null;
    input: {
      userText: string;
      conversationContext: Array<{ role: string; content: string }>;
      planningStateSummary: unknown;
      requests: WeeklyPlanningTraceAiRequest[];
    };
    rawResponses: WeeklyPlanningTraceAiRawResponse[];
    structuredResults: WeeklyPlanningTraceAiValidationResult[];
    candidateOperations: unknown[];
    error: {
      type: string;
      message: string;
    } | null;
  };
  parsers: WeeklyPlanningTraceParserDecision[];
  decision: {
    status: string;
    acceptedOperations: unknown[];
    rejectedOperations: WeeklyPlanningTraceRejectedOperation[];
    finalOperations: unknown[];
    precedence: string | null;
    reason: string | null;
    stateDiff: unknown;
  };
  constraintContext: {
    existingPlanCount: number;
    scheduleTemplateCount: number;
    relevantBusyIntervals: WeeklyPlanningTraceRelevantBusyInterval[];
    scheduler?: WeeklyPlanningTraceSchedulerSummary;
  };
  assistantOutput: {
    text: string | null;
    responseSource: WeeklyPlanningTraceResponseSource;
  };
  diagnostics: {
    durationMs: number | null;
    fallback: string | null;
    error: {
      type: string;
      message: string;
    } | null;
    outcome: string;
    previewCount: number;
    stale: boolean;
    truncation?: WeeklyPlanningTraceTruncationMetadata;
  };
}

export type WeeklyPlanningTraceEntry =
  | WeeklyPlanningTraceTurnEntry
  | WeeklyPlanningTraceInternalEventEntry
  | WeeklyPlanningTraceStateSnapshotEntry
  | WeeklyPlanningTraceTurnDiagnosticEntry;

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

export interface WeeklyPlanningTraceAdminDiagnostics {
  rawCount: number;
  mappedCount: number;
  malformedCount: number;
  activityCount: number;
  emptyCount: number;
  unexportedCount: number;
}

export interface WeeklyPlanningTraceAdminSessionResult {
  sessions: WeeklyPlanningTraceSession[];
  diagnostics: WeeklyPlanningTraceAdminDiagnostics;
}

export interface WeeklyPlanningTraceRepository {
  upsertSession(session: WeeklyPlanningTraceSession): Promise<void>;
  appendEntries(params: {
    session: WeeklyPlanningTraceSession;
    entries: WeeklyPlanningTraceEntry[];
  }): Promise<void>;
  listSessions(userId: string): Promise<WeeklyPlanningTraceSession[]>;
  listSessionsForAdmin(): Promise<WeeklyPlanningTraceSession[]>;
  listSessionsForAdminWithDiagnostics?(): Promise<WeeklyPlanningTraceAdminSessionResult>;
  archiveSessionForAdmin(sessionId: string, archivedAt: string): Promise<void>;
  getSession(userId: string, sessionId: string): Promise<WeeklyPlanningTraceSession | null>;
  listEntries(userId: string, sessionId: string): Promise<WeeklyPlanningTraceEntry[]>;
}

const EVENT_TYPES = new Set<WeeklyPlanningTraceEventType>(
  WEEKLY_PLANNING_TRACE_EVENT_TYPES,
);

const SNAPSHOT_REASONS = new Set<WeeklyPlanningTraceSnapshotReason>([
  'turn_completed',
  'correction_applied',
  'preview_generated',
  'approval_started',
  'approval_completed',
  'error',
  'manual_capture',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStringMessageArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => isRecord(item)
    && typeof item.role === 'string'
    && typeof item.content === 'string');
}

function hasValidBase(record: Record<string, unknown>): boolean {
  return typeof record.id === 'string'
    && typeof record.sessionId === 'string'
    && Number.isInteger(record.sequence)
    && typeof record.occurredAt === 'string'
    && typeof record.observedAt === 'string'
    && Number.isInteger(record.schemaVersion)
    && typeof record.expireAt === 'string'
    && (record.logicalConversationId === undefined
      || typeof record.logicalConversationId === 'string')
    && (record.userId === undefined || typeof record.userId === 'string')
    && (record.requestId === undefined || typeof record.requestId === 'string')
    && (record.stateRevision === undefined || Number.isInteger(record.stateRevision));
}

function hasValidLegacyBase(record: Record<string, unknown>): boolean {
  return typeof record.logicalConversationId === 'string'
    && typeof record.userId === 'string';
}

function isTurnDiagnostic(record: Record<string, unknown>): boolean {
  if (record.schemaVersion !== WEEKLY_PLANNING_TRACE_SCHEMA_VERSION
    || record.traceSchema !== 'weekly-planning-turn-diagnostic-v2'
    || !Number.isInteger(record.turnIndex)
    || Number(record.turnIndex) < 0
    || !isRecord(record.userInput)
    || typeof record.userInput.text !== 'string'
    || !isRecord(record.aiInterpreter)
    || !isRecord(record.aiInterpreter.input)
    || typeof record.aiInterpreter.input.userText !== 'string'
    || !isStringMessageArray(record.aiInterpreter.input.conversationContext)
    || !Array.isArray(record.aiInterpreter.input.requests)
    || !Array.isArray(record.aiInterpreter.rawResponses)
    || !Array.isArray(record.aiInterpreter.structuredResults)
    || !Array.isArray(record.aiInterpreter.candidateOperations)
    || !Array.isArray(record.parsers)
    || !isRecord(record.decision)
    || !Array.isArray(record.decision.acceptedOperations)
    || !Array.isArray(record.decision.rejectedOperations)
    || !Array.isArray(record.decision.finalOperations)
    || !isRecord(record.constraintContext)
    || !Number.isInteger(record.constraintContext.existingPlanCount)
    || !Number.isInteger(record.constraintContext.scheduleTemplateCount)
    || !Array.isArray(record.constraintContext.relevantBusyIntervals)
    || !isRecord(record.assistantOutput)
    || (record.assistantOutput.text !== null
      && typeof record.assistantOutput.text !== 'string')
    || !isRecord(record.diagnostics)
    || typeof record.diagnostics.outcome !== 'string'
    || !Number.isInteger(record.diagnostics.previewCount)
    || typeof record.diagnostics.stale !== 'boolean') {
    return false;
  }
  return true;
}

export function isWeeklyPlanningTraceEntry(value: unknown): value is WeeklyPlanningTraceEntry {
  if (!isRecord(value)) return false;
  const record = value;
  if (!hasValidBase(record)) return false;

  if (record.kind === 'turn_diagnostic') return isTurnDiagnostic(record);
  if (!hasValidLegacyBase(record)) return false;

  if (record.kind === 'turn') {
    const validSource = record.responseSource === 'ai'
      || record.responseSource === 'deterministic_fallback'
      || record.responseSource === 'rules'
      || record.responseSource === 'system';
    return (record.role === 'user' || record.role === 'assistant')
      && typeof record.content === 'string'
      && Number.isInteger(record.turnIndex)
      && Number(record.turnIndex) >= 0
      && (record.role === 'assistant' ? validSource : record.responseSource === undefined);
  }

  if (record.kind === 'internal_event') {
    return Object.prototype.hasOwnProperty.call(record, 'payload')
      && record.payload !== undefined
      && typeof record.eventType === 'string'
      && EVENT_TYPES.has(record.eventType as WeeklyPlanningTraceEventType)
      && (record.severity === 'debug'
        || record.severity === 'info'
        || record.severity === 'warn'
        || record.severity === 'error');
  }

  if (record.kind === 'state_snapshot') {
    return Object.prototype.hasOwnProperty.call(record, 'state')
      && record.state !== undefined
      && typeof record.snapshotReason === 'string'
      && SNAPSHOT_REASONS.has(record.snapshotReason as WeeklyPlanningTraceSnapshotReason);
  }

  return false;
}
