from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


privacy_path = Path('workers/ai-proxy/src/weeklyPlanningTracePrivacy.ts')
privacy = privacy_path.read_text()

privacy = replace_once(
    privacy,
    "export interface WeeklyPlanningTraceSubject {\n  token: string;\n  epoch: string;\n}\n",
    """export interface WeeklyPlanningTraceSubject {
  token: string;
  epoch: string;
}

export interface WeeklyPlanningTraceCanonicalIds {
  sessionId: string;
  logicalConversationId: string;
}
""",
    'canonical IDs interface',
)

canonical_helpers = r'''
function requireCorrelationKey(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} is invalid`);
  const normalized = value.trim();
  if (!normalized || normalized.length > 240 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

function uuidFromDigest(digest: Uint8Array): string {
  if (digest.length < 16) throw new Error('trace canonical ID digest is invalid');
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)]
    .join('-');
}

async function hmacDigest(
  secret: string,
  value: string,
  cryptoApi: Crypto,
): Promise<Uint8Array> {
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
    new TextEncoder().encode(value),
  );
  return new Uint8Array(signature);
}

export async function createWeeklyPlanningTraceCanonicalIds(params: {
  uid: string;
  epoch: string;
  secretRing: TraceHmacSecretRing;
  sessionCorrelationKey: unknown;
  conversationCorrelationKey: unknown;
  cryptoApi?: Crypto;
}): Promise<WeeklyPlanningTraceCanonicalIds> {
  const uid = params.uid.trim();
  const secret = params.secretRing[params.epoch];
  if (!uid) throw new Error('trace subject uid is empty');
  if (!secret) throw new Error(`trace HMAC secret is missing for epoch ${params.epoch}`);
  const sessionCorrelationKey = requireCorrelationKey(
    params.sessionCorrelationKey,
    'trace session idempotency key',
  );
  const conversationCorrelationKey = requireCorrelationKey(
    params.conversationCorrelationKey,
    'trace conversation correlation key',
  );
  const cryptoApi = params.cryptoApi ?? crypto;
  const sessionDigest = await hmacDigest(
    secret,
    `${params.epoch}:${uid}:trace-session:${sessionCorrelationKey}`,
    cryptoApi,
  );
  const conversationDigest = await hmacDigest(
    secret,
    `${params.epoch}:${uid}:trace-conversation:${conversationCorrelationKey}`,
    cryptoApi,
  );
  return {
    sessionId: `weekly-trace-${uuidFromDigest(sessionDigest)}`,
    logicalConversationId: `weekly-conversation-${uuidFromDigest(conversationDigest)}`,
  };
}
'''

privacy = replace_once(
    privacy,
    'function serializedBytes(value: unknown): number {',
    canonical_helpers + '\nfunction serializedBytes(value: unknown): number {',
    'canonical ID helpers',
)

server_prepare = r'''

export function prepareWeeklyPlanningTraceServerWrite(
  input: WeeklyPlanningTraceWriteInput,
  subject: WeeklyPlanningTraceSubject,
  canonicalIds: WeeklyPlanningTraceCanonicalIds,
  now: Date | string | number = new Date(),
): PreparedWeeklyPlanningTraceWrite {
  if (!input || typeof input !== 'object') throw new Error('trace write payload is invalid');
  if (!input.session || typeof input.session !== 'object' || Array.isArray(input.session)) {
    throw new Error('trace session payload is invalid');
  }
  if (!Array.isArray(input.entries) || input.entries.length > MAX_TRACE_ENTRIES_PER_REQUEST) {
    throw new Error('trace entry batch is invalid');
  }
  const sessionId = requireTraceSessionId(canonicalIds.sessionId);
  const logicalConversationId = requireTraceConversationId(
    canonicalIds.logicalConversationId,
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
    requireTraceEntrySchema(entry);
    const expectedEntryId = weeklyPlanningTraceEntryId(sessionId, sequence);
    return {
      ...preparedDocument({
        ...entry,
        id: expectedEntryId,
        sessionId,
        logicalConversationId,
        sequence,
      }, subject, expireAt),
      id: expectedEntryId,
      sessionId,
      logicalConversationId,
      sequence,
    };
  });
  return { session, entries };
}
'''

privacy = replace_once(
    privacy,
    '\nexport function traceSubjectEpochsForDeletion(secretRing: TraceHmacSecretRing): string[] {',
    server_prepare + '\nexport function traceSubjectEpochsForDeletion(secretRing: TraceHmacSecretRing): string[] {',
    'server write preparation',
)
privacy_path.write_text(privacy)

api_path = Path('workers/ai-proxy/src/weeklyPlanningTraceApi.ts')
api = api_path.read_text()
api = replace_once(
    api,
    '  createWeeklyPlanningTraceSubject,\n',
    '  createWeeklyPlanningTraceCanonicalIds,\n  createWeeklyPlanningTraceSubject,\n',
    'API canonical import',
)
api = replace_once(
    api,
    '  prepareWeeklyPlanningTraceWrite,\n',
    '  prepareWeeklyPlanningTraceServerWrite,\n',
    'API server prepare import',
)
api = replace_once(
    api,
    'const TRACE_STORAGE_LAYOUT_VERSION = 1;',
    'const TRACE_STORAGE_LAYOUT_VERSION = 2;',
    'storage layout version',
)

subject_helpers = r'''

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
'''
api = replace_once(
    api,
    '\nasync function policyAcceptance(',
    subject_helpers + '\nasync function policyAcceptance(',
    'retained subject helpers',
)

start_handler = r'''

async function handleSessionStart(
  request: Request,
  firestore: WeeklyPlanningTraceFirestoreClient,
  env: WeeklyPlanningTraceApiEnv,
  session: WeeklyPlanningTraceApiSession,
): Promise<WeeklyPlanningTraceApiResult> {
  const acceptance = await policyAcceptance(firestore, session.uid);
  if (!isWeeklyPlanningTracePolicyAccepted(acceptance)) {
    return error(412, '週間計画traceの利用同意が必要です。');
  }
  const body = await parseJsonBody(request);
  const metadata = isRecord(body.session) ? body.session : null;
  if (!metadata) return error(400, 'trace session payload is invalid');
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
      return error(409, 'trace session ownership conflict');
    }
    if (existing.logicalConversationId !== canonicalIds.logicalConversationId
      || existing.serverIssued !== true
      || existing.storageLayoutVersion !== TRACE_STORAGE_LAYOUT_VERSION) {
      return error(409, 'trace session issuance conflict');
    }
    return ok(canonicalIds);
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
      || !caught.message.includes('immutable trace document conflict')) {
      throw caught;
    }
    const raced = await firestore.getDocument(TRACE_SESSIONS, canonicalIds.sessionId);
    const ownerTokens = await retainedSubjectTokens(session.uid, env);
    if (!raced || !isOwnedServerSession(raced, ownerTokens)) throw caught;
  }
  return ok(canonicalIds);
}
'''
api = replace_once(
    api,
    '\nfunction traceSessionConflict(',
    start_handler + '\nfunction traceSessionConflict(',
    'session start handler',
)

api = replace_once(
    api,
    "  if (existing.traceSubjectToken !== next.traceSubjectToken) {\n    return 'trace session ownership conflict';\n  }\n",
    '',
    'remove client-prepared ownership comparison',
)

old_merge = '''function mergeTraceSession(
  existing: Record<string, unknown> | null,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const merged = {
    ...(existing ?? {}),
    ...next,
    storageLayoutVersion: TRACE_STORAGE_LAYOUT_VERSION,
    ...(existing?.archivedAt ? { archivedAt: existing.archivedAt } : {}),
  };
  delete merged.userId;
  return merged;
}
'''
new_merge = '''function mergeTraceSession(
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
'''
api = replace_once(api, old_merge, new_merge, 'merge server session')

append_start = api.index('async function handleAppend(')
append_end = api.index('\nasync function handleDelete(', append_start)
new_append = r'''async function handleAppend(
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
  if (!isRecord(payload.session)) return error(400, 'trace session payload is invalid');
  const sessionId = typeof payload.session.id === 'string' ? payload.session.id.trim() : '';
  if (!isWeeklyPlanningTraceSessionId(sessionId)) return error(400, 'trace session id is invalid');
  const existingSession = await firestore.getDocument(TRACE_SESSIONS, sessionId);
  if (!existingSession) {
    return error(404, 'trace session must be started before append');
  }
  const ownerTokens = await retainedSubjectTokens(session.uid, env);
  if (!isOwnedServerSession(existingSession, ownerTokens)) {
    return error(409, 'trace session ownership conflict');
  }
  if (existingSession.serverIssued !== true
    || existingSession.storageLayoutVersion !== TRACE_STORAGE_LAYOUT_VERSION) {
    return error(409, 'legacy trace session is read-only');
  }
  const logicalConversationId = typeof existingSession.logicalConversationId === 'string'
    ? existingSession.logicalConversationId
    : '';
  if (!isWeeklyPlanningTraceConversationId(logicalConversationId)) {
    return error(409, 'trace session conversation conflict');
  }
  const subject = await currentSubject(session.uid, env);
  const prepared = prepareWeeklyPlanningTraceServerWrite(
    payload as unknown as WeeklyPlanningTraceWriteInput,
    subject,
    { sessionId, logicalConversationId },
  );
  const conflict = traceSessionConflict(existingSession, prepared.session);
  if (conflict) return error(409, conflict);
  const mergedSession = mergeTraceSession(existingSession, prepared.session);
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
  return ok({
    sessionId,
    acceptedEntries: prepared.entries.length,
    traceSubjectEpoch: subject.epoch,
  });
}
'''
api = api[:append_start] + new_append + api[append_end:]

api = replace_once(
    api,
    "    if (pathname === '/weekly-planning-trace/append' && request.method === 'POST') {\n",
    "    if (pathname === '/weekly-planning-trace/session/start' && request.method === 'POST') {\n      return await handleSessionStart(request, firestore, env, session);\n    }\n    if (pathname === '/weekly-planning-trace/append' && request.method === 'POST') {\n",
    'session start route',
)
api_path.write_text(api)
