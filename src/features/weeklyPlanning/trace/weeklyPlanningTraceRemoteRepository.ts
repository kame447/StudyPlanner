import {
  isWeeklyPlanningTraceEntry,
  type WeeklyPlanningTraceEntry,
  type WeeklyPlanningTraceRepository,
  type WeeklyPlanningTraceSession,
} from './weeklyPlanningTraceTypes';
import {
  createWeeklyPlanningTraceApiClient,
  type WeeklyPlanningTraceApiClient,
  type WeeklyPlanningTraceServerHandle,
} from './weeklyPlanningTracePrivacyClient';

const SERVER_HANDLE_STORAGE_VERSION =
  'studyplanner-weekly-planning-trace-server-handle-v1' as const;

interface StoredServerHandle {
  version: typeof SERVER_HANDLE_STORAGE_VERSION;
  localSessionId: string;
  serverHandle: WeeklyPlanningTraceServerHandle;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean {
  return value === true;
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
  const candidate = {
    ...record,
    userId: subjectAlias(record),
  };
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

function canonicalSession(
  session: WeeklyPlanningTraceSession,
  handle: WeeklyPlanningTraceServerHandle,
): WeeklyPlanningTraceSession {
  return {
    ...session,
    id: handle.sessionId,
    logicalConversationId: handle.logicalConversationId,
  };
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
  return [
    'studyplanner.weeklyPlanning.traceServerHandle.v1',
    encodeURIComponent(session.userId),
    encodeURIComponent(session.id),
  ].join('.');
}

function isServerHandle(value: unknown): value is WeeklyPlanningTraceServerHandle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.sessionId === 'string'
    && /^weekly-trace-[0-9a-f-]{36}$/i.test(record.sessionId)
    && typeof record.logicalConversationId === 'string'
    && /^weekly-conversation-[0-9a-f-]{36}$/i.test(record.logicalConversationId);
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
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      window.localStorage.removeItem(key);
      return null;
    }
    const record = value as Record<string, unknown>;
    if (record.version !== SERVER_HANDLE_STORAGE_VERSION
      || record.localSessionId !== session.id
      || !isServerHandle(record.serverHandle)) {
      window.localStorage.removeItem(key);
      return null;
    }
    return record.serverHandle;
  } catch {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore storage cleanup failures.
    }
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
    // Server handle continuity is best effort. Server-side issuance remains authoritative.
  }
}

function clearStoredServerHandle(session: WeeklyPlanningTraceSession): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(serverHandleStorageKey(session));
  } catch {
    // Ignore storage cleanup failures.
  }
}

function rejectsStoredServerHandle(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return [
    'trace session must be started before append',
    'trace session ownership conflict',
    'legacy trace session is read-only',
    'trace session conversation conflict',
    'trace session issuance conflict',
    'stale server handle',
  ].some((marker) => message.includes(marker));
}

export function createRemoteWeeklyPlanningTraceRepository(
  client: WeeklyPlanningTraceApiClient = createWeeklyPlanningTraceApiClient(),
): WeeklyPlanningTraceRepository {
  const sessionsById = new Map<string, WeeklyPlanningTraceSession>();
  const handlesByLocalSessionId = new Map<string, Promise<WeeklyPlanningTraceServerHandle>>();

  function forgetServerHandle(session: WeeklyPlanningTraceSession): void {
    handlesByLocalSessionId.delete(session.id);
    clearStoredServerHandle(session);
  }

  function serverHandle(session: WeeklyPlanningTraceSession): Promise<WeeklyPlanningTraceServerHandle> {
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
  }): Promise<{
    session: WeeklyPlanningTraceSession;
    entries: WeeklyPlanningTraceEntry[];
  }> {
    const handle = await serverHandle(params.session);
    return {
      session: canonicalSession(params.session, handle),
      entries: params.entries.map((entry) => canonicalEntry(entry, handle)),
    };
  }

  async function appendWithHandleRecovery(params: {
    session: WeeklyPlanningTraceSession;
    entries: WeeklyPlanningTraceEntry[];
  }): Promise<WeeklyPlanningTraceSession> {
    let canonical = await canonicalPayload(params);
    try {
      await client.append(canonical);
      return canonical.session;
    } catch (error) {
      if (!rejectsStoredServerHandle(error)) {
        await client.append(canonical);
        return canonical.session;
      }
      forgetServerHandle(params.session);
      canonical = await canonicalPayload(params);
      await client.append(canonical);
      return canonical.session;
    }
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

    async listSessions() {
      return [];
    },

    async listSessionsForAdmin() {
      const sessions = (await client.listAdminSessions())
        .map(sessionFromRemote)
        .filter((session): session is WeeklyPlanningTraceSession => Boolean(session));
      sessions.forEach((session) => sessionsById.set(session.id, session));
      return sessions.sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt));
    },

    async archiveSessionForAdmin(sessionId) {
      await client.archiveAdminSession(sessionId);
    },

    async getSession(_userId, sessionId) {
      return sessionsById.get(sessionId) ?? null;
    },

    async listEntries(_userId, sessionId) {
      return (await client.listAdminEntries(sessionId))
        .map(entryFromRemote)
        .filter((entry): entry is WeeklyPlanningTraceEntry => Boolean(entry))
        .sort((left, right) => left.sequence - right.sequence);
    },
  };
}
