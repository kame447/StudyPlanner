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

function requireDocumentId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9:_-]{1,240}$/.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
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
  const sessionId = requireDocumentId(input.session.id, 'trace session id');
  const expireAt = weeklyPlanningTraceExpireAt(now);
  const session = preparedDocument({ ...input.session, id: sessionId }, subject, expireAt);
  const entries = input.entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('trace entry payload is invalid');
    }
    const entryId = requireDocumentId(entry.id, 'trace entry id');
    if (entry.sessionId !== sessionId) throw new Error('trace entry session mismatch');
    return preparedDocument({ ...entry, id: entryId, sessionId }, subject, expireAt);
  });
  return { session, entries };
}

export function traceSubjectEpochsForDeletion(secretRing: TraceHmacSecretRing): string[] {
  return Object.keys(secretRing).filter((value) => /^\d+$/.test(value)).sort();
}
