export const WEEKLY_PLANNING_TRACE_POLICY_VERSION = '2026-07-18-v1';
export const WEEKLY_PLANNING_TRACE_RETENTION_DAYS = 180;
export const WEEKLY_PLANNING_TRACE_EPOCH_DAYS = 30;
export const MAX_TRACE_ENTRIES_PER_REQUEST = 100;
export const MAX_TRACE_DOCUMENT_BYTES = 64 * 1024;

const DAY_MS = 24 * 60 * 60 * 1000;
const TRACE_EPOCH_MS = WEEKLY_PLANNING_TRACE_EPOCH_DAYS * DAY_MS;
const REDACTED = '[REDACTED]';
const REDACTED_EMAIL = '[EMAIL]';
const REDACTED_PHONE = '[PHONE]';
const REDACTED_TOKEN = '[TOKEN]';
const REDACTED_UUID = '[UUID]';
const REDACTED_URL_QUERY = '[QUERY_REDACTED]';

const FORBIDDEN_IDENTITY_KEYS = new Set([
  'userid',
  'uid',
  'accountid',
  'firebaseuid',
  'email',
  'emailaddress',
  'username',
  'displayname',
  'fullname',
  'firstname',
  'lastname',
  'ownername',
  'personname',
  'authorization',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'password',
  'secret',
  'apikey',
  'cookie',
  'tracesubjecttoken',
  'tracesubjectepoch',
  'actortoken',
  'actorepoch',
]);

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_PATTERN = /(?:\+?81[-\s]?)?0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}/g;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const TOKEN_PATTERN = /\b[A-Za-z0-9_-]{28,}\b/g;
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;

export interface TraceHmacSecretRing {
  [epoch: string]: string;
}

export interface WeeklyPlanningTraceSubject {
  token: string;
  epoch: string;
}

export interface WeeklyPlanningTracePolicyAcceptance {
  version: string;
  acceptedAt: string;
}

export interface WeeklyPlanningTraceWriteInput {
  session: Record<string, unknown>;
  entries: Record<string, unknown>[];
}

export interface PreparedWeeklyPlanningTraceWrite {
  session: Record<string, unknown>;
  entries: Record<string, unknown>[];
}

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? '').byteLength;
}

function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const suffix = url.search || url.hash ? `?${REDACTED_URL_QUERY}` : '';
    return `${url.origin}${url.pathname}${suffix}`;
  } catch {
    return REDACTED;
  }
}

export function redactWeeklyPlanningTraceString(value: string): string {
  return value
    .replace(URL_PATTERN, redactUrl)
    .replace(EMAIL_PATTERN, REDACTED_EMAIL)
    .replace(PHONE_PATTERN, REDACTED_PHONE)
    .replace(UUID_PATTERN, REDACTED_UUID)
    .replace(TOKEN_PATTERN, REDACTED_TOKEN);
}

export function redactWeeklyPlanningTraceValue(
  input: unknown,
  maxDepth = 8,
): unknown {
  const seen = new WeakSet<object>();

  function visit(value: unknown, depth: number): unknown {
    if (value === null || typeof value === 'boolean' || typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      return redactWeeklyPlanningTraceString(value).slice(0, 4_000);
    }
    if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
      return undefined;
    }
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Date) return value.toISOString();
    if (depth >= maxDepth) return REDACTED;
    if (Array.isArray(value)) {
      return value.slice(0, 100).map((item) => visit(item, depth + 1));
    }
    if (typeof value === 'object') {
      if (seen.has(value)) return REDACTED;
      seen.add(value);
      const result: Record<string, unknown> = {};
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .forEach(([key, entryValue]) => {
          const keyName = normalizedKey(key);
          if (keyName === 'tracesubjecttoken' && typeof entryValue === 'string') {
            result.subjectAlias = `subject-${entryValue.slice(-12)}`;
            return;
          }
          if (FORBIDDEN_IDENTITY_KEYS.has(keyName)) return;
          const redacted = visit(entryValue, depth + 1);
          if (redacted !== undefined) result[key] = redacted;
        });
      return result;
    }
    return REDACTED;
  }

  return visit(input, 0);
}

export function resolveWeeklyPlanningTraceEpoch(now: Date | string | number): string {
  const time = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(time)) throw new Error('trace epoch date is invalid');
  return String(Math.floor(time / TRACE_EPOCH_MS));
}

export function parseWeeklyPlanningTraceHmacSecrets(raw: string): TraceHmacSecretRing {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('trace HMAC secret ring is invalid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('trace HMAC secret ring must be an object');
  }
  const entries = Object.entries(parsed as Record<string, unknown>)
    .filter((entry): entry is [string, string] =>
      /^\d+$/.test(entry[0]) && typeof entry[1] === 'string' && entry[1].length >= 32,
    );
  if (entries.length === 0) throw new Error('trace HMAC secret ring has no valid epoch secret');
  return Object.fromEntries(entries);
}

export async function createWeeklyPlanningTraceSubject(
  uid: string,
  epoch: string,
  secretRing: TraceHmacSecretRing,
  cryptoApi: Crypto = crypto,
): Promise<WeeklyPlanningTraceSubject> {
  const normalizedUid = uid.trim();
  const secret = secretRing[epoch];
  if (!normalizedUid) throw new Error('trace subject uid is empty');
  if (!secret) throw new Error(`trace HMAC secret is missing for epoch ${epoch}`);
  const key = await cryptoApi.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await cryptoApi.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${epoch}:${normalizedUid}`),
  );
  return {
    token: `wpt_${base64Url(new Uint8Array(signature))}`,
    epoch,
  };
}

export function weeklyPlanningTraceExpireAt(
  now: Date | string | number,
  retentionDays = WEEKLY_PLANNING_TRACE_RETENTION_DAYS,
): string {
  const time = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(time)) throw new Error('trace retention date is invalid');
  return new Date(time + retentionDays * DAY_MS).toISOString();
}

export function isWeeklyPlanningTracePolicyAccepted(
  value: unknown,
  policyVersion = WEEKLY_PLANNING_TRACE_POLICY_VERSION,
): value is WeeklyPlanningTracePolicyAcceptance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.version === policyVersion
    && typeof record.acceptedAt === 'string'
    && Number.isFinite(new Date(record.acceptedAt).getTime());
}

const UUID_SUFFIX = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const FALLBACK_RANDOM_SUFFIX = '[0-9]{10,16}-[a-z0-9]{6,16}';
const OPAQUE_SUFFIX = `(?:${UUID_SUFFIX}|${FALLBACK_RANDOM_SUFFIX})`;
const TRACE_SESSION_ID_PATTERN = new RegExp(`^weekly-trace-${OPAQUE_SUFFIX}$`, 'i');
const LEGACY_REDACTED_TRACE_SESSION_HANDLE_PATTERN = /^weekly-trace-\[UUID\]$/;
const TRACE_CONVERSATION_ID_PATTERN = new RegExp(
  `^(?:weekly-conversation|weekly-planning-conversation)-${OPAQUE_SUFFIX}$`,
  'i',
);
const MAX_TRACE_SESSION_ENTRIES = 100_000;

export function isWeeklyPlanningTraceSessionId(value: unknown): value is string {
  return typeof value === 'string' && TRACE_SESSION_ID_PATTERN.test(value);
}

export function isWeeklyPlanningLegacyTraceSessionHandle(value: unknown): value is string {
  return typeof value === 'string'
    && LEGACY_REDACTED_TRACE_SESSION_HANDLE_PATTERN.test(value);
}

export function isWeeklyPlanningTraceConversationId(value: unknown): value is string {
  return typeof value === 'string' && TRACE_CONVERSATION_ID_PATTERN.test(value);
}

export function weeklyPlanningTraceEntryId(sessionId: string, sequence: number): string {
  return `${sessionId}-${String(sequence).padStart(8, '0')}`;
}

export function isWeeklyPlanningTraceEntryId(
  value: unknown,
  sessionId?: string,
  sequence?: number,
): value is string {
  if (typeof value !== 'string') return false;
  const match = value.match(/^(weekly-trace-.+)-(\d{8})$/);
  if (!match || !isWeeklyPlanningTraceSessionId(match[1])) return false;
  const parsedSequence = Number(match[2]);
  return Number.isSafeInteger(parsedSequence)
    && (sessionId === undefined || match[1] === sessionId)
    && (sequence === undefined || parsedSequence === sequence);
}

function requireTraceSessionId(value: unknown): string {
  if (!isWeeklyPlanningTraceSessionId(value)) throw new Error('trace session id is invalid');
  return value;
}

function requireTraceConversationId(value: unknown, label: string): string {
  if (!isWeeklyPlanningTraceConversationId(value)) throw new Error(`${label} is invalid`);
  return value;
}

function requireTraceEntryCount(value: unknown): number {
  if (typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < 0
    || value > MAX_TRACE_SESSION_ENTRIES) {
    throw new Error('trace session entryCount is invalid');
  }
  return value;
}

const TRACE_SESSION_STATUSES = new Set(['active', 'completed', 'abandoned', 'failed']);
const TRACE_RESPONSE_SOURCES = new Set(['ai', 'deterministic_fallback', 'rules', 'system']);
const TRACE_EVENT_TYPES = new Set([
  'user_turn_received', 'interpreter_started', 'interpreter_completed',
  'candidate_accepted', 'candidate_rejected', 'assumption_proposed',
  'assumption_accepted', 'assumption_rejected', 'assumption_superseded',
  'correction_applied', 'correction_rejected', 'relative_constraint_resolved',
  'relative_constraint_rejected', 'readiness_evaluated', 'feasibility_evaluated',
  'dialogue_planned', 'fallback_used', 'preview_gate_evaluated',
  'preview_generated', 'preview_rejected_stale',
  'preview_rejected_pending_assumption', 'draft_promoted', 'approval_started',
  'approval_item_saved', 'approval_item_failed', 'approval_completed',
  'request_cancelled', 'stale_async_result_discarded', 'trace_write_failed',
]);
const TRACE_SEVERITIES = new Set(['debug', 'info', 'warn', 'error']);
const TRACE_SNAPSHOT_REASONS = new Set([
  'turn_completed', 'correction_applied', 'preview_generated',
  'approval_started', 'approval_completed', 'error', 'manual_capture',
]);

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function requireTraceSessionSchema(session: Record<string, unknown>): void {
  const valid = TRACE_SESSION_STATUSES.has(String(session.status))
    && isIsoTimestamp(session.startedAt)
    && isIsoTimestamp(session.lastActivityAt)
    && (session.endedAt === undefined || isIsoTimestamp(session.endedAt))
    && (session.archivedAt === undefined || isIsoTimestamp(session.archivedAt))
    && (session.planningRangeStart === undefined || isIsoTimestamp(session.planningRangeStart))
    && (session.planningRangeEnd === undefined || isIsoTimestamp(session.planningRangeEnd))
    && isNonNegativeInteger(session.turnCount)
    && typeof session.hasPreview === 'boolean'
    && typeof session.hasApprovalFailure === 'boolean'
    && typeof session.hasFallback === 'boolean'
    && typeof session.hasError === 'boolean'
    && typeof session.appVersion === 'string'
    && session.appVersion.trim().length > 0
    && typeof session.schemaVersion === 'number'
    && Number.isSafeInteger(session.schemaVersion)
    && session.schemaVersion >= 1;
  if (!valid) throw new Error('trace session schema is invalid');
}

function requireTraceEntrySchema(entry: Record<string, unknown>): void {
  const validBase = isIsoTimestamp(entry.occurredAt)
    && isIsoTimestamp(entry.observedAt)
    && typeof entry.schemaVersion === 'number'
    && Number.isSafeInteger(entry.schemaVersion)
    && entry.schemaVersion >= 1
    && (entry.requestId === undefined || typeof entry.requestId === 'string')
    && (entry.stateRevision === undefined || isNonNegativeInteger(entry.stateRevision));
  if (!validBase) throw new Error('trace entry schema is invalid');
  if (entry.kind === 'turn') {
    const validSource = TRACE_RESPONSE_SOURCES.has(String(entry.responseSource));
    const validTurn = (entry.role === 'user' || entry.role === 'assistant')
      && typeof entry.content === 'string'
      && isNonNegativeInteger(entry.turnIndex)
      && (entry.role === 'assistant' ? validSource : entry.responseSource === undefined);
    if (!validTurn) throw new Error('trace turn entry schema is invalid');
    return;
  }
  if (entry.kind === 'internal_event') {
    const validEvent = Object.prototype.hasOwnProperty.call(entry, 'payload')
      && entry.payload !== undefined
      && TRACE_EVENT_TYPES.has(String(entry.eventType))
      && TRACE_SEVERITIES.has(String(entry.severity));
    if (!validEvent) throw new Error('trace internal event entry schema is invalid');
    return;
  }
  if (entry.kind === 'state_snapshot') {
    const validSnapshot = Object.prototype.hasOwnProperty.call(entry, 'state')
      && entry.state !== undefined
      && TRACE_SNAPSHOT_REASONS.has(String(entry.snapshotReason));
    if (!validSnapshot) throw new Error('trace state snapshot entry schema is invalid');
    return;
  }
  throw new Error('trace entry kind is invalid');
}

function preparedDocument(
  input: Record<string, unknown>,
  subject: WeeklyPlanningTraceSubject,
  expireAt: string,
): Record<string, unknown> {
  const redacted = redactWeeklyPlanningTraceValue(input);
  if (!redacted || typeof redacted !== 'object' || Array.isArray(redacted)) {
    throw new Error('trace document is invalid after redaction');
  }
  const document = {
    ...(redacted as Record<string, unknown>),
    traceSubjectToken: subject.token,
    traceSubjectEpoch: subject.epoch,
    policyVersion: WEEKLY_PLANNING_TRACE_POLICY_VERSION,
    expireAt,
  };
  if (serializedBytes(document) > MAX_TRACE_DOCUMENT_BYTES) {
    throw new Error('trace document exceeds the server size limit');
  }
  return document;
}

export function prepareWeeklyPlanningTraceWrite(
  input: WeeklyPlanningTraceWriteInput,
  subject: WeeklyPlanningTraceSubject,
  now: Date | string | number = new Date(),
): PreparedWeeklyPlanningTraceWrite {
  if (!input || typeof input !== 'object') throw new Error('trace write payload is invalid');
  if (!input.session || typeof input.session !== 'object' || Array.isArray(input.session)) {
    throw new Error('trace session payload is invalid');
  }
  if (!Array.isArray(input.entries) || input.entries.length > MAX_TRACE_ENTRIES_PER_REQUEST) {
    throw new Error('trace entry batch is invalid');
  }
  const sessionId = requireTraceSessionId(input.session.id);
  const logicalConversationId = requireTraceConversationId(
    input.session.logicalConversationId,
    'logical conversation id',
  );
  const entryCount = requireTraceEntryCount(input.session.entryCount);
  requireTraceSessionSchema(input.session);
  const expireAt = weeklyPlanningTraceExpireAt(now);
  const session = {
    ...preparedDocument({
      ...input.session,
      id: sessionId,
      logicalConversationId,
      entryCount,
    }, subject, expireAt),
    id: sessionId,
    logicalConversationId,
    entryCount,
  };
  const seenSequences = new Set<number>();
  const entries = input.entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('trace entry payload is invalid');
    }
    const sequence = entry.sequence;
    if (typeof sequence !== 'number'
      || !Number.isSafeInteger(sequence)
      || sequence < 0
      || sequence >= entryCount
      || seenSequences.has(sequence)) {
      throw new Error('trace entry sequence is invalid');
    }
    seenSequences.add(sequence);
    const expectedEntryId = weeklyPlanningTraceEntryId(sessionId, sequence);
    if (!isWeeklyPlanningTraceEntryId(entry.id, sessionId, sequence)
      || entry.id !== expectedEntryId) {
      throw new Error('trace entry id is invalid');
    }
    if (entry.sessionId !== sessionId) throw new Error('trace entry session mismatch');
    const entryConversationId = requireTraceConversationId(
      entry.logicalConversationId,
      'entry logical conversation id',
    );
    if (entryConversationId !== logicalConversationId) {
      throw new Error('trace entry conversation mismatch');
    }
    requireTraceEntrySchema(entry);
    return {
      ...preparedDocument({
        ...entry,
        id: expectedEntryId,
        sessionId,
        logicalConversationId: entryConversationId,
        sequence,
      }, subject, expireAt),
      id: expectedEntryId,
      sessionId,
      logicalConversationId: entryConversationId,
      sequence,
    };
  });
  return { session, entries };
}

export function traceSubjectEpochsForDeletion(secretRing: TraceHmacSecretRing): string[] {
  return Object.keys(secretRing).filter((value) => /^\d+$/.test(value)).sort();
}
