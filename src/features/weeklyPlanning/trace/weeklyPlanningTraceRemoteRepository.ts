import {
  isWeeklyPlanningTraceEntry,
  type WeeklyPlanningTraceEntry,
  type WeeklyPlanningTraceRepository,
  type WeeklyPlanningTraceSession,
} from './weeklyPlanningTraceTypes';
import {
  createWeeklyPlanningTraceApiClient,
  type WeeklyPlanningTraceApiClient,
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

export function createRemoteWeeklyPlanningTraceRepository(
  client: WeeklyPlanningTraceApiClient = createWeeklyPlanningTraceApiClient(),
): WeeklyPlanningTraceRepository {
  const sessionsById = new Map<string, WeeklyPlanningTraceSession>();

  return {
    async upsertSession(session) {
      sessionsById.set(session.id, { ...session });
      await client.append({ session, entries: [] });
    },

    async appendEntries({ session, entries }) {
      sessionsById.set(session.id, { ...session });
      await client.append({ session, entries });
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
