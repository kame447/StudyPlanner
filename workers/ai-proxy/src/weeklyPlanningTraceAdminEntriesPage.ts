import {
  WEEKLY_PLANNING_TRACE_ADMIN_ENTRY_PAGING,
  WEEKLY_PLANNING_TRACE_CONTRACT_VERSION,
  WEEKLY_PLANNING_TRACE_WORKER_REVISION,
} from '../../../shared/weeklyPlanningTraceContract';
import { safeWeeklyPlanningTraceDocumentsForAdmin } from './weeklyPlanningTraceApi';
import {
  WeeklyPlanningTraceFirestoreClient,
  type WeeklyPlanningTraceFirestoreEnv,
} from './weeklyPlanningTraceFirestore';
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
const ENDPOINT = '/weekly-planning-trace/admin/entries/page';

export interface WeeklyPlanningTraceAdminEntriesPageEnv
  extends WeeklyPlanningTraceFirestoreEnv {
  FIREBASE_WEB_API_KEY: string;
  ALLOWED_ORIGIN?: string;
  WEEKLY_PLANNING_TRACE_HMAC_SECRETS: string;
  WEEKLY_PLANNING_TRACE_WORKER_REVISION?: string;
}

interface FirebaseLookupResponse {
  users?: Array<{
    localId?: string;
    emailVerified?: boolean;
  }>;
}

interface TraceSession {
  uid: string;
}

interface TraceRequestContext {
  correlationId: string;
  workerRevision: string;
}

interface AdminEntryReader {
  getDocument(collection: string, id: string): Promise<Record<string, unknown> | null>;
}

export interface WeeklyPlanningTraceAdminEntryPage {
  entries: Record<string, unknown>[];
  totalEntryCount: number;
  nextAfterSequence: number | null;
  missingSequenceCount: number;
}

function allowedOrigins(env: WeeklyPlanningTraceAdminEntriesPageEnv): Set<string> {
  return new Set((env.ALLOWED_ORIGIN ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean));
}

function corsOrigin(
  request: Request,
  env: WeeklyPlanningTraceAdminEntriesPageEnv,
): string | null {
  const origin = request.headers.get('Origin')?.trim();
  if (!origin) return null;
  return allowedOrigins(env).has(origin) ? origin : '';
}

function workerRevision(env: WeeklyPlanningTraceAdminEntriesPageEnv): string {
  return env.WEEKLY_PLANNING_TRACE_WORKER_REVISION?.trim()
    || WEEKLY_PLANNING_TRACE_WORKER_REVISION;
}

function correlationId(request: Request): string {
  const supplied = request.headers.get('X-StudyPlanner-Trace-Correlation-Id')?.trim();
  if (supplied && /^[A-Za-z0-9._:-]{8,160}$/.test(supplied)) return supplied;
  return crypto.randomUUID();
}

function responseHeaders(
  request: Request,
  env: WeeklyPlanningTraceAdminEntriesPageEnv,
): Headers {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  });
  const origin = corsOrigin(request, env);
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  return headers;
}

function responseBody(
  context: TraceRequestContext,
  body: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...body,
    contractVersion: WEEKLY_PLANNING_TRACE_CONTRACT_VERSION,
    workerRevision: context.workerRevision,
    correlationId: context.correlationId,
  };
}

function jsonResponse(
  request: Request,
  env: WeeklyPlanningTraceAdminEntriesPageEnv,
  context: TraceRequestContext,
  status: number,
  body: Record<string, unknown>,
): Response {
  return new Response(JSON.stringify(responseBody(context, body)), {
    status,
    headers: responseHeaders(request, env),
  });
}

function errorResponse(
  request: Request,
  env: WeeklyPlanningTraceAdminEntriesPageEnv,
  context: TraceRequestContext,
  status: number,
  message: string,
  code: string,
  category: 'auth' | 'validation' | 'storage' | 'internal',
  retryable = false,
): Response {
  return jsonResponse(request, env, context, status, {
    ok: false,
    error: message,
    errorCode: code,
    errorCategory: category,
    retryable,
  });
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get('Authorization')?.trim() ?? '';
  return authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : '';
}

async function requireFirebaseSession(
  request: Request,
  env: WeeklyPlanningTraceAdminEntriesPageEnv,
): Promise<TraceSession | null> {
  const apiKey = env.FIREBASE_WEB_API_KEY?.trim();
  const token = bearerToken(request);
  if (!apiKey || !token) return null;

  const response = await globalThis.fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
    },
  );
  if (!response.ok) return null;
  const payload = await response.json() as FirebaseLookupResponse;
  const user = payload.users?.[0];
  if (!user?.localId || user.emailVerified === false) return null;
  return { uid: user.localId };
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : fallback;
}

function pageLimit(value: unknown): number {
  const requested = nonNegativeInteger(
    value,
    WEEKLY_PLANNING_TRACE_ADMIN_ENTRY_PAGING.defaultPageSize,
  );
  return Math.max(1, Math.min(
    WEEKLY_PLANNING_TRACE_ADMIN_ENTRY_PAGING.maxPageSize,
    requested,
  ));
}

function entryCount(target: Record<string, unknown>): number {
  return Math.max(0, Math.min(
    WEEKLY_PLANNING_TRACE_ADMIN_ENTRY_PAGING.maxEntryCount,
    nonNegativeInteger(target.entryCount, 0),
  ));
}

function normalizedEntry(
  entry: Record<string, unknown> | null,
  sessionId: string,
  sequence: number,
): Record<string, unknown> | null {
  if (!entry) return null;
  const expectedId = `${sessionId}-${String(sequence).padStart(8, '0')}`;
  if (entry.id !== expectedId) return null;
  return { ...entry, id: expectedId, sessionId, sequence };
}

export async function loadWeeklyPlanningTraceAdminEntryPage(
  firestore: AdminEntryReader,
  sessionId: string,
  target: Record<string, unknown>,
  afterSequence: number,
  limit: number,
): Promise<WeeklyPlanningTraceAdminEntryPage> {
  const totalEntryCount = entryCount(target);
  const startSequence = Math.min(totalEntryCount, Math.max(0, afterSequence + 1));
  const endExclusive = Math.min(totalEntryCount, startSequence + pageLimit(limit));
  const sequences = Array.from(
    { length: Math.max(0, endExclusive - startSequence) },
    (_, index) => startSequence + index,
  );

  const loaded = await Promise.all(sequences.map(async (sequence) => normalizedEntry(
    await firestore.getDocument(
      TRACE_ENTRIES,
      `${sessionId}-${String(sequence).padStart(8, '0')}`,
    ),
    sessionId,
    sequence,
  )));
  const entries = loaded.filter((entry): entry is Record<string, unknown> => Boolean(entry));
  return {
    entries,
    totalEntryCount,
    nextAfterSequence: endExclusive < totalEntryCount ? endExclusive - 1 : null,
    missingSequenceCount: loaded.length - entries.length,
  };
}

async function appendAccessAudit(
  firestore: WeeklyPlanningTraceFirestoreClient,
  env: WeeklyPlanningTraceAdminEntriesPageEnv,
  uid: string,
  sessionId: string,
): Promise<void> {
  const now = new Date();
  const epoch = resolveWeeklyPlanningTraceEpoch(now);
  const actor = await createWeeklyPlanningTraceSubject(
    uid,
    epoch,
    parseWeeklyPlanningTraceHmacSecrets(env.WEEKLY_PLANNING_TRACE_HMAC_SECRETS),
  );
  const id = `trace-audit:${now.getTime()}:${crypto.randomUUID()}`;
  await firestore.setImmutableDocument(TRACE_ACCESS_AUDIT, id, {
    id,
    actorToken: actor.token,
    actorEpoch: actor.epoch,
    action: 'list_entries_page',
    targetSessionId: sessionId,
    occurredAt: now.toISOString(),
    expireAt: weeklyPlanningTraceExpireAt(now),
  });
}

export async function handleWeeklyPlanningTraceAdminEntriesPage(
  request: Request,
  rawEnv: Record<string, unknown>,
): Promise<Response> {
  const env = rawEnv as unknown as WeeklyPlanningTraceAdminEntriesPageEnv;
  const context: TraceRequestContext = {
    correlationId: correlationId(request),
    workerRevision: workerRevision(env),
  };
  const origin = corsOrigin(request, env);
  if (origin === '') {
    return errorResponse(request, env, context, 403,
      'この送信元からは利用できません。', 'trace_origin_forbidden', 'auth');
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: responseHeaders(request, env) });
  }
  if (request.method !== 'POST') {
    return errorResponse(request, env, context, 405,
      'Method not allowed.', 'trace_method_not_allowed', 'validation');
  }

  try {
    const session = await requireFirebaseSession(request, env);
    if (!session) {
      return errorResponse(request, env, context, 401,
        'ログイン情報を確認できませんでした。', 'trace_auth_invalid', 'auth');
    }

    const firestore = new WeeklyPlanningTraceFirestoreClient(env);
    const admin = await firestore.getDocument(ADMINS, session.uid);
    if (admin?.enabled !== true || admin.weeklyPlanningTraceReader !== true) {
      return errorResponse(request, env, context, 403,
        'trace閲覧権限がありません。', 'trace_reader_forbidden', 'auth');
    }

    const body = await request.json() as Record<string, unknown>;
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
    if (!isWeeklyPlanningTraceSessionId(sessionId)
      && !isWeeklyPlanningLegacyTraceSessionHandle(sessionId)) {
      return errorResponse(request, env, context, 400,
        'sessionId is invalid', 'trace_session_id_invalid', 'validation');
    }
    const afterSequence = body.afterSequence === undefined
      ? -1
      : typeof body.afterSequence === 'number'
        && Number.isSafeInteger(body.afterSequence)
        && body.afterSequence >= -1
        ? body.afterSequence
        : Number.NaN;
    if (!Number.isSafeInteger(afterSequence)
      || afterSequence >= WEEKLY_PLANNING_TRACE_ADMIN_ENTRY_PAGING.maxEntryCount) {
      return errorResponse(request, env, context, 400,
        'afterSequence is invalid', 'trace_admin_entry_cursor_invalid', 'validation');
    }

    const target = await firestore.getDocument(TRACE_SESSIONS, sessionId);
    if (!target) {
      return errorResponse(request, env, context, 404,
        'trace session was not found', 'trace_session_not_found', 'validation');
    }
    await appendAccessAudit(firestore, env, session.uid, sessionId);
    const page = await loadWeeklyPlanningTraceAdminEntryPage(
      firestore,
      sessionId,
      target,
      afterSequence,
      pageLimit(body.limit),
    );
    return jsonResponse(request, env, context, 200, {
      ok: true,
      entries: safeWeeklyPlanningTraceDocumentsForAdmin(page.entries),
      totalEntryCount: page.totalEntryCount,
      nextAfterSequence: page.nextAfterSequence,
      missingSequenceCount: page.missingSequenceCount,
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'trace page request failed';
    console.error('[Weekly Planning Trace] admin entry page failed', {
      endpoint: ENDPOINT,
      correlationId: context.correlationId,
      message,
    });
    if (message.includes('Firestore')) {
      return errorResponse(request, env, context, 503,
        '週間計画traceの保存先から取得できませんでした。',
        'trace_storage_unavailable', 'storage', true);
    }
    if (message.includes('invalid') || message.includes('required')) {
      return errorResponse(request, env, context, 400,
        message, 'trace_validation_failed', 'validation');
    }
    return errorResponse(request, env, context, 500,
      '週間計画traceを処理できませんでした。',
      'trace_internal_error', 'internal', true);
  }
}
