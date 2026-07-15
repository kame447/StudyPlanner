import { isWeeklyPlanningTraceEntry } from './weeklyPlanningTraceTypes';
import type {
  WeeklyPlanningTraceEntry,
  WeeklyPlanningTraceRepository,
  WeeklyPlanningTraceSession,
} from './weeklyPlanningTraceTypes';

function cloneSession(session: WeeklyPlanningTraceSession): WeeklyPlanningTraceSession {
  return { ...session };
}

function cloneEntry(entry: WeeklyPlanningTraceEntry): WeeklyPlanningTraceEntry {
  if (entry.kind === 'turn') return { ...entry };
  if (entry.kind === 'internal_event') {
    return { ...entry, payload: structuredClone(entry.payload) };
  }
  return { ...entry, state: structuredClone(entry.state) };
}

function sortedSessions(sessions: Iterable<WeeklyPlanningTraceSession>): WeeklyPlanningTraceSession[] {
  return Array.from(sessions)
    .map(cloneSession)
    .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt));
}

function preserveArchiveState(
  current: WeeklyPlanningTraceSession | undefined,
  next: WeeklyPlanningTraceSession,
): WeeklyPlanningTraceSession {
  const archivedAt = next.archivedAt ?? current?.archivedAt;
  return {
    ...next,
    ...(archivedAt ? { archivedAt } : {}),
  };
}

export function createInMemoryWeeklyPlanningTraceRepository(): WeeklyPlanningTraceRepository {
  const sessions = new Map<string, WeeklyPlanningTraceSession>();
  const entries = new Map<string, WeeklyPlanningTraceEntry>();

  return {
    async upsertSession(session) {
      sessions.set(
        session.id,
        cloneSession(preserveArchiveState(sessions.get(session.id), session)),
      );
    },

    async appendEntries({ session, entries: nextEntries }) {
      if (nextEntries.some((entry) => entry.userId !== session.userId || entry.sessionId !== session.id)) {
        throw new Error('trace ownership mismatch');
      }
      sessions.set(
        session.id,
        cloneSession(preserveArchiveState(sessions.get(session.id), session)),
      );
      nextEntries.forEach((entry) => {
        const current = entries.get(entry.id);
        if (current && JSON.stringify(current) !== JSON.stringify(entry)) {
          throw new Error('append-only trace entry conflict');
        }
        entries.set(entry.id, cloneEntry(entry));
      });
    },

    async listSessions(userId) {
      return sortedSessions(
        Array.from(sessions.values()).filter((session) => session.userId === userId),
      );
    },

    async listSessionsForAdmin() {
      return sortedSessions(sessions.values());
    },

    async archiveSessionForAdmin(sessionId, archivedAt) {
      const current = sessions.get(sessionId);
      if (!current) {
        throw new Error('trace session not found');
      }
      sessions.set(sessionId, { ...current, archivedAt });
    },

    async getSession(userId, sessionId) {
      const session = sessions.get(sessionId);
      return session?.userId === userId ? cloneSession(session) : null;
    },

    async listEntries(userId, sessionId) {
      return Array.from(entries.values())
.filter((entry) => entry.userId === userId && entry.sessionId === sessionId)
.filter(isWeeklyPlanningTraceEntry)
.map(cloneEntry)
.sort((left, right) => left.sequence - right.sequence);
    },
  };
}
