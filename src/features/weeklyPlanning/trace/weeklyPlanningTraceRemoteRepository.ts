import {
  WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS,
  measureWeeklyPlanningTraceJsonBytes,
} from '../../../../shared/weeklyPlanningTraceContract';
import { createWeeklyPlanningTraceAdminDiagnostics } from './weeklyPlanningTraceArchive';
import {
  createWeeklyPlanningTraceApiClient,
  isWeeklyPlanningTraceRetriableError,
  isWeeklyPlanningTraceServerHandleRejection,
  type WeeklyPlanningTraceApiClient,
  type WeeklyPlanningTraceServerHandle,
} from './weeklyPlanningTracePrivacyClient';
import {
  loadWeeklyPlanningStableV5TraceCursor,
  saveWeeklyPlanningStableV5TraceCursor,
} from './weeklyPlanningStableV5TraceSessionStorage';
import {
  isWeeklyPlanningTraceEntry,
  type WeeklyPlanningTraceEntry,
  type WeeklyPlanningTraceRepository,
  type WeeklyPlanningTraceSession,
} from './weeklyPlanningTraceTypes';

const SERVER_HANDLE_STORAGE_VERSION =
  'studyplanner-weekly-planning-trace-server-handle-v1' as const;
const SERVER_HANDLE_STORAGE_PREFIX = 'studyplanner.weeklyPlanning.trace.serverHandle.v1.';
const SERVER_HANDLE_KEYS = ['version', 'localSessionId', 'serverHandle'] as const;
const HANDLE_KEYS = ['sessionId', 'logicalConversationId'] as const;
const STABLE_V5_LOCAL_SESSION_PREFIX = 'weekly-trace-stable-v5-';

interface StoredServerHandle {
  version: typeof SERVER_HANDLE_STORAGE_VERSION;
  localSessionId: string;
  serverHandle: WeeklyPlanningTraceServerHandle;
}

interface CanonicalTracePayload {
  session: WeeklyPlanningTraceSession;
  entries: WeeklyPlanningTraceEntry[];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function nonNegativeIntegerValue(value: unknown): number | undefined {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : undefined;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function subjectAlias(record: Record<string, unknown>): string {
  return stringValue(record.subjectAlias)
    ?? stringValue(record.traceSubjectToken)
    ?? 'trace-subject';
}

function sessionFromRemote(record: Record<string, unknown>): WeeklyPlanningTraceSession | null {
  const id = stringValue(record.id);
  const logicalConversationId = stringValue(record.logicalConversationId);
  const status = stringValue(record.status);
  const startedAt = stringValue(record.startedAt);
  const lastActivityAt = stringValue(record.lastActivityAt);
  const appVersion = stringValue(record.appVersion);
  const expireAt = stringValue(record.expireAt);
  const archivedEntryCount = nonNegativeIntegerValue(record.archivedEntryCount);
  if (!id
    || !logicalConversationId
    || !['active', 'completed', 'abandoned', 'failed'].includes(status ?? '')
    || !startedAt
    || !lastActivityAt
    || !appVersion
    || !expireAt) {
    return null;
  }
  return {
    id,
    logicalConversationId,
    userId: subjectAlias(record),
    status: status as WeeklyPlanningTraceSession['status'],
    startedAt,
    lastActivityAt,
    ...(stringValue(record.endedAt) ? { endedAt: stringValue(record.endedAt) } : {}),
    ...(stringValue(record.archivedAt) ? { archivedAt: stringValue(record.archivedAt) } : {}),
    ...(archivedEntryCount !== undefined ? { archivedEntryCount } : {}),
    ...(stringValue(record.planningRangeStart)
      ? { planningRangeStart: stringValue(record.planningRangeStart) }
      : {}),
    ...(stringValue(record.planningRangeEnd)
      ? { planningRangeEnd: stringValue(record.planningRangeEnd) }
      : {}),
    turnCount: numberValue(record.turnCount) ?? 0,
    entryCount: numberValue(record.entryCount) ?? 0,
    hasPreview: booleanValue(record.hasPreview),
    hasApprovalFailure: booleanValue(record.hasApprovalFailure),
    hasFallback: booleanValue(record.hasFallback),
    hasError: booleanValue(record.hasError),
    appVersion,
    schemaVersion: numberValue(record.schemaVersion) ?? 1,
    expireAt,
  };
}

function entryFromRemote(record: Record<string, unknown>): WeeklyPlanningTraceEntry | null {
  const candidate = { ...record, userId: subjectAlias(record) };
  return isWeeklyPlanningTraceEntry(candidate) ? candidate : null;
}

function entryId(sessionId: string, sequence: number): string {
  return `${sessionId}-${String(sequence).padStart(8, '0')}`;
}

function startMetadata(session: WeeklyPlanningTraceSession): Record<string, unknown> {
  return {
    status: 'active',
    startedAt: session.startedAt,
    lastActivityAt: session.startedAt,
    ...(session.planningRangeStart ? { planningRangeStart: session.planningRangeStart } : {}),
    ...(session.planningRangeEnd ? { planningRangeEnd: session.planningRangeEnd } : {}),
    turnCount: 0,
    entryCount: 0,
    hasPreview: false,
    hasApprovalFailure: false,
    hasFallback: false,
    hasError: false,
    appVersion: session.appVersion,
    schemaVersion: session.schemaVersion,
  };
}

function initialStableV5Session(session: WeeklyPlanningTraceSession): WeeklyPlanningTraceSession {
  return {
    id: session.id,
    logicalConversationId: session.logicalConversationId,
    userId: session.userId,
    status: 'active',
    startedAt: session.startedAt,
    lastActivityAt: session.startedAt,
    ...(session.planningRangeStart ? { planningRangeStart: session.planningRangeStart } : {}),
    ...(session.planningRangeEnd ? { planningRangeEnd: session.planningRangeEnd } : {}),
    turnCount: 0,
    entryCount: 0,
    hasPreview: false,
    hasApprovalFailure: false,
    hasFallback: false,
    hasError: false,
    appVersion: session.appVersion,
    schemaVersion: session.schemaVersion,
    expireAt: session.expireAt,
  };
}

function persistStableV5SessionIdentity(session: WeeklyPlanningTraceSession): void {
  if (!session.id.startsWith(STABLE_V5_LOCAL_SESSION_PREFIX)) return;
  const existing = loadWeeklyPlanningStableV5TraceCursor({
    userId: session.userId,
    conversationId: session.logicalConversationId,
  });
  if (existing) return;

  const initial = initialStableV5Session(session);
  const saved = saveWeeklyPlanningStableV5TraceCursor({
    userId: session.userId,
    conversationId: session.logicalConversationId,
    session: initial,
    nextSequence: 0,
    nextTurnIndex: 0,
    lastActivityMs: Date.parse(initial.lastActivityAt),
    requestIds: [],
  });
  if (!saved) {
    console.warn('[WeeklyPlanningTrace] failed to persist Stable V5 session identity', {
      conversationId: session.logicalConversationId,
    });
  }
}

function canonicalSession(
  session: WeeklyPlanningTraceSession,
  handle: WeeklyPlanningTraceServerHandle,
): WeeklyPlanningTraceSession {
  return { ...session, id: handle.sessionId, logicalConversationId: handle.logicalConversationId };
}

function canonicalEntry(
  entry: WeeklyPlanningTraceEntry,
  handle: WeeklyPlanningTraceServerHandle,
): WeeklyPlanningTraceEntry {
  return {
    ...entry,
    id: entryId(handle.sessionId, entry.sequence),
    sessionId: handle.sessionId,
    logicalConversationId: handle.logicalConversationId,
  };
}

function serverHandleStorageKey(session: WeeklyPlanningTraceSession): string {
  return `${SERVER_HANDLE_STORAGE_PREFIX}${encodeURIComponent(session.userId)}::${encodeURIComponent(session.id)}`;
}

function isServerHandle(value: unknown): value is WeeklyPlanningTraceServerHandle {
  if (!isRecord(value) || !hasOnlyKeys(value, HANDLE_KEYS)) return false;
  return typeof value.sessionId === 'string'
    && /^weekly-trace-[0-9a-f-]{36}$/i.test(value.sessionId)
    && typeof value.logicalConversationId === 'string'
    && /^weekly-conversation-[0-9a-f-]{36}$/i.test(value.logicalConversationId);
}

function loadStoredServerHandle(
  session: WeeklyPlanningTraceSession,
): WeeklyPlanningTraceServerHandle | null {
  if (typeof window === 'undefined') return null;
  const key = serverHandleStorageKey(session);
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)
      || !hasOnlyKeys(value, SERVER_HANDLE_KEYS)
      || value.version !== SERVER_HANDLE_STORAGE_VERSION
      || value.localSessionId !== session.id
      || !isServerHandle(value.serverHandle)) {
      window.localStorage.removeItem(key);
      return null;
    }
    return value.serverHandle;
  } catch {
    try { window.localStorage.removeItem(key); } catch { /* ignore */ }
    return null;
  }
}

function saveStoredServerHandle(
  session: WeeklyPlanningTraceSession,
  serverHandle: WeeklyPlanningTraceServerHandle,
): void {
  if (typeof window === 'undefined') return;
  const payload: StoredServerHandle = {
    version: SERVER_HANDLE_STORAGE_VERSION,
    localSessionId: session.id,
    serverHandle,
  };
  try {
    window.localStorage.setItem(serverHandleStorageKey(session), JSON.stringify(payload));
  } catch {
    // Server handle continuity remains best effort.
  }
}

function clearStoredServerHandle(session: WeeklyPlanningTraceSession): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(serverHandleStorageKey(session)); } catch { /* ignore */ }
}

function batchSession(
  session: WeeklyPlanningTraceSession,
  allEntries: readonly WeeklyPlanningTraceEntry[],
  batchEntries: readonly WeeklyPlanningTraceEntry[],
): WeeklyPlanningTraceSession {
  const maxSequence = batchEntries.reduce((latest, entry) => Math.max(latest, entry.sequence), -1);
  const entryCount = maxSequence + 1;
  const appendedTurnCount = allEntries.filter((entry) => entry.kind === 'turn').length;
  const previousTurnCount = Math.max(0, session.turnCount - appendedTurnCount);
  const includedTurnCount = allEntries.filter(
    (entry) => entry.kind === 'turn' && entry.sequence < entryCount,
  ).length;
  return { ...session, entryCount, turnCount: previousTurnCount + includedTurnCount };
}

function assertClientDocumentSize(entry: WeeklyPlanningTraceEntry): void {
  const bytes = measureWeeklyPlanningTraceJsonBytes(entry);
  if (bytes > WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes) {
    throw new Error(
      `trace entry exceeds the client document target (${bytes}/${WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes})`,
    );
  }
}

function splitCanonicalPayload(canonical: CanonicalTracePayload): CanonicalTracePayload[] {
  if (canonical.entries.length === 0) return [canonical];
  canonical.entries.forEach(assertClientDocumentSize);

  const batches: CanonicalTracePayload[] = [];
  let entries: WeeklyPlanningTraceEntry[] = [];
  const payloadFor = (candidateEntries: WeeklyPlanningTraceEntry[]): CanonicalTracePayload => ({
    session: batchSession(canonical.session, canonical.entries, candidateEntries),
    entries: candidateEntries,
  });

  for (const entry of canonical.entries) {
    const candidateEntries = [...entries, entry];
    const candidate = payloadFor(candidateEntries);
    const exceedsCount = candidateEntries.length
      > WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxEntriesPerRequest;
    const exceedsTarget = measureWeeklyPlanningTraceJsonBytes(candidate)
      > WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientBatchTargetBytes;
    if ((exceedsCount || exceedsTarget) && entries.length > 0) {
      batches.push(payloadFor(entries));
      entries = [entry];
    } else {
      entries = candidateEntries;
    }
    const bytes = measureWeeklyPlanningTraceJsonBytes(payloadFor(entries));
    if (bytes > WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxRequestBodyBytes) {
      throw new Error(
        `trace append payload exceeds the request limit (${bytes}/${WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxRequestBodyBytes})`,
      );
    }
  }
  if (entries.length > 0) batches.push(payloadFor(entries));
  return batches;
}

export function createRemoteWeeklyPlanningTraceRepository(
  client: WeeklyPlanningTraceApiClient = createWeeklyPlanningTraceApiClient(),
): WeeklyPlanningTraceRepository {
  const sessionsById = new Map<string, WeeklyPlanningTraceSession>();
  const handlesByLocalSessionId = new Map<string, Promise<WeeklyPlanningTraceServerHandle>>();
  let compatibility: Promise<void> | null = null;

  function ensureCompatibility(): Promise<void> {
    if (!client.getHealth) return Promise.resolve();
    compatibility ??= client.getHealth().then(() => undefined).catch((error) => {
      compatibility = null;
      throw error;
    });
    return compatibility;
  }

  function forgetServerHandle(session: WeeklyPlanningTraceSession): void {
    handlesByLocalSessionId.delete(session.id);
    clearStoredServerHandle(session);
  }

  async function serverHandle(
    session: WeeklyPlanningTraceSession,
  ): Promise<WeeklyPlanningTraceServerHandle> {
    await ensureCompatibility();
    persistStableV5SessionIdentity(session);
    const existing = handlesByLocalSessionId.get(session.id);
    if (existing) return existing;

    const stored = loadStoredServerHandle(session);
    if (stored) {
      const resolved = Promise.resolve(stored);
      handlesByLocalSessionId.set(session.id, resolved);
      return resolved;
    }

    const pending = client.startSession({
      idempotencyKey: session.id,
      conversationCorrelationKey: session.logicalConversationId,
      session: startMetadata(session),
    }).then((handle) => {
      saveStoredServerHandle(session, handle);
      return handle;
    }).catch((error) => {
      forgetServerHandle(session);
      throw error;
    });
    handlesByLocalSessionId.set(session.id, pending);
    return pending;
  }

  async function canonicalPayload(params: {
    session: WeeklyPlanningTraceSession;
    entries: WeeklyPlanningTraceEntry[];
  }): Promise<CanonicalTracePayload> {
    const handle = await serverHandle(params.session);
    return {
      session: canonicalSession(params.session, handle),
      entries: params.entries.map((entry) => canonicalEntry(entry, handle)),
    };
  }

  async function appendCanonicalBatches(canonical: CanonicalTracePayload): Promise<void> {
    for (const batch of splitCanonicalPayload(canonical)) {
      try {
        await client.append(batch);
      } catch (error) {
        if (!isWeeklyPlanningTraceRetriableError(error)) throw error;
        await client.append(batch);
      }
    }
  }

  async function appendWithHandleRecovery(params: {
    session: WeeklyPlanningTraceSession;
    entries: WeeklyPlanningTraceEntry[];
  }): Promise<WeeklyPlanningTraceSession> {
    let canonical = await canonicalPayload(params);
    try {
      await appendCanonicalBatches(canonical);
      return canonical.session;
    } catch (error) {
      if (!isWeeklyPlanningTraceServerHandleRejection(error)) throw error;
      forgetServerHandle(params.session);
      canonical = await canonicalPayload(params);
      await appendCanonicalBatches(canonical);
      return canonical.session;
    }
  }

  async function adminResult() {
    await ensureCompatibility();
    const response = await client.listAdminSessions();
    const raw = Array.isArray(response)
      ? { sessions: response, rawCount: response.length }
      : response;
    const sessions = raw.sessions
      .map(sessionFromRemote)
      .filter((session): session is WeeklyPlanningTraceSession => Boolean(session))
      .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt));
    sessions.forEach((session) => sessionsById.set(session.id, session));
    return {
      sessions,
      diagnostics: createWeeklyPlanningTraceAdminDiagnostics({
        rawCount: raw.rawCount,
        mappedSessions: sessions,
      }),
    };
  }

  return {
    async upsertSession(session) {
      const canonicalSessionValue = await appendWithHandleRecovery({ session, entries: [] });
      sessionsById.set(canonicalSessionValue.id, { ...canonicalSessionValue });
    },
    async appendEntries({ session, entries }) {
      const canonicalSessionValue = await appendWithHandleRecovery({ session, entries });
      sessionsById.set(canonicalSessionValue.id, { ...canonicalSessionValue });
    },
    async listSessions() { return []; },
    async listSessionsForAdmin() { return (await adminResult()).sessions; },
    listSessionsForAdminWithDiagnostics: adminResult,
    async archiveSessionForAdmin(sessionId) {
      await ensureCompatibility();
      await client.archiveAdminSession(sessionId);
    },
    async getSession(_userId, sessionId) {
      return sessionsById.get(sessionId) ?? null;
    },
    async listEntries(_userId, sessionId) {
      await ensureCompatibility();
      return (await client.listAdminEntries(sessionId))
        .map(entryFromRemote)
        .filter((entry): entry is WeeklyPlanningTraceEntry => Boolean(entry))
        .sort((left, right) => left.sequence - right.sequence);
    },
  };
}
