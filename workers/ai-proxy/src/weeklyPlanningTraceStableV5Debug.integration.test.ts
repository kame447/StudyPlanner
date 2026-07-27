import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WEEKLY_PLANNING_TRACE_DEBUG_CHUNK_ENCODING,
  WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS,
  encodeWeeklyPlanningTraceDebugChunkBase64,
} from '../../../shared/weeklyPlanningTraceContract';

const fakeFirestore = vi.hoisted(() => {
  const sessions = new Map<string, Record<string, unknown>>();
  const entries = new Map<string, Record<string, unknown>>();

  class FakeWeeklyPlanningTraceFirestoreClient {
    async getDocument(collection: string, id: string): Promise<Record<string, unknown> | null> {
      if (collection === 'profiles') {
        return {
          weeklyPlanningTracePolicy: {
            version: '2026-07-18-v1',
            acceptedAt: '2026-07-27T00:00:00.000Z',
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
      const current = target.get(id);
      if (current) {
        if (JSON.stringify(current) === JSON.stringify({ ...value, id })) return;
        throw new Error(`immutable trace document conflict: ${collection}/${id}`);
      }
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

const NOW = '2026-07-27T00:00:00.000Z';
const CLIENT_SESSION_KEY = 'weekly-trace-stable-v5-09012345678-client';
const CLIENT_CONVERSATION_KEY = 'weekly-planning-conversation-09012345678-client';

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

function sessionMetadata(entryCount: number, turnCount: number) {
  return {
    status: 'active',
    startedAt: NOW,
    lastActivityAt: NOW,
    planningRangeStart: '2026-07-27',
    planningRangeEnd: '2026-07-27',
    turnCount,
    entryCount,
    hasPreview: false,
    hasApprovalFailure: false,
    hasFallback: false,
    hasError: false,
    appVersion: 'test',
    schemaVersion: 1,
  };
}

async function startSession() {
  return handleWeeklyPlanningTraceApi(
    new Request('https://example.test/weekly-planning-trace/session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: CLIENT_SESSION_KEY,
        conversationCorrelationKey: CLIENT_CONVERSATION_KEY,
        session: sessionMetadata(0, 0),
      }),
    }),
    env(),
    { uid: 'user-1' },
  );
}

beforeEach(() => {
  fakeFirestore.sessions.clear();
  fakeFirestore.entries.clear();
});

describe('Stable V5 debug trace server boundary', () => {
  it('converges repeated starts and persists a debug entry in the same non-empty session', async () => {
    const firstStart = await startSession();
    const repeatedStart = await startSession();

    expect(firstStart.status).toBe(200);
    expect(repeatedStart.status).toBe(200);
    expect(repeatedStart.body).toMatchObject({
      sessionId: firstStart.body.sessionId,
      logicalConversationId: firstStart.body.logicalConversationId,
    });
    expect(fakeFirestore.sessions.size).toBe(1);

    const sessionId = String(firstStart.body.sessionId);
    const logicalConversationId = String(firstStart.body.logicalConversationId);
    const rawChunk = 'x'.repeat(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.debugRawChunkBytes);
    const dataChunk = encodeWeeklyPlanningTraceDebugChunkBase64(btoa(rawChunk));
    expect(dataChunk.length).toBeLessThan(4_000);
    expect(dataChunk.split('.').every((run) => run.length <= 20)).toBe(true);

    const appended = await handleWeeklyPlanningTraceApi(
      new Request('https://example.test/weekly-planning-trace/append', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: {
            ...sessionMetadata(1, 0),
            id: sessionId,
            logicalConversationId,
          },
          entries: [{
            id: `${sessionId}-00000000`,
            sessionId,
            logicalConversationId,
            sequence: 0,
            requestId: 'request-1',
            stateRevision: 0,
            occurredAt: NOW,
            observedAt: NOW,
            schemaVersion: 1,
            kind: 'internal_event',
            eventType: 'stable_v5_debug_stage',
            payload: {
              storage: 'base64_utf8_json_chunk',
              debugSchemaVersion: 1,
              debugSequence: 0,
              stage: 'runtime_turn_input',
              stageOccurredAt: NOW,
              sourceSanitizerTruncated: false,
              encoding: WEEKLY_PLANNING_TRACE_DEBUG_CHUNK_ENCODING,
              chunkIndex: 0,
              chunkCount: 1,
              totalSerializedBytes: rawChunk.length,
              chunkBytes: rawChunk.length,
              dataChunk,
            },
            severity: 'debug',
          }],
        }),
      }),
      env(),
      { uid: 'user-1' },
    );

    expect(appended.status).toBe(200);
    expect(fakeFirestore.sessions.size).toBe(1);
    expect(fakeFirestore.entries.size).toBe(1);

    const listed = await handleWeeklyPlanningTraceApi(
      new Request('https://example.test/weekly-planning-trace/admin/sessions'),
      env(),
      { uid: 'admin-1' },
    );
    expect(listed.status).toBe(200);
    expect(listed.body.sessions).toEqual([
      expect.objectContaining({
        id: sessionId,
        logicalConversationId,
        turnCount: 0,
        entryCount: 1,
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
        logicalConversationId,
        sequence: 0,
        eventType: 'stable_v5_debug_stage',
        payload: expect.objectContaining({ dataChunk }),
      }),
    ]);
  });
});