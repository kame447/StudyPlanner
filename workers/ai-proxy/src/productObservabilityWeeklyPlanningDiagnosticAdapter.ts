import {
  WEEKLY_PLANNING_TRACE_ADMIN_ENTRY_PAGING,
} from '../../../shared/weeklyPlanningTraceContract';
import {
  OBSERVABILITY_DEBUG_BUNDLE_SCHEMA,
  OBSERVABILITY_DEBUG_BUNDLE_SCHEMA_VERSION,
  type ObservabilityDebugBundleV1,
  type ObservabilityLogEntryPage,
  type ObservabilityLogEntryProjection,
  type ObservabilityLogSessionSummary,
  type ObservabilityLogSeverity,
} from '../../../shared/productObservabilityLogReadModel';
import type { FirestoreOrderedCursor } from './firestoreServiceAccountClient';
import { WeeklyPlanningTraceFirestoreClient } from './weeklyPlanningTraceFirestore';
import { loadWeeklyPlanningTraceAdminEntryPage } from './weeklyPlanningTraceAdminEntriesPage';
import { safeWeeklyPlanningTraceDocumentsForAdmin } from './weeklyPlanningTraceApi';
import {
  createWeeklyPlanningTraceSubject,
  isWeeklyPlanningLegacyTraceSessionHandle,
  isWeeklyPlanningTraceSessionId,
  parseWeeklyPlanningTraceHmacSecrets,
  resolveWeeklyPlanningTraceEpoch,
  weeklyPlanningTraceExpireAt,
} from './weeklyPlanningTracePrivacy';

const TRACE_SESSIONS = 'weekly_planning_trace_sessions';
const TRACE_ENTRIES = 'weekly_planning_trace_entries';
const TRACE_ACCESS_AUDIT = 'weekly_planning_trace_access_audit';
const ADMINS = 'admins';
const MAX_SESSION_PAGE_SIZE = 50;
const DEBUG_BUNDLE_ENTRY_LIMIT = 200;
const DEBUG_BUNDLE_SCAN_LIMIT = 200;
const DEBUG_BUNDLE_BYTE_LIMIT = 512 * 1024;
const SESSION_STATUSES = new Set(['active', 'completed', 'abandoned', 'failed']);

export interface ProductObservabilityWeeklyPlanningDiagnosticEnv {
  FIREBASE_PROJECT_ID: string;
  FIREBASE_SERVICE_ACCOUNT_EMAIL: string;
  FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: string;
  WEEKLY_PLANNING_TRACE_HMAC_SECRETS?: string;
}

export interface ObservabilityDiagnosticSessionPageInternal {
  sessions: ObservabilityLogSessionSummary[];
  nextCursor: FirestoreOrderedCursor | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function integer(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : fallback;
}

function severityForSession(value: Record<string, unknown>): ObservabilityLogSeverity {
  if (value.hasError === true) return 'error';
  if (value.hasApprovalFailure === true || value.hasFallback === true) return 'warn';
  return 'info';
}

function severityForEntry(value: Record<string, unknown>): ObservabilityLogSeverity {
  if (value.kind === 'internal_event') {
    const severity = value.severity;
    if (severity === 'debug' || severity === 'info' || severity === 'warn' || severity === 'error') {
      return severity;
    }
  }
  if (value.kind === 'turn_diagnostic' && isRecord(value.diagnostics)) {
    if (value.diagnostics.error) return 'error';
    if (value.diagnostics.fallback || value.diagnostics.stale === true) return 'warn';
  }
  return 'info';
}

function sessionSummary(value: Record<string, unknown>): string {
  const signals: string[] = [];
  if (value.hasError === true) signals.push('error');
  if (value.hasFallback === true) signals.push('fallback');
  if (value.hasApprovalFailure === true) signals.push('approval failure');
  if (value.hasPreview === true) signals.push('preview reached');
  return signals.length > 0 ? signals.join(' · ') : 'diagnostic trace available';
}

function safeSession(document: Record<string, unknown>): Record<string, unknown> | null {
  return safeWeeklyPlanningTraceDocumentsForAdmin([document])[0] ?? null;
}

export function createObservabilityLogSessionSummary(
  document: Record<string, unknown>,
): ObservabilityLogSessionSummary | null {
  const safe = safeSession(document);
  if (!safe) return null;
  const traceSessionId = text(safe.id);
  const startedAt = text(safe.startedAt);
  const lastActivityAt = text(safe.lastActivityAt);
  if (!traceSessionId || !startedAt || !lastActivityAt) return null;
  return {
    source: 'weekly_planning_trace',
    traceSessionId,
    subjectAlias: text(safe.subjectAlias) ?? 'trace-subject',
    status: text(safe.status) ?? 'unknown',
    severity: severityForSession(safe),
    startedAt,
    lastActivityAt,
    endedAt: text(safe.endedAt),
    planningRangeStart: text(safe.planningRangeStart),
    planningRangeEnd: text(safe.planningRangeEnd),
    entryCount: integer(safe.entryCount),
    turnCount: integer(safe.turnCount),
    hasPreview: safe.hasPreview === true,
    hasApprovalFailure: safe.hasApprovalFailure === true,
    hasFallback: safe.hasFallback === true,
    hasError: safe.hasError === true,
    appVersion: text(safe.appVersion),
    traceSchemaVersion: typeof safe.schemaVersion === 'number' ? safe.schemaVersion : null,
    summary: sessionSummary(safe),
  };
}

function compactPayloadSummary(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  for (const key of ['status', 'category', 'reason', 'outcome']) {
    const value = text(payload[key]);
    if (value) return `${key}: ${value.slice(0, 96)}`;
  }
  return null;
}

function entryEventType(value: Record<string, unknown>): string {
  if (value.kind === 'turn_diagnostic') {
    const decision = isRecord(value.decision) ? text(value.decision.status) : null;
    return decision ? `turn_diagnostic:${decision}` : 'turn_diagnostic';
  }
  if (value.kind === 'internal_event') return text(value.eventType) ?? 'internal_event';
  if (value.kind === 'turn') return value.role === 'assistant' ? 'assistant_turn' : 'user_turn';
  if (value.kind === 'state_snapshot') {
    return `state_snapshot:${text(value.snapshotReason) ?? 'unknown'}`;
  }
  return text(value.kind) ?? 'trace_entry';
}

function entrySummary(value: Record<string, unknown>): string {
  if (value.kind === 'turn_diagnostic') {
    const turnIndex = integer(value.turnIndex);
    const diagnostics = isRecord(value.diagnostics) ? value.diagnostics : {};
    const outcome = text(diagnostics.outcome) ?? 'unknown outcome';
    return `turn ${turnIndex} · ${outcome}`;
  }
  if (value.kind === 'internal_event') {
    const eventType = text(value.eventType) ?? 'internal event';
    const payloadSummary = compactPayloadSummary(value.payload);
    return payloadSummary ? `${eventType} · ${payloadSummary}` : eventType;
  }
  if (value.kind === 'turn') {
    return value.role === 'assistant' ? 'Assistant output recorded' : 'User input recorded';
  }
  if (value.kind === 'state_snapshot') {
    return `State snapshot · ${text(value.snapshotReason) ?? 'unknown'}`;
  }
  return 'Diagnostic trace entry';
}

export function createObservabilityLogEntryProjection(
  document: Record<string, unknown>,
  fallbackSubjectAlias = 'trace-subject',
): ObservabilityLogEntryProjection | null {
  const safe = safeWeeklyPlanningTraceDocumentsForAdmin([document])[0];
  if (!safe) return null;
  const id = text(safe.id);
  const traceSessionId = text(safe.sessionId);
  const occurredAt = text(safe.occurredAt) ?? text(safe.observedAt);
  if (!id || !traceSessionId || !occurredAt) return null;
  return {
    id,
    source: 'weekly_planning_trace',
    feature: 'weekly_planning',
    occurredAt,
    severity: severityForEntry(safe),
    subjectAlias: text(safe.subjectAlias) ?? fallbackSubjectAlias,
    traceSessionId,
    requestId: text(safe.requestId),
    stateRevision: typeof safe.stateRevision === 'number' ? safe.stateRevision : null,
    eventType: entryEventType(safe),
    summary: entrySummary(safe),
    detail: safe,
  };
}

function stringSet(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort();
}

function diagnosticVersions(entries: readonly ObservabilityLogEntryProjection[]) {
  const models: Array<string | null> = [];
  const promptVersions: Array<string | null> = [];
  const schedulerVersions: Array<string | null> = [];
  entries.forEach((entry) => {
    if (entry.detail.kind !== 'turn_diagnostic') return;
    const ai = isRecord(entry.detail.aiInterpreter) ? entry.detail.aiInterpreter : {};
    const constraintContext = isRecord(entry.detail.constraintContext)
      ? entry.detail.constraintContext
      : {};
    const scheduler = isRecord(constraintContext.scheduler) ? constraintContext.scheduler : {};
    const preview = isRecord(scheduler.preview) ? scheduler.preview : {};
    models.push(text(ai.model));
    promptVersions.push(text(ai.promptVersion));
    schedulerVersions.push(text(preview.schedulerVersion));
  });
  return {
    models: stringSet(models),
    promptVersions: stringSet(promptVersions),
    schedulerVersions: stringSet(schedulerVersions),
  };
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function createObservabilityDebugBundleFromTrace(params: {
  session: Record<string, unknown>;
  entries: Record<string, unknown>[];
  totalEntryCount: number;
  requestId?: string | null;
  generatedAt?: string;
  scanLimitReached?: boolean;
}): ObservabilityDebugBundleV1 {
  const session = createObservabilityLogSessionSummary(params.session);
  if (!session) throw new Error('observability_trace_session_invalid');
  const projected = params.entries
    .map((entry) => createObservabilityLogEntryProjection(entry, session.subjectAlias))
    .filter((entry): entry is ObservabilityLogEntryProjection => Boolean(entry))
    .filter((entry) => !params.requestId || entry.requestId === params.requestId)
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  const included: ObservabilityLogEntryProjection[] = [];
  let byteLimitReached = false;
  for (const entry of projected) {
    if (included.length >= DEBUG_BUNDLE_ENTRY_LIMIT) break;
    if (jsonBytes([...included, entry]) > DEBUG_BUNDLE_BYTE_LIMIT) {
      byteLimitReached = true;
      break;
    }
    included.push(entry);
  }
  const versions = diagnosticVersions(included);
  const requestIds = stringSet(included.map((entry) => entry.requestId));
  const availableEntryCount = params.totalEntryCount;
  return {
    schema: OBSERVABILITY_DEBUG_BUNDLE_SCHEMA,
    schemaVersion: OBSERVABILITY_DEBUG_BUNDLE_SCHEMA_VERSION,
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    selection: {
      source: 'weekly_planning_trace',
      traceSessionId: session.traceSessionId,
      requestId: params.requestId ?? null,
      period: { from: session.startedAt, to: session.lastActivityAt },
    },
    correlation: {
      subjectAlias: session.subjectAlias,
      traceSessionId: session.traceSessionId,
      requestIds,
    },
    versions: {
      appVersion: session.appVersion,
      traceSchemaVersion: session.traceSchemaVersion,
      ...versions,
    },
    metrics: {
      sessionStatus: session.status,
      turnCount: session.turnCount,
      totalEntryCount: params.totalEntryCount,
      includedEntryCount: included.length,
      hasPreview: session.hasPreview,
      hasApprovalFailure: session.hasApprovalFailure,
      hasFallback: session.hasFallback,
      hasError: session.hasError,
    },
    entries: included,
    redactionSummary: {
      policy: 'weekly_planning_trace_admin_redaction_v1',
      sensitiveIdentityFieldsRemoved: true,
      secretFieldsRemoved: true,
      textPatternRedactionApplied: true,
    },
    truncationSummary: {
      availableEntryCount,
      includedEntryCount: included.length,
      omittedEntryCount: Math.max(0, availableEntryCount - included.length),
      entryLimit: DEBUG_BUNDLE_ENTRY_LIMIT,
      scanLimit: DEBUG_BUNDLE_SCAN_LIMIT,
      scanLimitReached: params.scanLimitReached === true,
      byteLimit: DEBUG_BUNDLE_BYTE_LIMIT,
      byteLimitReached,
    },
  };
}

function validSessionId(value: string): boolean {
  return isWeeklyPlanningTraceSessionId(value) || isWeeklyPlanningLegacyTraceSessionHandle(value);
}

export class ProductObservabilityWeeklyPlanningDiagnosticAdapter {
  private readonly firestore: WeeklyPlanningTraceFirestoreClient;
  private readonly env: ProductObservabilityWeeklyPlanningDiagnosticEnv;
  private authorizedAdminUid: string | null = null;

  constructor(env: ProductObservabilityWeeklyPlanningDiagnosticEnv) {
    this.env = env;
    this.firestore = new WeeklyPlanningTraceFirestoreClient(env);
  }

  async assertTraceReader(adminUid: string): Promise<void> {
    const admin = await this.firestore.getDocument(ADMINS, adminUid);
    if (admin?.enabled !== true || admin.weeklyPlanningTraceReader !== true) {
      throw new Error('observability_trace_reader_forbidden');
    }
    this.authorizedAdminUid = adminUid;
  }

  private async appendAccessAudit(
    action: 'list_sessions' | 'list_entries_page' | 'create_debug_bundle',
    sessionId: string | null,
  ): Promise<void> {
    const adminUid = this.authorizedAdminUid;
    if (!adminUid) throw new Error('observability_trace_reader_forbidden');
    const rawSecrets = this.env.WEEKLY_PLANNING_TRACE_HMAC_SECRETS?.trim();
    if (!rawSecrets) throw new Error('observability_trace_audit_unavailable');
    const now = new Date();
    const epoch = resolveWeeklyPlanningTraceEpoch(now);
    const actor = await createWeeklyPlanningTraceSubject(
      adminUid,
      epoch,
      parseWeeklyPlanningTraceHmacSecrets(rawSecrets),
    );
    const id = `trace-audit:${now.getTime()}:${crypto.randomUUID()}`;
    await this.firestore.setImmutableDocument(TRACE_ACCESS_AUDIT, id, {
      id,
      actorToken: actor.token,
      actorEpoch: actor.epoch,
      action,
      targetSessionId: sessionId,
      occurredAt: now.toISOString(),
      expireAt: weeklyPlanningTraceExpireAt(now),
    });
  }

  async listSessions(params: {
    cursor?: FirestoreOrderedCursor | null;
    limit?: number;
    status?: string | null;
    sessionId?: string | null;
  }): Promise<ObservabilityDiagnosticSessionPageInternal> {
    const limit = Math.max(1, Math.min(MAX_SESSION_PAGE_SIZE, params.limit ?? 25));
    const status = params.status?.trim() ?? '';
    if (status && !SESSION_STATUSES.has(status)) throw new Error('observability_trace_status_invalid');
    const exactSessionId = params.sessionId?.trim() ?? '';
    if (exactSessionId) {
      if (!validSessionId(exactSessionId)) throw new Error('observability_trace_session_invalid');
      await this.appendAccessAudit('list_sessions', exactSessionId);
      const document = await this.firestore.getDocument(TRACE_SESSIONS, exactSessionId);
      const summary = document ? createObservabilityLogSessionSummary(document) : null;
      return {
        sessions: summary && (!status || summary.status === status) ? [summary] : [],
        nextCursor: null,
      };
    }
    await this.appendAccessAudit('list_sessions', null);
    const documents = await this.firestore.queryDocumentsAfter({
      collection: TRACE_SESSIONS,
      orderByField: 'lastActivityAt',
      direction: 'DESCENDING',
      cursor: params.cursor ?? null,
      filters: [],
      limit: limit + 1,
    });
    const hasMore = documents.length > limit;
    const pageDocuments = documents.slice(0, limit);
    const sessions = pageDocuments
      .map(createObservabilityLogSessionSummary)
      .filter((item): item is ObservabilityLogSessionSummary => Boolean(item))
      .filter((item) => !status || item.status === status);
    const last = pageDocuments[pageDocuments.length - 1];
    return {
      sessions,
      nextCursor: hasMore && last && typeof last.lastActivityAt === 'string'
        ? { orderedValue: last.lastActivityAt, documentName: last.documentName }
        : null,
    };
  }

  async listEntries(params: {
    sessionId: string;
    afterSequence?: number;
    limit?: number;
  }): Promise<ObservabilityLogEntryPage> {
    if (!validSessionId(params.sessionId)) throw new Error('observability_trace_session_invalid');
    const target = await this.firestore.getDocument(TRACE_SESSIONS, params.sessionId);
    if (!target) throw new Error('observability_trace_session_not_found');
    const safeTarget = createObservabilityLogSessionSummary(target);
    if (!safeTarget) throw new Error('observability_trace_session_invalid');
    const afterSequence = params.afterSequence ?? -1;
    if (!Number.isSafeInteger(afterSequence) || afterSequence < -1) {
      throw new Error('observability_trace_cursor_invalid');
    }
    await this.appendAccessAudit('list_entries_page', params.sessionId);
    const page = await loadWeeklyPlanningTraceAdminEntryPage(
      this.firestore,
      params.sessionId,
      target,
      afterSequence,
      Math.max(1, Math.min(
        WEEKLY_PLANNING_TRACE_ADMIN_ENTRY_PAGING.maxPageSize,
        params.limit ?? WEEKLY_PLANNING_TRACE_ADMIN_ENTRY_PAGING.defaultPageSize,
      )),
    );
    return {
      entries: page.entries
        .map((entry) => createObservabilityLogEntryProjection(entry, safeTarget.subjectAlias))
        .filter((item): item is ObservabilityLogEntryProjection => Boolean(item)),
      totalEntryCount: page.totalEntryCount,
      nextAfterSequence: page.nextAfterSequence,
      responseBytes: page.responseBytes,
    };
  }

  async createDebugBundle(params: {
    sessionId: string;
    requestId?: string | null;
  }): Promise<ObservabilityDebugBundleV1> {
    if (!validSessionId(params.sessionId)) throw new Error('observability_trace_session_invalid');
    const session = await this.firestore.getDocument(TRACE_SESSIONS, params.sessionId);
    if (!session) throw new Error('observability_trace_session_not_found');
    const requestId = params.requestId?.trim() || null;
    if (requestId && (requestId.length > 240 || /[\u0000-\u001f\u007f]/.test(requestId))) {
      throw new Error('observability_trace_request_invalid');
    }
    await this.appendAccessAudit('create_debug_bundle', params.sessionId);

    if (requestId) {
      const availableEntryCount = await this.firestore.countDocuments(TRACE_ENTRIES, [
        { field: 'sessionId', operator: 'EQUAL', value: params.sessionId },
        { field: 'requestId', operator: 'EQUAL', value: requestId },
      ]);
      const entries = await this.firestore.queryDocuments(TRACE_ENTRIES, [
        { field: 'sessionId', value: params.sessionId },
        { field: 'requestId', value: requestId },
      ], DEBUG_BUNDLE_ENTRY_LIMIT);
      return createObservabilityDebugBundleFromTrace({
        session,
        entries,
        totalEntryCount: availableEntryCount,
        requestId,
        scanLimitReached: availableEntryCount > DEBUG_BUNDLE_SCAN_LIMIT,
      });
    }

    const totalEntryCount = integer(session.entryCount);
    const entries: Record<string, unknown>[] = [];
    let afterSequence = -1;
    let scannedSequenceCount = 0;
    let nextAfterSequence: number | null = totalEntryCount > 0 ? -1 : null;

    while (nextAfterSequence !== null && scannedSequenceCount < DEBUG_BUNDLE_SCAN_LIMIT) {
      const remainingScan = DEBUG_BUNDLE_SCAN_LIMIT - scannedSequenceCount;
      const page = await loadWeeklyPlanningTraceAdminEntryPage(
        this.firestore,
        params.sessionId,
        session,
        afterSequence,
        Math.min(WEEKLY_PLANNING_TRACE_ADMIN_ENTRY_PAGING.maxPageSize, remainingScan),
      );
      entries.push(...page.entries);
      nextAfterSequence = page.nextAfterSequence;
      const consumedThrough = nextAfterSequence ?? page.requestedEndSequence;
      const consumedSequenceCount = Math.max(0, consumedThrough - afterSequence);
      if (consumedSequenceCount === 0) break;
      scannedSequenceCount += consumedSequenceCount;
      afterSequence = consumedThrough;
    }

    return createObservabilityDebugBundleFromTrace({
      session,
      entries,
      totalEntryCount,
      scanLimitReached: nextAfterSequence !== null,
    });
  }
}
