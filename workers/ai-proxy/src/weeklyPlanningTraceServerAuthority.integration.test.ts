import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakeFirestore = vi.hoisted(() => {
  const sessions = new Map<string, Record<string, unknown>>();
  const entries = new Map<string, Record<string, unknown>>();

  class FakeWeeklyPlanningTraceFirestoreClient {
    async getDocument(collection: string, id: string): Promise<Record<string, unknown> | null> {
      if (collection === 'profiles') {
        return {
          weeklyPlanningTracePolicy: {
            version: '2026-07-18-v1',
            acceptedAt: '2026-07-21T00:00:00.000Z',
          },
        };
      }
      if (collection === 'admins') {
        return id === 'admin-1'
          ? { enabled: true, weeklyPlanningTraceReader: true }
          : null;
      }
      if (collection === 'weekly_planning_trace_sessions') {
        return sessions.has(id) ? { ...sessions.get(id)! } : null;
      }
      if (collection === 'weekly_planning_trace_entries') {
        return entries.has(id) ? { ...entries.get(id)! } : null;
      }
      return null;
    }

    async setImmutableDocument(
      collection: string,
      id: string,
      value: Record<string, unknown>,
    ): Promise<void> {
      const target = collection === 'weekly_planning_trace_sessions' ? sessions : entries;
      if (target.has(id)) throw new Error(`immutable trace document conflict: ${collection}/${id}`);
      target.set(id, { ...value, id });
    }

    async setDocumentWithMaximumInteger(
      _collection: string,
      id: string,
      value: Record<string, unknown>,
      fieldPath: string,
      maximum: number,
    ): Promise<void> {
      const current = sessions.get(id) ?? {};
      sessions.set(id, {
        ...current,
        ...value,
        [fieldPath]: Math.max(Number(current[fieldPath] ?? 0), maximum),
        id,
      });
    }

    async setDocument(): Promise<void> {}

    async queryDocuments(
      collection: string,
      filters: Array<{ field: string; value: string }>,
    ): Promise<Record<string, unknown>[]> {
      const source = collection === 'weekly_planning_trace_sessions'
        ? sessions
        : collection === 'weekly_planning_trace_entries'
          ? entries
          : new Map<string, Record<string, unknown>>();
      return Array.from(source.values())
        .filter((document) => filters.every((filter) => document[filter.field] === filter.value))
        .map((document) => ({ ...document }));
    }

    async deleteByStringField(): Promise<number> { return 0; }
  }

  return { sessions, entries, FakeWeeklyPlanningTraceFirestoreClient };
});

vi.mock('./weeklyPlanningTraceFirestore', () => ({
  WeeklyPlanningTraceFirestoreClient:
    fakeFirestore.FakeWeeklyPlanningTraceFirestoreClient,
}));

import { handleWeeklyPlanningTraceApi } from './weeklyPlanningTraceApi';
import { resolveWeeklyPlanningTraceEpoch } from './weeklyPlanningTracePrivacy';

const NOW = '2026-07-21T00:00:00.000Z';
const MALICIOUS_SESSION_ID = 'weekly-trace-323e4567-e89b-52d3-a456-426614174000';
const MALICIOUS_CONVERSATION_ID = 'weekly-conversation-423e4567-e89b-52d3-a456-426614174000';

beforeEach(() => {
  fakeFirestore.sessions.clear();
  fakeFirestore.entries.clear();
});

function env() {
  const epoch = resolveWeeklyPlanningTraceEpoch(new Date());
  return {
    FIREBASE_PROJECT_ID: 'integration-project',
    FIREBASE_SERVICE_ACCOUNT_EMAIL: 'service@example.com',
    FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused-by-fake-client',
    WEEKLY_PLANNING_TRACE_HMAC_SECRETS: JSON.stringify({
      [epoch]: 'a'.repeat(32),
    }),
  };
}

function sessionMetadata(
  entryCount = 0,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    status: 'active',
    startedAt: NOW,
    lastActivityAt: NOW,
    turnCount: entryCount,
    entryCount,
    hasPreview: false,
    hasApprovalFailure: false,
    hasFallback: false,
    hasError: false,
    appVersion: 'test',
    schemaVersion: 1,
    ...overrides,
  };
}

async function start(
  uid = 'user-1',
  sessionOverrides: Record<string, unknown> = {},
) {
  return handleWeeklyPlanningTraceApi(
    new Request('https://example.test/weekly-planning-trace/session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: 'weekly-trace-09012345678-client',
        conversationCorrelationKey: 'conversation-09012345678-client',
        session: sessionMetadata(0, sessionOverrides),
      }),
    }),
    env(),
    { uid },
  );
}

function appendRequest(
  sessionId: string,
  entryOverrides: Record<string, unknown> = {},
  sessionOverrides: Record<string, unknown> = {},
) {
  return new Request('https://example.test/weekly-planning-trace/append', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session: {
        ...sessionMetadata(1, sessionOverrides),
        id: sessionId,
        logicalConversationId: MALICIOUS_CONVERSATION_ID,
      },
      entries: [{
        id: `${MALICIOUS_SESSION_ID}-00000000`,
        sessionId: MALICIOUS_SESSION_ID,
        logicalConversationId: MALICIOUS_CONVERSATION_ID,
        sequence: 0,
        occurredAt: NOW,
        observedAt: NOW,
        schemaVersion: 1,
        kind: 'internal_event',
        eventType: 'user_turn_received',
        payload: { source: 'client' },
        severity: 'info',
        ...entryOverrides,
      }],
    }),
  });
}

describe('weekly planning trace server authority', () => {
  it('issues opaque canonical IDs and converges repeated starts without persisting raw keys', async () => {
    const first = await start();
    const second = await start();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({
      sessionId: first.body.sessionId,
      logicalConversationId: first.body.logicalConversationId,
    });
    expect(String(first.body.sessionId)).toMatch(/^weekly-trace-[0-9a-f-]{36}$/);
    expect(String(first.body.logicalConversationId)).toMatch(/^weekly-conversation-[0-9a-f-]{36}$/);
    expect(fakeFirestore.sessions).toHaveLength(1);
    const persisted = JSON.stringify(Array.from(fakeFirestore.sessions.values()));
    expect(persisted).not.toContain('09012345678');
    expect(persisted).not.toContain('client');
  });

  it('accepts production range values and exposes the active session through admin APIs', async () => {
    const range = {
      planningRangeStart: '2026-07-21',
      planningRangeEnd: '2026-07-27T24:00:00',
    };
    const started = await start('user-1', range);
    expect(started.status).toBe(200);
    const sessionId = String(started.body.sessionId);

    const appended = await handleWeeklyPlanningTraceApi(
      appendRequest(sessionId, {}, {
        planningRangeStart: '2026-07-21T09:00:00',
        planningRangeEnd: '2026-07-27T24:00:00',
      }),
      env(),
      { uid: 'user-1' },
    );
    expect(appended.status).toBe(200);

    const listed = await handleWeeklyPlanningTraceApi(
      new Request('https://example.test/weekly-planning-trace/admin/sessions'),
      env(),
      { uid: 'admin-1' },
    );
    expect(listed.status).toBe(200);
    expect(listed.body.sessions).toEqual([
      expect.objectContaining({
        id: sessionId,
        status: 'active',
        entryCount: 1,
        planningRangeStart: '2026-07-21T09:00:00',
        planningRangeEnd: '2026-07-27T24:00:00',
      }),
    ]);

    const listedEntries = await handleWeeklyPlanningTraceApi(
      new Request('https://example.test/weekly-planning-trace/admin/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      }),
      env(),
      { uid: 'admin-1' },
    );
    expect(listedEntries.status).toBe(200);
    expect(listedEntries.body.entries).toEqual([
      expect.objectContaining({
        id: `${sessionId}-00000000`,
        sessionId,
        sequence: 0,
      }),
    ]);
  });

  it('does not create a session from a direct append with an arbitrary valid UUID', async () => {
    const result = await handleWeeklyPlanningTraceApi(
      appendRequest(MALICIOUS_SESSION_ID),
      env(),
      { uid: 'user-1' },
    );

    expect(result.status).toBe(404);
    expect(result.body.error).toMatch(/must be started/);
    expect(fakeFirestore.sessions.has(MALICIOUS_SESSION_ID)).toBe(false);
  });

  it('rebuilds entry structural IDs from the issued session and sequence', async () => {
    const started = await start();
    const sessionId = String(started.body.sessionId);
    const logicalConversationId = String(started.body.logicalConversationId);
    const result = await handleWeeklyPlanningTraceApi(
      appendRequest(sessionId),
      env(),
      { uid: 'user-1' },
    );

    expect(result.status).toBe(200);
    const expectedEntryId = `${sessionId}-00000000`;
    expect(fakeFirestore.entries.has(expectedEntryId)).toBe(true);
    const persisted = fakeFirestore.entries.get(expectedEntryId);
    expect(persisted).toMatchObject({
      id: expectedEntryId,
      sessionId,
      logicalConversationId,
      sequence: 0,
    });
    expect(JSON.stringify(persisted)).not.toContain(MALICIOUS_SESSION_ID);
    expect(JSON.stringify(persisted)).not.toContain(MALICIOUS_CONVERSATION_ID);
  });

  it('rejects another authenticated user and keeps old layout sessions read-only', async () => {
    const started = await start();
    const sessionId = String(started.body.sessionId);
    const otherUser = await handleWeeklyPlanningTraceApi(
      appendRequest(sessionId),
      env(),
      { uid: 'user-2' },
    );
    expect(otherUser.status).toBe(409);
    expect(otherUser.body.error).toMatch(/ownership/);

    const legacyId = 'weekly-trace-523e4567-e89b-52d3-a456-426614174000';
    const ownerDocument = fakeFirestore.sessions.get(sessionId)!;
    fakeFirestore.sessions.set(legacyId, {
      ...ownerDocument,
      id: legacyId,
      storageLayoutVersion: 1,
      serverIssued: false,
    });
    const legacyWrite = await handleWeeklyPlanningTraceApi(
      appendRequest(legacyId),
      env(),
      { uid: 'user-1' },
    );
    expect(legacyWrite.status).toBe(409);
    expect(legacyWrite.body.error).toMatch(/read-only/);
  });
});
