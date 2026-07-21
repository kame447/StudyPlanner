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

export function createRemoteWeeklyPlanningTraceRepository(
  client: WeeklyPlanningTraceApiClient = createWeeklyPlanningTraceApiClient(),
): WeeklyPlanningTraceRepository {
  const sessionsById = new Map<string, WeeklyPlanningTraceSession>();
  const handlesByLocalSessionId = new Map<string, Promise<WeeklyPlanningTraceServerHandle>>();

  function serverHandle(session: WeeklyPlanningTraceSession): Promise<WeeklyPlanningTraceServerHandle> {
    const existing = handlesByLocalSessionId.get(session.id);
    if (existing) return existing;

    const pending = client.startSession({
      idempotencyKey: session.id,
      conversationCorrelationKey: session.logicalConversationId,
      session: startMetadata(session),
    }).catch((error) => {
      handlesByLocalSessionId.delete(session.id);
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

  return {
    async upsertSession(session) {
      const canonical = await canonicalPayload({ session, entries: [] });
      sessionsById.set(canonical.session.id, { ...canonical.session });
      await client.append(canonical);
    },

    async appendEntries({ session, entries }) {
      const canonical = await canonicalPayload({ session, entries });
      sessionsById.set(canonical.session.id, { ...canonical.session });
      await client.append(canonical);
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
