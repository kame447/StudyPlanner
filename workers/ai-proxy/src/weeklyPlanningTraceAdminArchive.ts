import {
  WEEKLY_PLANNING_TRACE_ADMIN_ENTRY_PAGING,
  WEEKLY_PLANNING_TRACE_CONTRACT_VERSION,
  WEEKLY_PLANNING_TRACE_WORKER_REVISION,
} from '../../../shared/weeklyPlanningTraceContract';
import {
  WeeklyPlanningTraceFirestoreClient,
  type WeeklyPlanningTraceFirestoreEnv,
} from './weeklyPlanningTraceFirestore';
import {
  createWeeklyPlanningTraceSubject,
  isWeeklyPlanningTraceSessionId,
  parseWeeklyPlanningTraceHmacSecrets,
  resolveWeeklyPlanningTraceEpoch,
  weeklyPlanningTraceExpireAt,
} from './weeklyPlanningTracePrivacy';

const TRACE_SESSIONS = 'weekly_planning_trace_sessions';
const TRACE_ACCESS_AUDIT = 'weekly_planning_trace_access_audit';
const ADMINS = 'admins';
const ENDPOINT = '/weekly-planning-trace/admin/archive';

export interface WeeklyPlanningTraceAdminArchiveEnv
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

export type WeeklyPlanningTraceArchiveEntryCountResolution =
  | { ok: true; archivedEntryCount: number }
  | { ok: false; reason: 'stored_count_invalid' | 'requested_count_invalid' | 'requested_count_ahead' };

function allowedOrigins(env: WeeklyPlanningTraceAdminArchiveEnv): Set<string> {
  return new Set((env.ALLOWED_ORIGIN ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean));
}

function corsOrigin(
  request: Request,
  env: WeeklyPlanningTraceAdminArchiveEnv,
): string | null {
  const origin = request.headers.get('Origin')?.trim();
  if (!origin) return null;
  return allowedOrigins(env).has(origin) ? origin : '';
}

function workerRevision(env: WeeklyPlanningTraceAdminArchiveEnv): string {
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
  env: WeeklyPlanningTraceAdminArchiveEnv,
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
  env: WeeklyPlanningTraceAdminArchiveEnv,
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
  env: WeeklyPlanningTraceAdminArchiveEnv,
  context: TraceRequestContext,
  status: number,
  message: string,
  code: string,
  category: 'auth' | 'validation' | 'conflict' | 'storage' | 'internal',
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
  env: WeeklyPlanningTraceAdminArchiveEnv,
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

function safeEntryCount(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= WEEKLY_PLANNING_TRACE_ADMIN_ENTRY_PAGING.maxEntryCount
    ? value
    : null;
}

export function resolveWeeklyPlanningTraceArchiveEntryCount(
  target: Record<string, unknown>,
  requestedEntryCount: unknown,
): WeeklyPlanningTraceArchiveEntryCountResolution {
  const storedEntryCount = safeEntryCount(target.entryCount);
  if (storedEntryCount === null) return { ok: false, reason: 'stored_count_invalid' };
  const requested = safeEntryCount(requestedEntryCount);
  if (requested === null) return { ok: false, reason: 'requested_count_invalid' };
  if (requested > storedEntryCount) return { ok: false, reason: 'requested_count_ahead' };
  return { ok: true, archivedEntryCount: requested };
}

async function appendAccessAudit(
  firestore: WeeklyPlanningTraceFirestoreClient,
  env: WeeklyPlanningTraceAdminArchiveEnv,
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
    action: 'archive_session',
    targetSessionId: sessionId,
    occurredAt: now.toISOString(),
    expireAt: weeklyPlanningTraceExpireAt(now),
  });
}

export async function handleWeeklyPlanningTraceAdminArchive(
  request: Request,
  rawEnv: Record<string, unknown>,
): Promise<Response> {
  const env = rawEnv as unknown as WeeklyPlanningTraceAdminArchiveEnv;
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
        'trace管理権限がありません。', 'trace_admin_forbidden', 'auth');
    }

    const body = await request.json() as Record<string, unknown>;
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
    if (!isWeeklyPlanningTraceSessionId(sessionId)) {
      return errorResponse(request, env, context, 400,
        'sessionId is invalid', 'trace_session_id_invalid', 'validation');
    }

    const target = await firestore.getDocument(TRACE_SESSIONS, sessionId);
    if (!target) {
      return errorResponse(request, env, context, 404,
        'trace session was not found', 'trace_session_not_found', 'validation');
    }
    const resolved = resolveWeeklyPlanningTraceArchiveEntryCount(
      target,
      body.expectedEntryCount,
    );
    if (!resolved.ok) {
      if (resolved.reason === 'requested_count_ahead') {
        return errorResponse(request, env, context, 409,
          'export対象のentry数が保存済みsessionを超えています。再読込してください。',
          'trace_archive_snapshot_ahead', 'conflict');
      }
      return errorResponse(request, env, context, 400,
        'export済みentry件数を確認できません。最新版の管理画面から再度exportしてください。',
        'trace_archive_entry_count_invalid', 'validation');
    }

    const archivedAt = new Date().toISOString();
    await firestore.setDocument(TRACE_SESSIONS, sessionId, {
      archivedAt,
      archivedEntryCount: resolved.archivedEntryCount,
    }, ['archivedAt', 'archivedEntryCount']);
    await appendAccessAudit(firestore, env, session.uid, sessionId);
    return jsonResponse(request, env, context, 200, {
      ok: true,
      sessionId,
      archivedAt,
      archivedEntryCount: resolved.archivedEntryCount,
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'trace archive request failed';
    console.error('[Weekly Planning Trace] admin archive failed', {
      endpoint: ENDPOINT,
      correlationId: context.correlationId,
      message,
    });
    if (message.includes('Firestore')) {
      return errorResponse(request, env, context, 503,
        '週間計画traceの保存先を更新できませんでした。',
        'trace_storage_unavailable', 'storage', true);
    }
    if (message.includes('invalid') || message.includes('required')) {
      return errorResponse(request, env, context, 400,
        message, 'trace_validation_failed', 'validation');
    }
    return errorResponse(request, env, context, 500,
      '週間計画traceをアーカイブできませんでした。',
      'trace_internal_error', 'internal', true);
  }
}
