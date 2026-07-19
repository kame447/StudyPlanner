import {
  WEEKLY_PLANNING_TRACE_POLICY_VERSION,
  createWeeklyPlanningTraceSubject,
  isWeeklyPlanningTracePolicyAccepted,
  parseWeeklyPlanningTraceHmacSecrets,
  prepareWeeklyPlanningTraceWrite,
  redactWeeklyPlanningTraceValue,
  resolveWeeklyPlanningTraceEpoch,
  traceSubjectEpochsForDeletion,
  weeklyPlanningTraceExpireAt,
  type WeeklyPlanningTraceWriteInput,
} from './weeklyPlanningTracePrivacy';
import {
  WeeklyPlanningTraceFirestoreClient,
  type WeeklyPlanningTraceFirestoreEnv,
} from './weeklyPlanningTraceFirestore';

export interface WeeklyPlanningTraceApiEnv extends WeeklyPlanningTraceFirestoreEnv {
  WEEKLY_PLANNING_TRACE_HMAC_SECRETS: string;
}

export interface WeeklyPlanningTraceApiSession {
  uid: string;
}

export interface WeeklyPlanningTraceApiResult {
  status: number;
  body: Record<string, unknown>;
}

const TRACE_SESSIONS = 'weekly_planning_trace_sessions';
const TRACE_ENTRIES = 'weekly_planning_trace_entries';
const TRACE_ACCESS_AUDIT = 'weekly_planning_trace_access_audit';
const PROFILES = 'profiles';
const ADMINS = 'admins';
const MAX_TRACE_API_BODY_BYTES = 512 * 1024;
const ADMIN_LIST_LIMIT = 500;

function ok(body: Record<string, unknown> = {}): WeeklyPlanningTraceApiResult {
  return { status: 200, body: { ok: true, ...body } };
}

function error(status: number, message: string): WeeklyPlanningTraceApiResult {
  return { status, body: { ok: false, error: message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  const declaredLength = Number.parseInt(request.headers.get('Content-Length') ?? '', 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_TRACE_API_BODY_BYTES) {
    throw new Error('trace request body was too large');
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_TRACE_API_BODY_BYTES) {
    throw new Error('trace request body was too large');
  }
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed)) throw new Error('trace request body must be an object');
  return parsed;
}

function currentSecretRing(env: WeeklyPlanningTraceApiEnv) {
  return parseWeeklyPlanningTraceHmacSecrets(env.WEEKLY_PLANNING_TRACE_HMAC_SECRETS);
}

async function currentSubject(
  uid: string,
  env: WeeklyPlanningTraceApiEnv,
  now = new Date(),
) {
  const epoch = resolveWeeklyPlanningTraceEpoch(now);
  return await createWeeklyPlanningTraceSubject(uid, epoch, currentSecretRing(env));
}

async function policyAcceptance(
  firestore: WeeklyPlanningTraceFirestoreClient,
  uid: string,
): Promise<unknown> {
  const profile = await firestore.getDocument(PROFILES, uid);
  return profile?.weeklyPlanningTracePolicy;
}

async function requireTraceReader(
  firestore: WeeklyPlanningTraceFirestoreClient,
  uid: string,
): Promise<boolean> {
  const admin = await firestore.getDocument(ADMINS, uid);
  return admin?.enabled === true && admin?.weeklyPlanningTraceReader === true;
}

async function appendAccessAudit(
  firestore: WeeklyPlanningTraceFirestoreClient,
  env: WeeklyPlanningTraceApiEnv,
  session: WeeklyPlanningTraceApiSession,
  action: string,
  targetSessionId: string | null,
): Promise<void> {
  const now = new Date();
  const actor = await currentSubject(session.uid, env, now);
  const id = `trace-audit:${now.getTime()}:${crypto.randomUUID()}`;
  await firestore.setImmutableDocument(TRACE_ACCESS_AUDIT, id, {
    id,
    actorToken: actor.token,
    actorEpoch: actor.epoch,
    action,
    targetSessionId,
    occurredAt: now.toISOString(),
    expireAt: weeklyPlanningTraceExpireAt(now),
  });
}

const TRACE_STRUCTURAL_KEYS = ['id', 'sessionId', 'logicalConversationId'] as const;

export function safeWeeklyPlanningTraceDocumentsForAdmin(
  documents: Record<string, unknown>[],
): Record<string, unknown>[] {
  return documents.flatMap((document) => {
    const redacted = redactWeeklyPlanningTraceValue(document);
    if (!isRecord(redacted)) return [];
    TRACE_STRUCTURAL_KEYS.forEach((key) => {
      const value = document[key];
      if (typeof value === 'string' && /^[A-Za-z0-9:_-]{1,240}$/.test(value)) {
        redacted[key] = value;
      }
    });
    return [redacted];
  });
}

async function handlePolicyStatus(
  firestore: WeeklyPlanningTraceFirestoreClient,
  session: WeeklyPlanningTraceApiSession,
): Promise<WeeklyPlanningTraceApiResult> {
  const acceptance = await policyAcceptance(firestore, session.uid);
  return ok({
    policyVersion: WEEKLY_PLANNING_TRACE_POLICY_VERSION,
    accepted: isWeeklyPlanningTracePolicyAccepted(acceptance),
    acceptedAt: isRecord(acceptance) && typeof acceptance.acceptedAt === 'string'
      ? acceptance.acceptedAt
      : null,
  });
}

async function handlePolicyAccept(
  firestore: WeeklyPlanningTraceFirestoreClient,
  session: WeeklyPlanningTraceApiSession,
): Promise<WeeklyPlanningTraceApiResult> {
  const acceptedAt = new Date().toISOString();
  await firestore.setDocument(PROFILES, session.uid, {
    weeklyPlanningTracePolicy: {
      version: WEEKLY_PLANNING_TRACE_POLICY_VERSION,
      acceptedAt,
    },
  }, ['weeklyPlanningTracePolicy']);
  return ok({
    accepted: true,
    acceptedAt,
    policyVersion: WEEKLY_PLANNING_TRACE_POLICY_VERSION,
  });
}

async function handleAppend(
  request: Request,
  firestore: WeeklyPlanningTraceFirestoreClient,
  env: WeeklyPlanningTraceApiEnv,
  session: WeeklyPlanningTraceApiSession,
): Promise<WeeklyPlanningTraceApiResult> {
  const acceptance = await policyAcceptance(firestore, session.uid);
  if (!isWeeklyPlanningTracePolicyAccepted(acceptance)) {
    return error(412, '週間計画traceの利用同意が必要です。');
  }
  const payload = await parseJsonBody(request);
  const subject = await currentSubject(session.uid, env);
  const prepared = prepareWeeklyPlanningTraceWrite(
    payload as unknown as WeeklyPlanningTraceWriteInput,
    subject,
  );
  const sessionId = String(prepared.session.id);
  const existingSession = await firestore.getDocument(TRACE_SESSIONS, sessionId);
  if (
    existingSession
    && existingSession.traceSubjectToken !== prepared.session.traceSubjectToken
  ) {
    return error(409, 'trace session ownership conflict');
  }
  const mergedSession = {
    ...(existingSession ?? {}),
    ...prepared.session,
    ...(existingSession?.archivedAt ? { archivedAt: existingSession.archivedAt } : {}),
  };
  delete mergedSession.userId;
  await firestore.setDocument(TRACE_SESSIONS, sessionId, mergedSession);
  for (const entry of prepared.entries) {
    await firestore.setImmutableDocument(TRACE_ENTRIES, String(entry.id), entry);
  }
  return ok({
    sessionId,
    acceptedEntries: prepared.entries.length,
    traceSubjectEpoch: subject.epoch,
  });
}

async function handleDelete(
  firestore: WeeklyPlanningTraceFirestoreClient,
  env: WeeklyPlanningTraceApiEnv,
  session: WeeklyPlanningTraceApiSession,
): Promise<WeeklyPlanningTraceApiResult> {
  const ring = currentSecretRing(env);
  const subjects = await Promise.all(
    traceSubjectEpochsForDeletion(ring).map((epoch) =>
      createWeeklyPlanningTraceSubject(session.uid, epoch, ring),
    ),
  );
  const tokens = subjects.map((subject) => subject.token);
  const deletedEntries = await firestore.deleteByStringField(
    TRACE_ENTRIES,
    'traceSubjectToken',
    tokens,
  );
  const deletedSessions = await firestore.deleteByStringField(
    TRACE_SESSIONS,
    'traceSubjectToken',
    tokens,
  );
  return ok({ deletedEntries, deletedSessions });
}

async function handleAdminSessions(
  firestore: WeeklyPlanningTraceFirestoreClient,
  env: WeeklyPlanningTraceApiEnv,
  session: WeeklyPlanningTraceApiSession,
): Promise<WeeklyPlanningTraceApiResult> {
  if (!(await requireTraceReader(firestore, session.uid))) {
    return error(403, 'trace閲覧権限がありません。');
  }
  await appendAccessAudit(firestore, env, session, 'list_sessions', null);
  const sessions = await firestore.queryDocuments(TRACE_SESSIONS, [], ADMIN_LIST_LIMIT);
  return ok({ sessions: safeWeeklyPlanningTraceDocumentsForAdmin(sessions) });
}

async function handleAdminEntries(
  request: Request,
  firestore: WeeklyPlanningTraceFirestoreClient,
  env: WeeklyPlanningTraceApiEnv,
  session: WeeklyPlanningTraceApiSession,
): Promise<WeeklyPlanningTraceApiResult> {
  if (!(await requireTraceReader(firestore, session.uid))) {
    return error(403, 'trace閲覧権限がありません。');
  }
  const body = await parseJsonBody(request);
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!sessionId) return error(400, 'sessionId is required');
  const target = await firestore.getDocument(TRACE_SESSIONS, sessionId);
  if (!target) return error(404, 'trace session was not found');
  await appendAccessAudit(firestore, env, session, 'list_entries', sessionId);
  const rawEntryCount = target.entryCount;
  const entryCount = typeof rawEntryCount === 'number' && Number.isFinite(rawEntryCount)
    ? Math.max(0, Math.min(ADMIN_LIST_LIMIT, Math.trunc(rawEntryCount)))
    : 0;
  const entries = (await Promise.all(
    Array.from({ length: entryCount }, (_, sequence) =>
      firestore.getDocument(
        TRACE_ENTRIES,
        `${sessionId}-${String(sequence).padStart(8, '0')}`,
      )),
  ))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => ({ ...entry, sessionId }));
  return ok({ entries: safeWeeklyPlanningTraceDocumentsForAdmin(entries) });
}

async function handleAdminArchive(
  request: Request,
  firestore: WeeklyPlanningTraceFirestoreClient,
  env: WeeklyPlanningTraceApiEnv,
  session: WeeklyPlanningTraceApiSession,
): Promise<WeeklyPlanningTraceApiResult> {
  if (!(await requireTraceReader(firestore, session.uid))) {
    return error(403, 'trace管理権限がありません。');
  }
  const body = await parseJsonBody(request);
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!sessionId) return error(400, 'sessionId is required');
  const target = await firestore.getDocument(TRACE_SESSIONS, sessionId);
  if (!target) return error(404, 'trace session was not found');
  const archivedAt = new Date().toISOString();
  await firestore.setDocument(TRACE_SESSIONS, sessionId, { archivedAt }, ['archivedAt']);
  await appendAccessAudit(firestore, env, session, 'archive_session', sessionId);
  return ok({ sessionId, archivedAt });
}

export function isWeeklyPlanningTracePath(pathname: string): boolean {
  return pathname.startsWith('/weekly-planning-trace/');
}

export async function handleWeeklyPlanningTraceApi(
  request: Request,
  env: WeeklyPlanningTraceApiEnv,
  session: WeeklyPlanningTraceApiSession,
): Promise<WeeklyPlanningTraceApiResult> {
  const { pathname } = new URL(request.url);
  const firestore = new WeeklyPlanningTraceFirestoreClient(env);
  try {
    if (pathname === '/weekly-planning-trace/policy' && request.method === 'GET') {
      return await handlePolicyStatus(firestore, session);
    }
    if (pathname === '/weekly-planning-trace/policy/accept' && request.method === 'POST') {
      return await handlePolicyAccept(firestore, session);
    }
    if (pathname === '/weekly-planning-trace/append' && request.method === 'POST') {
      return await handleAppend(request, firestore, env, session);
    }
    if (pathname === '/weekly-planning-trace/delete' && request.method === 'POST') {
      return await handleDelete(firestore, env, session);
    }
    if (pathname === '/weekly-planning-trace/admin/sessions' && request.method === 'GET') {
      return await handleAdminSessions(firestore, env, session);
    }
    if (pathname === '/weekly-planning-trace/admin/entries' && request.method === 'POST') {
      return await handleAdminEntries(request, firestore, env, session);
    }
    if (pathname === '/weekly-planning-trace/admin/archive' && request.method === 'POST') {
      return await handleAdminArchive(request, firestore, env, session);
    }
    return error(404, 'weekly planning trace endpoint was not found');
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'weekly planning trace request failed';
    if (message.includes('too large')) return error(413, message);
    if (message.includes('invalid') || message.includes('required') || message.includes('mismatch')) {
      return error(400, message);
    }
    if (message.includes('conflict')) return error(409, message);
    console.error('[Weekly Planning Trace] server request failed', { pathname, message });
    return error(500, '週間計画traceを処理できませんでした。');
  }
}
