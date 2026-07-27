import type {
  DocumentData,
  Firestore,
  QuerySnapshot,
  Timestamp,
} from 'firebase/firestore';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { getFirebaseAuth, getFirestoreDb } from '../../../lib/firebaseClient';
import { sanitizeWeeklyPlanningTraceValue } from './weeklyPlanningTraceRedaction';
import {
  isWeeklyPlanningTraceEntry,
  type WeeklyPlanningTraceEntry,
  type WeeklyPlanningTraceRepository,
  type WeeklyPlanningTraceSession,
} from './weeklyPlanningTraceTypes';

const LOCAL_SESSIONS_KEY = 'studyplanner-weekly-planning-trace-sessions-v1';
const LOCAL_ENTRIES_KEY = 'studyplanner-weekly-planning-trace-entries-v1';
const FIRESTORE_ENTRIES_PER_BATCH = 440;

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
    || typeof record.startedAt !== 'string'
    || typeof record.lastActivityAt !== 'string') {
    return null;
  }
  const expireAt = dateString(record.expireAt);
  if (!expireAt) return null;
  const archivedAt = dateString(record.archivedAt);
  return {
    ...(record as unknown as WeeklyPlanningTraceSession),
    expireAt,
    lastActivityAt: dateString(record.lastActivityAt) ?? record.lastActivityAt,
    ...(dateString(record.endedAt) ? { endedAt: dateString(record.endedAt) } : {}),
    ...(archivedAt ? { archivedAt } : {}),
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

function sortSessions(items: WeeklyPlanningTraceSession[]): WeeklyPlanningTraceSession[] {
  return items.sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt));
}

function sessionsFromSnapshot(
  snapshot: QuerySnapshot<DocumentData>,
): WeeklyPlanningTraceSession[] {
  return sortSessions(snapshot.docs
    .map((item) => normalizedSession({ ...item.data(), id: item.id }))
    .filter((item): item is WeeklyPlanningTraceSession => Boolean(item)));
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

function authenticatedTraceUserId(): string {
  const userId = getFirebaseAuth()?.currentUser?.uid?.trim();
  if (!userId) throw new Error('trace auth user is unavailable');
  return userId;
}

function assertAuthenticatedFirestoreOwnership(params: {
  session: WeeklyPlanningTraceSession;
  entries?: WeeklyPlanningTraceEntry[];
}): void {
  const authenticatedUserId = authenticatedTraceUserId();
  if (params.session.userId !== authenticatedUserId) {
    throw new Error('trace ownership mismatch');
  }
  if ((params.entries ?? []).some((entry) =>
    entry.userId !== authenticatedUserId || entry.sessionId !== params.session.id)) {
    throw new Error('trace ownership mismatch');
  }
}

function entryChunks(entries: WeeklyPlanningTraceEntry[]): WeeklyPlanningTraceEntry[][] {
  const chunks: WeeklyPlanningTraceEntry[][] = [];
  for (let index = 0; index < entries.length; index += FIRESTORE_ENTRIES_PER_BATCH) {
    chunks.push(entries.slice(index, index + FIRESTORE_ENTRIES_PER_BATCH));
  }
  return chunks;
}

export function createFirestoreWeeklyPlanningTraceRepository(
  firestoreDb: Firestore,
): WeeklyPlanningTraceRepository {
  async function upsertSession(session: WeeklyPlanningTraceSession): Promise<void> {
    assertAuthenticatedFirestoreOwnership({ session });
    await setDoc(
      doc(firestoreDb, 'weekly_planning_trace_sessions', session.id),
      firestorePayload(session),
      { merge: true },
    );
  }

  return {
    upsertSession,

    async appendEntries({ session, entries }) {
      if (entries.length === 0) {
        await upsertSession(session);
        return;
      }
      assertAuthenticatedFirestoreOwnership({ session, entries });

      const chunks = entryChunks(entries);
      for (const [chunkIndex, chunk] of chunks.entries()) {
        const batch = writeBatch(firestoreDb);
        chunk.forEach((entry) => {
          batch.set(
            doc(firestoreDb, 'weekly_planning_trace_entries', entry.id),
            firestorePayload(entry),
          );
        });
        if (chunkIndex === chunks.length - 1) {
          batch.set(
            doc(firestoreDb, 'weekly_planning_trace_sessions', session.id),
            firestorePayload(session),
            { merge: true },
          );
        }
        await batch.commit();
      }
    },

    async listSessions(userId) {
      const snapshot = await getDocs(query(
        collection(firestoreDb, 'weekly_planning_trace_sessions'),
        where('userId', '==', userId),
      ));
      return sessionsFromSnapshot(snapshot);
    },

    async listSessionsForAdmin() {
      const snapshot = await getDocs(collection(firestoreDb, 'weekly_planning_trace_sessions'));
      return sessionsFromSnapshot(snapshot);
    },

    async archiveSessionForAdmin(sessionId, archivedAt) {
      await updateDoc(
        doc(firestoreDb, 'weekly_planning_trace_sessions', sessionId),
        { archivedAt },
      );
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
  async function upsertSession(session: WeeklyPlanningTraceSession): Promise<void> {
    const sessions = readLocalArray<WeeklyPlanningTraceSession>(LOCAL_SESSIONS_KEY);
    const current = sessions.find((item) => item.id === session.id);
    const next = preserveArchiveState(
      current,
      sanitizeWeeklyPlanningTraceValue(session).value as WeeklyPlanningTraceSession,
    );
    writeLocalArray(LOCAL_SESSIONS_KEY, [
      ...sessions.filter((item) => item.id !== session.id),
      next,
    ]);
  }

  return {
    upsertSession,

    async appendEntries({ session, entries }) {
      if (entries.some((entry) => entry.userId !== session.userId || entry.sessionId !== session.id)) {
        throw new Error('trace ownership mismatch');
      }
      await upsertSession(session);
      const current = readLocalArray<WeeklyPlanningTraceEntry>(LOCAL_ENTRIES_KEY);
      const byId = new Map(current.map((entry) => [entry.id, entry]));
      entries.forEach((entry) => {
        const sanitized = sanitizeWeeklyPlanningTraceValue(entry).value as WeeklyPlanningTraceEntry;
        const existing = byId.get(entry.id);
        if (existing && JSON.stringify(existing) !== JSON.stringify(sanitized)) {
          throw new Error('append-only trace entry conflict');
        }
        byId.set(entry.id, sanitized);
      });
      writeLocalArray(LOCAL_ENTRIES_KEY, Array.from(byId.values()));
    },

    async listSessions(userId) {
      return sortSessions(readLocalArray<WeeklyPlanningTraceSession>(LOCAL_SESSIONS_KEY)
        .filter((session) => session.userId === userId));
    },

    async listSessionsForAdmin() {
      return sortSessions(readLocalArray<WeeklyPlanningTraceSession>(LOCAL_SESSIONS_KEY));
    },

    async archiveSessionForAdmin(sessionId, archivedAt) {
      const sessions = readLocalArray<WeeklyPlanningTraceSession>(LOCAL_SESSIONS_KEY);
      const current = sessions.find((session) => session.id === sessionId);
      if (!current) throw new Error('trace session not found');
      writeLocalArray(LOCAL_SESSIONS_KEY, sessions.map((session) =>
        session.id === sessionId ? { ...session, archivedAt } : session));
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
    async listSessionsForAdmin() { return []; },
    async archiveSessionForAdmin() {},
    async getSession() { return null; },
    async listEntries() { return []; },
  };
}

function serializeWeeklyPlanningTraceWrites(
  delegate: WeeklyPlanningTraceRepository,
): WeeklyPlanningTraceRepository {
  const queues = new Map<string, Promise<void>>();

  function enqueue(sessionId: string, operation: () => Promise<void>): Promise<void> {
    const previous = queues.get(sessionId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    queues.set(sessionId, next);
    return next.finally(() => {
      if (queues.get(sessionId) === next) queues.delete(sessionId);
    });
  }

  return {
    upsertSession(session) {
      return enqueue(session.id, () => delegate.upsertSession(session));
    },
    appendEntries(params) {
      return enqueue(params.session.id, () => delegate.appendEntries(params));
    },
    listSessions(userId) {
      return delegate.listSessions(userId);
    },
    listSessionsForAdmin() {
      return delegate.listSessionsForAdmin();
    },
    archiveSessionForAdmin(sessionId, archivedAt) {
      return enqueue(
        sessionId,
        () => delegate.archiveSessionForAdmin(sessionId, archivedAt),
      );
    },
    getSession(userId, sessionId) {
      return delegate.getSession(userId, sessionId);
    },
    listEntries(userId, sessionId) {
      return delegate.listEntries(userId, sessionId);
    },
  };
}

let repository: WeeklyPlanningTraceRepository | undefined;

export function resolveWeeklyPlanningTraceEnabled(
  configuredValue: string | undefined,
): boolean {
  return configuredValue !== 'false';
}

export function isWeeklyPlanningTraceEnabled(): boolean {
  return resolveWeeklyPlanningTraceEnabled(
    import.meta.env.VITE_WEEKLY_PLANNING_TRACE_ENABLED,
  );
}

export function getWeeklyPlanningTraceRepository(): WeeklyPlanningTraceRepository {
  if (repository) return repository;
  if (!isWeeklyPlanningTraceEnabled()) {
    repository = createNoopWeeklyPlanningTraceRepository();
    return repository;
  }
  const firestoreDb = getFirestoreDb();
  const storageRepository = firestoreDb
    ? createFirestoreWeeklyPlanningTraceRepository(firestoreDb)
    : createLocalWeeklyPlanningTraceRepository();
  repository = serializeWeeklyPlanningTraceWrites(storageRepository);
  return repository;
}

export function setWeeklyPlanningTraceRepositoryForTests(
  nextRepository: WeeklyPlanningTraceRepository | undefined,
): void {
  repository = nextRepository;
}
