import type { Firestore, Timestamp } from 'firebase/firestore';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { getFirestoreDb } from '../../../lib/firebaseClient';
import { sanitizeWeeklyPlanningTraceValue } from './weeklyPlanningTraceRedaction';
import {
  isWeeklyPlanningTraceEntry,
  type WeeklyPlanningTraceEntry,
  type WeeklyPlanningTraceRepository,
  type WeeklyPlanningTraceSession,
} from './weeklyPlanningTraceTypes';

const LOCAL_SESSIONS_KEY = 'studyplanner-weekly-planning-trace-sessions-v1';
const LOCAL_ENTRIES_KEY = 'studyplanner-weekly-planning-trace-entries-v1';

function dateString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  const maybeTimestamp = value as Partial<Timestamp> | null;
  if (maybeTimestamp && typeof maybeTimestamp.toDate === 'function') {
    return maybeTimestamp.toDate().toISOString();
  }
  return undefined;
}

function normalizedSession(value: unknown): WeeklyPlanningTraceSession | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string'
    || typeof record.userId !== 'string'
    || typeof record.logicalConversationId !== 'string'
    || typeof record.startedAt !== 'string') {
    return null;
  }
  const expireAt = dateString(record.expireAt);
  if (!expireAt) return null;
  return {
    ...(record as unknown as WeeklyPlanningTraceSession),
    expireAt,
    ...(dateString(record.lastActivityAt) ? { lastActivityAt: dateString(record.lastActivityAt) as string } : {}),
    ...(dateString(record.endedAt) ? { endedAt: dateString(record.endedAt) } : {}),
  };
}

function normalizedEntry(value: unknown): WeeklyPlanningTraceEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const normalized = {
    ...record,
    expireAt: dateString(record.expireAt),
  };
  return isWeeklyPlanningTraceEntry(normalized) ? normalized : null;
}

function firestorePayload<T>(value: T): T {
  const sanitized = sanitizeWeeklyPlanningTraceValue(value).value as T;
  if (!sanitized || typeof sanitized !== 'object') return sanitized;
  const record = sanitized as Record<string, unknown>;
  const expireAt = dateString(record.expireAt);
  return {
    ...record,
    ...(expireAt ? { expireAt: new Date(expireAt) } : {}),
  } as T;
}

export function createFirestoreWeeklyPlanningTraceRepository(
  firestoreDb: Firestore,
): WeeklyPlanningTraceRepository {
  return {
    async upsertSession(session) {
      await setDoc(
        doc(firestoreDb, 'weekly_planning_trace_sessions', session.id),
        firestorePayload(session),
        { merge: true },
      );
    },

    async appendEntries({ session, entries }) {
      if (entries.length === 0) {
        await this.upsertSession(session);
        return;
      }
      if (entries.some((entry) => entry.userId !== session.userId || entry.sessionId !== session.id)) {
        throw new Error('trace ownership mismatch');
      }
      if (entries.length > 450) {
        throw new Error('trace batch is too large');
      }

      const batch = writeBatch(firestoreDb);
      batch.set(
        doc(firestoreDb, 'weekly_planning_trace_sessions', session.id),
        firestorePayload(session),
        { merge: true },
      );
      entries.forEach((entry) => {
        batch.set(
          doc(firestoreDb, 'weekly_planning_trace_entries', entry.id),
          firestorePayload(entry),
        );
      });
      await batch.commit();
    },

    async listSessions(userId) {
      const snapshot = await getDocs(query(
        collection(firestoreDb, 'weekly_planning_trace_sessions'),
        where('userId', '==', userId),
      ));
      return snapshot.docs
        .map((item) => normalizedSession({ ...item.data(), id: item.id }))
        .filter((item): item is WeeklyPlanningTraceSession => Boolean(item))
        .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt));
    },

    async getSession(userId, sessionId) {
      const snapshot = await getDoc(doc(
        firestoreDb,
        'weekly_planning_trace_sessions',
        sessionId,
      ));
      if (!snapshot.exists()) return null;
      const session = normalizedSession({ ...snapshot.data(), id: snapshot.id });
      return session?.userId === userId ? session : null;
    },

    async listEntries(userId, sessionId) {
      const snapshot = await getDocs(query(
        collection(firestoreDb, 'weekly_planning_trace_entries'),
        where('userId', '==', userId),
        where('sessionId', '==', sessionId),
      ));
      return snapshot.docs
        .map((item) => normalizedEntry({ ...item.data(), id: item.id }))
        .filter((item): item is WeeklyPlanningTraceEntry => Boolean(item))
        .sort((left, right) => left.sequence - right.sequence);
    },
  };
}

function readLocalArray<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function writeLocalArray<T>(key: string, values: T[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(values));
}

export function createLocalWeeklyPlanningTraceRepository(): WeeklyPlanningTraceRepository {
  return {
    async upsertSession(session) {
      const sessions = readLocalArray<WeeklyPlanningTraceSession>(LOCAL_SESSIONS_KEY);
      writeLocalArray(LOCAL_SESSIONS_KEY, [
        ...sessions.filter((item) => item.id !== session.id),
        sanitizeWeeklyPlanningTraceValue(session).value as WeeklyPlanningTraceSession,
      ]);
    },

    async appendEntries({ session, entries }) {
      if (entries.some((entry) => entry.userId !== session.userId || entry.sessionId !== session.id)) {
        throw new Error('trace ownership mismatch');
      }
      await this.upsertSession(session);
      const current = readLocalArray<WeeklyPlanningTraceEntry>(LOCAL_ENTRIES_KEY);
      const byId = new Map(current.map((entry) => [entry.id, entry]));
      entries.forEach((entry) => {
        byId.set(
          entry.id,
          sanitizeWeeklyPlanningTraceValue(entry).value as WeeklyPlanningTraceEntry,
        );
      });
      writeLocalArray(LOCAL_ENTRIES_KEY, Array.from(byId.values()));
    },

    async listSessions(userId) {
      return readLocalArray<WeeklyPlanningTraceSession>(LOCAL_SESSIONS_KEY)
        .filter((session) => session.userId === userId)
        .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt));
    },

    async getSession(userId, sessionId) {
      return readLocalArray<WeeklyPlanningTraceSession>(LOCAL_SESSIONS_KEY)
        .find((session) => session.userId === userId && session.id === sessionId) ?? null;
    },

    async listEntries(userId, sessionId) {
      return readLocalArray<WeeklyPlanningTraceEntry>(LOCAL_ENTRIES_KEY)
        .filter((entry) => entry.userId === userId && entry.sessionId === sessionId)
        .filter(isWeeklyPlanningTraceEntry)
        .sort((left, right) => left.sequence - right.sequence);
    },
  };
}

export function createNoopWeeklyPlanningTraceRepository(): WeeklyPlanningTraceRepository {
  return {
    async upsertSession() {},
    async appendEntries() {},
    async listSessions() { return []; },
    async getSession() { return null; },
    async listEntries() { return []; },
  };
}

let repository: WeeklyPlanningTraceRepository | undefined;

export function isWeeklyPlanningTraceEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_WEEKLY_PLANNING_TRACE_ENABLED === 'true';
}

export function getWeeklyPlanningTraceRepository(): WeeklyPlanningTraceRepository {
  if (repository) return repository;
  if (!isWeeklyPlanningTraceEnabled()) {
    repository = createNoopWeeklyPlanningTraceRepository();
    return repository;
  }
  const firestoreDb = getFirestoreDb();
  repository = firestoreDb
    ? createFirestoreWeeklyPlanningTraceRepository(firestoreDb)
    : createLocalWeeklyPlanningTraceRepository();
  return repository;
}

export function setWeeklyPlanningTraceRepositoryForTests(
  nextRepository: WeeklyPlanningTraceRepository | undefined,
): void {
  repository = nextRepository;
}
