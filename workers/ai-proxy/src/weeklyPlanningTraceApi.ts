import {
  WEEKLY_PLANNING_TRACE_CONTRACT_VERSION,
  WEEKLY_PLANNING_TRACE_HEADERS,
  WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS,
  WEEKLY_PLANNING_TRACE_WORKER_REVISION,
} from '../../../shared/weeklyPlanningTraceContract';
import {
  WEEKLY_PLANNING_TRACE_POLICY_VERSION,
  createWeeklyPlanningTraceCanonicalIds,
  createWeeklyPlanningTraceSubject,
  isWeeklyPlanningTraceConversationId,
  isWeeklyPlanningTraceEntryId,
  isWeeklyPlanningLegacyTraceSessionHandle,
  isWeeklyPlanningTracePolicyAccepted,
  isWeeklyPlanningTraceSessionId,
  parseWeeklyPlanningTraceHmacSecrets,
  prepareWeeklyPlanningTraceServerWrite,
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
  WEEKLY_PLANNING_TRACE_WORKER_REVISION?: string;
}

export interface WeeklyPlanningTraceApiSession {
  uid: string;
}

export interface WeeklyPlanningTraceApiResult {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

type TraceErrorCategory =
  | 'auth'
  | 'policy'
  | 'contract'
  | 'validation'
  | 'conflict'
  | 'storage'
  | 'internal';

interface TraceRequestContext {
  pathname: string;
  correlationId: string;
  workerRevision: string;
}

const TRACE_SESSIONS = 'weekly_planning_trace_sessions';
const TRACE_ENTRIES = 'weekly_planning_trace_entries';
const TRACE_ACCESS_AUDIT = 'weekly_planning_trace_access_audit';
const PROFILES = 'profiles';
const ADMINS = 'admins';
const ADMIN_LIST_LIMIT = 500;
const TRACE_STORAGE_LAYOUT_VERSION = 2;

function correlationId(request: Request): string {
  const supplied = request.headers.get(WEEKLY_PLANNING_TRACE_HEADERS.correlationId)?.trim();
  if (supplied && /^[A-Za-z0-9._:-]{8,160}$/.test(supplied)) return supplied;
  return crypto.randomUUID();
}

function workerRevision(env: WeeklyPlanningTraceApiEnv): string {
  return env.WEEKLY_PLANNING_TRACE_WORKER_REVISION?.trim()
    || WEEKLY_PLANNING_TRACE_WORKER_REVISION;
}

function responseHeaders(context: TraceRequestContext): Record<string, string> {
  return {
    [WEEKLY_PLANNING_TRACE_HEADERS.contractVersion]: WEEKLY_PLANNING_TRACE_CONTRACT_VERSION,
    [WEEKLY_PLANNING_TRACE_HEADERS.workerRevision]: context.workerRevision,
    [WEEKLY_PLANNING_TRACE_HEADERS.correlationId]: context.correlationId,
  };
}

function envelope(
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

function ok(
  context: TraceRequestContext,
  body: Record<string, unknown> = {},
): WeeklyPlanningTraceApiResult {
  return {
    status: 200,
    body: envelope(context, { ok: true, ...body }),
    headers: responseHeaders(context),
  };
}

function error(
  context: TraceRequestContext,
  status: number,
  message: string,
  code: string,
  category: TraceErrorCategory,
  retryable = false,
): WeeklyPlanningTraceApiResult {
  return {
    status,
    body: envelope(context, {
      ok: false,
      error: message,
      errorCode: code,
      errorCategory: category,
      retryable,
    }),
    headers: responseHeaders(context),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  const declaredLength = Number.parseInt(request.headers.get('Content-Length') ?? '', 10);
  if (Number.isFinite(declaredLength)
    && declaredLength > WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxRequestBodyBytes) {
    throw new Error('trace request body was too large');
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength
    > WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxRequestBodyBytes) {
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

async function retainedSubjectTokens(
  uid: string,
  env: WeeklyPlanningTraceApiEnv,
): Promise<Set<string>> {
  const ring = currentSecretRing(env);
  const subjects = await Promise.all(
    Object.keys(ring).map((epoch) => createWeeklyPlanningTraceSubject(uid, epoch, ring)),
  );
  return new Set(subjects.map((subject) => subject.token));
}

function isOwnedServerSession(
  document: Record<string, unknown>,
  subjectTokens: Set<string>,
): boolean {
  return typeof document.traceSubjectToken === 'string'
    && subjectTokens.has(document.traceSubjectToken);
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

function isSafeTraceStructuralValue(
  key: 'id' | 'sessionId' | 'logicalConversationId',
  value: unknown,
  document: Record<string, unknown>,
): value is string {
  if (key === 'sessionId') return isWeeklyPlanningTraceSessionId(value);
  if (key === 'logicalConversationId') return isWeeklyPlanningTraceConversationId(value);
  if (isWeeklyPlanningTraceSessionId(value) || isWeeklyPlanningTraceConversationId(value)) return true;
  return isWeeklyPlanningTraceEntryId(
    value,
    typeof document.sessionId === 'string' ? document.sessionId : undefined,
  );
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
      if (isSafeTraceStructuralValue(key, value, document)) redacted[key] = value;
    });
    return [redacted];
  });
}

function boundedAdminEntryCount(target: Record<string, unknown>): number {
  const rawEntryCount = target.entryCount;
  return typeof rawEntryCount === 'number' && Number.isFinite(rawEntryCount)
    ? Math.max(0, Math.min(ADMIN_LIST_LIMIT, Math.trunc(rawEntryCount)))
    : 0;
}

function normalizeAdminTraceEntry(
  entry: Record<string, unknown> | null,
  sessionId: string,
  expectedSequence?: number,
): Record<string, unknown> | null {
  if (!entry) return null;
  const sequence = expectedSequence ?? entry.sequence;
  if (typeof sequence !== 'number'
    || !Number.isSafeInteger(sequence)
    || sequence < 0
    || sequence >= ADMIN_LIST_LIMIT) return null;
  const expectedId = `${sessionId}-${String(sequence).padStart(8, '0')}`;
  if (entry.id !== expectedId) return null;
  return { ...entry, id: expectedId, sessionId, sequence };
}

async function loadAdminTraceEntries(
  firestore: WeeklyPlanningTraceFirestoreClient,
  sessionId: string,
  target: Record<string, unknown>,
  useSessionQuery: boolean,
): Promise<Record<string, unknown>[]> {
  const entryCount = boundedAdminEntryCount(target);
  const entriesBySequence = new Map<number, Record<string, unknown>>();

  if (useSessionQuery) {
    const queriedEntries = await firestore.queryDocuments(
      TRACE_ENTRIES,
      [{ field: 'sessionId', value: sessionId }],
      ADMIN_LIST_LIMIT,
    );
    queriedEntries.forEach((entry) => {
      const normalized = normalizeAdminTraceEntry(entry, sessionId);
      if (!normalized) return;
      const sequence = normalized.sequence as number;
      if (sequence < entryCount) entriesBySequence.set(sequence, normalized);
    });
  }

  const missingSequences = Array.from(
    { length: entryCount },
    (_, sequence) => sequence,
  ).filter((sequence) => !entriesBySequence.has(sequence));

  const recoveredEntries = await Promise.all(
    missingSequences.map(async (sequence) => normalizeAdminTraceEntry(
      await firestore.getDocument(
        TRACE_ENTRIES,
        `${sessionId}-${String(sequence).padStart(8, '0')}`,
      ),
      sessionId,
      sequence,
    )),
  );
  recoveredEntries.forEach((entry) => {
    if (entry) entriesBySequence.set(entry.sequence as number, entry);
  });

  return Array.from(entriesBySequence.values())
    .sort((left, right) => Number(left.sequence) - Number(right.sequence));
}

async function handlePolicyStatus(
  context: TraceRequestContext,
  firestore: WeeklyPlanningTraceFirestoreClient,
  session: WeeklyPlanningTraceApiSession,
): Promise<WeeklyPlanningTraceApiResult> {
  const acceptance = await policyAcceptance(firestore, session.uid);
  return ok(context, {
    policyVersion: WEEKLY_PLANNING_TRACE_POLICY_VERSION,
    accepted: isWeeklyPlanningTracePolicyAccepted(acceptance),
    acceptedAt: isRecord(acceptance) && typeof acceptance.acceptedAt === 'string'
      ? acceptance.acceptedAt
      : null,
  });
}

async function handlePolicyAccept(
  context: TraceRequestContext,
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
  return ok(context, {
    accepted: true,
    acceptedAt,
    policyVersion: WEEKLY_PLANNING_TRACE_POLICY_VERSION,
  });
}

async function handleSessionStart(
  context: TraceRequestContext,
  request: Request,
  firestore: WeeklyPlanningTraceFirestoreClient,
  env: WeeklyPlanningTraceApiEnv,
  session: WeeklyPlanningTraceApiSession,
): Promise<WeeklyPlanningTraceApiResult> {
  const acceptance = await policyAcceptance(firestore, session.uid);
  if (!isWeeklyPlanningTracePolicyAccepted(acceptance)) {
    return error(context, 412, '週間計画traceの利用同意が必要です。',
      'trace_policy_required', 'policy');
  }
  const body = await parseJsonBody(request);
  const metadata = isRecord(body.session) ? body.session : null;
  if (!metadata) {
    return error(context, 400, 'trace session payload is invalid',
      'trace_session_payload_invalid', 'validation');
  }
  const now = new Date();
  const epoch = resolveWeeklyPlanningTraceEpoch(now);
  const ring = currentSecretRing(env);
  const canonicalIds = await createWeeklyPlanningTraceCanonicalIds({
    uid: session.uid,
    epoch,
    secretRing: ring,
    sessionCorrelationKey: body.idempotencyKey,
    conversationCorrelationKey: body.conversationCorrelationKey,
  });
  const subject = await createWeeklyPlanningTraceSubject(session.uid, epoch, ring);
  const initialStartedAt = typeof metadata.startedAt === 'string'
    ? metadata.startedAt
    : now.toISOString();
  const prepared = prepareWeeklyPlanningTraceServerWrite({
    session: {
      ...metadata,
      status: 'active',
      startedAt: initialStartedAt,
      lastActivityAt: initialStartedAt,
      turnCount: 0,
      entryCount: 0,
      hasPreview: false,
      hasApprovalFailure: false,
      hasFallback: false,
      hasError: false,
    },
    entries: [],
  }, subject, canonicalIds, now);
  const existing = await firestore.getDocument(TRACE_SESSIONS, canonicalIds.sessionId);
  if (existing) {
    const ownerTokens = await retainedSubjectTokens(session.uid, env);
    if (!isOwnedServerSession(existing, ownerTokens)) {
      return error(context, 409, 'trace session ownership conflict',
        'trace_session_ownership_conflict', 'conflict');
    }
    if (existing.logicalConversationId !== canonicalIds.logicalConversationId
      || existing.serverIssued !== true
      || existing.storageLayoutVersion !== TRACE_STORAGE_LAYOUT_VERSION) {
      return error(context, 409, 'trace session issuance conflict',
        'trace_session_issuance_conflict', 'conflict');
    }
    return ok(context, canonicalIds);
  }
  try {
    await firestore.setImmutableDocument(TRACE_SESSIONS, canonicalIds.sessionId, {
      ...prepared.session,
      entryCount: 0,
      serverIssued: true,
      storageLayoutVersion: TRACE_STORAGE_LAYOUT_VERSION,
    });
  } catch (caught) {
    if (!(caught instanceof Error)
      || !caught.message.includes('immutable trace document conflict')) throw caught;
    const raced = await firestore.getDocument(TRACE_SESSIONS, canonicalIds.sessionId);
    const ownerTokens = await retainedSubjectTokens(session.uid, env);
    if (!raced || !isOwnedServerSession(raced, ownerTokens)) throw caught;
  }
  console.info('[Weekly Planning Trace] session start', {
    correlationId: context.correlationId,
    sessionId: canonicalIds.sessionId,
    logicalConversationId: canonicalIds.logicalConversationId,
  });
  return ok(context, canonicalIds);
}

function traceSessionConflict(
  existing: Record<string, unknown> | null,
  next: Record<string, unknown>,
): string | null {
  if (!existing) return null;
  if (existing.logicalConversationId !== next.logicalConversationId) {
    return 'trace session conversation conflict';
  }
  const oldCount = existing.entryCount;
  const nextCount = next.entryCount;
  if (typeof oldCount === 'number'
    && typeof nextCount === 'number'
    && nextCount < oldCount) return 'trace session entryCount conflict';
  return null;
}

function mergeTraceSession(
  existing: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const merged = {
    ...existing,
    ...next,
    id: existing.id,
    logicalConversationId: existing.logicalConversationId,
    traceSubjectToken: existing.traceSubjectToken,
    traceSubjectEpoch: existing.traceSubjectEpoch,
    serverIssued: true,
    storageLayoutVersion: TRACE_STORAGE_LAYOUT_VERSION,
    ...(existing.archivedAt ? { archivedAt: existing.archivedAt } : {}),
  };
  delete merged.userId;
  return merged;
}

async function handleAppend(
  context: TraceRequestContext,
  request: Request,
  firestore: WeeklyPlanningTraceFirestoreClient,
  env: WeeklyPlanningTraceApiEnv,
  session: WeeklyPlanningTraceApiSession,
): Promise<WeeklyPlanningTraceApiResult> {
  const acceptance = await policyAcceptance(firestore, session.uid);
  if (!isWeeklyPlanningTracePolicyAccepted(acceptance)) {
    return error(context, 412, '週間計画traceの利用同意が必要です。',
      'trace_policy_required', 'policy');
  }
  const payload = await parseJsonBody(request);
  if (!isRecord(payload.session)) {
    return error(context, 400, 'trace session payload is invalid',
      'trace_session_payload_invalid', 'validation');
  }
  const sessionId = typeof payload.session.id === 'string' ? payload.session.id.trim() : '';
  if (!isWeeklyPlanningTraceSessionId(sessionId)) {
    return error(context, 400, 'trace session id is invalid',
      'trace_session_id_invalid', 'validation');
  }
  const existingSession = await firestore.getDocument(TRACE_SESSIONS, sessionId);
  if (!existingSession) {
    return error(context, 404, 'trace session must be started before append',
      'trace_session_not_started', 'conflict');
  }
  const ownerTokens = await retainedSubjectTokens(session.uid, env);
  if (!isOwnedServerSession(existingSession, ownerTokens)) {
    return error(context, 409, 'trace session ownership conflict',
      'trace_session_ownership_conflict', 'conflict');
  }
  if (existingSession.serverIssued !== true
    || existingSession.storageLayoutVersion !== TRACE_STORAGE_LAYOUT_VERSION) {
    return error(context, 409, 'legacy trace session is read-only',
      'trace_session_legacy_read_only', 'conflict');
  }
  const logicalConversationId = typeof existingSession.logicalConversationId === 'string'
    ? existingSession.logicalConversationId
    : '';
  if (!isWeeklyPlanningTraceConversationId(logicalConversationId)) {
    return error(context, 409, 'trace session conversation conflict',
      'trace_session_conversation_conflict', 'conflict');
  }
  const subject = await currentSubject(session.uid, env);
  const prepared = prepareWeeklyPlanningTraceServerWrite(
    payload as unknown as WeeklyPlanningTraceWriteInput,
    subject,
    { sessionId, logicalConversationId },
  );
  const conflict = traceSessionConflict(existingSession, prepared.session);
  if (conflict) {
    return error(context, 409, conflict, 'trace_session_entry_count_conflict', 'conflict');
  }
  const mergedSession = mergeTraceSession(existingSession, prepared.session);
  if (typeof firestore.commitTraceAppend === 'function') {
    await firestore.commitTraceAppend({
      entryCollection: TRACE_ENTRIES,
      entries: prepared.entries.map((entry) => ({ id: String(entry.id), value: entry })),
      sessionCollection: TRACE_SESSIONS,
      sessionId,
      sessionValue: mergedSession,
      maximumFieldPath: 'entryCount',
      maximum: Number(prepared.session.entryCount),
    });
  } else {
    for (const entry of prepared.entries) {
      await firestore.setImmutableDocument(TRACE_ENTRIES, String(entry.id), entry);
    }
    await firestore.setDocumentWithMaximumInteger(
      TRACE_SESSIONS,
      sessionId,
      mergedSession,
      'entryCount',
      Number(prepared.session.entryCount),
    );
  }
  console.info('[Weekly Planning Trace] append committed', {
    correlationId: context.correlationId,
    sessionId,
    entryCount: prepared.entries.length,
    sequenceEnd: Number(prepared.session.entryCount) - 1,
  });
  return ok(context, {
    sessionId,
    acceptedEntries: prepared.entries.length,
    traceSubjectEpoch: subject.epoch,
  });
}

async function handleDelete(
  context: TraceRequestContext,
  firestore: WeeklyPlanningTraceFirestoreClient,
  env: WeeklyPlanningTraceApiEnv,
  session: WeeklyPlanningTraceApiSession,
): Promise<WeeklyPlanningTraceApiResult> {
  const ring = currentSecretRing(env);
  const subjects = await Promise.all(
    traceSubjectEpochsForDeletion(ring).map((epoch) =>
      createWeeklyPlanningTraceSubject(session.uid, epoch, ring)),
  );
  const tokens = subjects.map((subject) => subject.token);
  const deletedEntries = await firestore.deleteByStringField(
    TRACE_ENTRIES, 'traceSubjectToken', tokens,
  );
  const deletedSessions = await firestore.deleteByStringField(
    TRACE_SESSIONS, 'traceSubjectToken', tokens,
  );
  return ok(context, { deletedEntries, deletedSessions });
}

async function handleAdminSessions(
  context: TraceRequestContext,
  firestore: WeeklyPlanningTraceFirestoreClient,
  env: WeeklyPlanningTraceApiEnv,
  session: WeeklyPlanningTraceApiSession,
): Promise<WeeklyPlanningTraceApiResult> {
  if (!(await requireTraceReader(firestore, session.uid))) {
    return error(context, 403, 'trace閲覧権限がありません。',
      'trace_reader_forbidden', 'auth');
  }
  await appendAccessAudit(firestore, env, session, 'list_sessions', null);
  const sessions = await firestore.queryDocuments(TRACE_SESSIONS, [], ADMIN_LIST_LIMIT);
  return ok(context, {
    rawCount: sessions.length,
    sessions: safeWeeklyPlanningTraceDocumentsForAdmin(sessions),
  });
}

async function handleAdminEntries(
  context: TraceRequestContext,
  request: Request,
  firestore: WeeklyPlanningTraceFirestoreClient,
  env: WeeklyPlanningTraceApiEnv,
  session: WeeklyPlanningTraceApiSession,
): Promise<WeeklyPlanningTraceApiResult> {
  if (!(await requireTraceReader(firestore, session.uid))) {
    return error(context, 403, 'trace閲覧権限がありません。',
      'trace_reader_forbidden', 'auth');
  }
  const body = await parseJsonBody(request);
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!sessionId) {
    return error(context, 400, 'sessionId is required',
      'trace_session_id_required', 'validation');
  }
  const isCurrentSessionId = isWeeklyPlanningTraceSessionId(sessionId);
  const isLegacySessionHandle = isWeeklyPlanningLegacyTraceSessionHandle(sessionId);
  if (!isCurrentSessionId && !isLegacySessionHandle) {
    return error(context, 400, 'sessionId is invalid',
      'trace_session_id_invalid', 'validation');
  }
  const target = await firestore.getDocument(TRACE_SESSIONS, sessionId);
  if (!target) {
    return error(context, 404, 'trace session was not found',
      'trace_session_not_found', 'validation');
  }
  await appendAccessAudit(firestore, env, session, 'list_entries', sessionId);
  const entries = await loadAdminTraceEntries(
    firestore,
    sessionId,
    target,
    isCurrentSessionId && target.storageLayoutVersion === TRACE_STORAGE_LAYOUT_VERSION,
  );
  const safeEntries = safeWeeklyPlanningTraceDocumentsForAdmin(entries);
  if (isLegacySessionHandle) {
    safeEntries.forEach((entry) => {
      const sequence = entry.sequence;
      if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0) return;
      entry.id = `${sessionId}-${String(sequence).padStart(8, '0')}`;
      entry.sessionId = sessionId;
    });
  }
  return ok(context, { entries: safeEntries });
}

async function handleAdminArchive(
  context: TraceRequestContext,
  request: Request,
  firestore: WeeklyPlanningTraceFirestoreClient,
  env: WeeklyPlanningTraceApiEnv,
  session: WeeklyPlanningTraceApiSession,
): Promise<WeeklyPlanningTraceApiResult> {
  if (!(await requireTraceReader(firestore, session.uid))) {
    return error(context, 403, 'trace管理権限がありません。',
      'trace_admin_forbidden', 'auth');
  }
  const body = await parseJsonBody(request);
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!sessionId || !isWeeklyPlanningTraceSessionId(sessionId)) {
    return error(context, 400, 'sessionId is invalid',
      'trace_session_id_invalid', 'validation');
  }
  const target = await firestore.getDocument(TRACE_SESSIONS, sessionId);
  if (!target) {
    return error(context, 404, 'trace session was not found',
      'trace_session_not_found', 'validation');
  }
  const archivedAt = new Date().toISOString();
  await firestore.setDocument(TRACE_SESSIONS, sessionId, { archivedAt }, ['archivedAt']);
  await appendAccessAudit(firestore, env, session, 'archive_session', sessionId);
  return ok(context, { sessionId, archivedAt });
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
  const context: TraceRequestContext = {
    pathname,
    correlationId: correlationId(request),
    workerRevision: workerRevision(env),
  };
  const suppliedContract = request.headers
    .get(WEEKLY_PLANNING_TRACE_HEADERS.contractVersion)?.trim();
  if (suppliedContract && suppliedContract !== WEEKLY_PLANNING_TRACE_CONTRACT_VERSION) {
    return error(context, 426, '週間計画traceのcontract versionが一致しません。',
      'trace_contract_mismatch', 'contract');
  }

  const firestore = new WeeklyPlanningTraceFirestoreClient(env);
  try {
    if (pathname === '/weekly-planning-trace/health' && request.method === 'GET') {
      return ok(context, {
        storageLayoutVersion: TRACE_STORAGE_LAYOUT_VERSION,
        limits: WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS,
      });
    }
    if (pathname === '/weekly-planning-trace/policy' && request.method === 'GET') {
      return await handlePolicyStatus(context, firestore, session);
    }
    if (pathname === '/weekly-planning-trace/policy/accept' && request.method === 'POST') {
      return await handlePolicyAccept(context, firestore, session);
    }
    if (pathname === '/weekly-planning-trace/session/start' && request.method === 'POST') {
      return await handleSessionStart(context, request, firestore, env, session);
    }
    if (pathname === '/weekly-planning-trace/append' && request.method === 'POST') {
      return await handleAppend(context, request, firestore, env, session);
    }
    if (pathname === '/weekly-planning-trace/delete' && request.method === 'POST') {
      return await handleDelete(context, firestore, env, session);
    }
    if (pathname === '/weekly-planning-trace/admin/sessions' && request.method === 'GET') {
      return await handleAdminSessions(context, firestore, env, session);
    }
    if (pathname === '/weekly-planning-trace/admin/entries' && request.method === 'POST') {
      return await handleAdminEntries(context, request, firestore, env, session);
    }
    if (pathname === '/weekly-planning-trace/admin/archive' && request.method === 'POST') {
      return await handleAdminArchive(context, request, firestore, env, session);
    }
    return error(context, 404, 'weekly planning trace endpoint was not found',
      'trace_endpoint_not_found', 'validation');
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'weekly planning trace request failed';
    let result: WeeklyPlanningTraceApiResult;
    if (message.includes('too large')) {
      result = error(context, 413, message, 'trace_request_too_large', 'validation');
    } else if (message.includes('invalid') || message.includes('required') || message.includes('mismatch')) {
      result = error(context, 400, message, 'trace_validation_failed', 'validation');
    } else if (message.includes('conflict')) {
      result = error(context, 409, message, 'trace_storage_conflict', 'conflict');
    } else if (message.includes('Firestore')) {
      result = error(context, 503, '週間計画traceの保存先へ書き込めませんでした。',
        'trace_storage_unavailable', 'storage', true);
    } else {
      result = error(context, 500, '週間計画traceを処理できませんでした。',
        'trace_internal_error', 'internal', true);
    }
    console.error('[Weekly Planning Trace] server request failed', {
      pathname,
      correlationId: context.correlationId,
      code: result.body.errorCode,
      message,
    });
    return result;
  }
}
