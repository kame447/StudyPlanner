import { describe, expect, it, vi } from 'vitest';

const fakeFirestore = vi.hoisted(() => {
  const sessionId = 'weekly-trace-123e4567-e89b-12d3-a456-426614174000';
  const conversationId = 'weekly-conversation-223e4567-e89b-12d3-a456-426614174000';
  const legacySessionId = 'weekly-trace-[UUID]';
  const sessionDocument = {
    id: sessionId,
    logicalConversationId: conversationId,
    entryCount: 2,
    storageLayoutVersion: 1,
    traceSubjectToken: 'wpt_hidden-session-token',
  };
  const legacySessionDocument = {
    id: legacySessionId,
    logicalConversationId: '[UUID]',
    entryCount: 1,
    traceSubjectToken: 'wpt_hidden-legacy-session-token',
  };
  const entryDocuments = new Map<string, Record<string, unknown>>([
    [`${legacySessionId}-00000000`, {
      id: `${legacySessionId}-00000000`,
      sessionId: legacySessionId,
      logicalConversationId: '[UUID]',
      sequence: 0,
      content: 'legacy',
      traceSubjectToken: 'wpt_hidden-legacy-entry-token',
    }],
    [`${sessionId}-00000000`, {
      id: `${sessionId}-00000000`,
      sessionId: '[UUID]',
      logicalConversationId: conversationId,
      sequence: 0,
      content: 'first',
      traceSubjectToken: 'wpt_hidden-entry-token',
    }],
    [`${sessionId}-00000001`, {
      id: `${sessionId}-00000001`,
      sessionId: '[UUID]',
      logicalConversationId: conversationId,
      sequence: 1,
      content: 'second',
      traceSubjectToken: 'wpt_hidden-entry-token',
    }],
  ]);
  const auditWrites: Array<Record<string, unknown>> = [];

  class FakeWeeklyPlanningTraceFirestoreClient {
    async getDocument(collection: string, id: string): Promise<Record<string, unknown> | null> {
      if (collection === 'admins' && id === 'admin-user') {
        return { enabled: true, weeklyPlanningTraceReader: true };
      }
      if (collection === 'weekly_planning_trace_sessions' && id === sessionId) {
        return { ...sessionDocument };
      }
      if (collection === 'weekly_planning_trace_sessions' && id === legacySessionId) {
        return { ...legacySessionDocument };
      }
      if (collection === 'weekly_planning_trace_entries') {
        if (id.startsWith(legacySessionId)) {
          return entryDocuments.get(id) ?? null;
        }
        throw new Error('current layout must use a bounded session query');
      }
      return null;
    }

    async queryDocuments(collection: string): Promise<Record<string, unknown>[]> {
      if (collection === 'weekly_planning_trace_sessions') {
        return [{ ...sessionDocument }];
      }
      if (collection === 'weekly_planning_trace_entries') {
        return Array.from(entryDocuments.values()).map((entry) => ({ ...entry }));
      }
      return [];
    }

    async setImmutableDocument(
      _collection: string,
      _id: string,
      value: Record<string, unknown>,
    ): Promise<void> {
      auditWrites.push({ ...value });
    }

    async setDocument(): Promise<void> {}
    async deleteByStringField(): Promise<number> { return 0; }
  }

  return {
    sessionId,
    legacySessionId,
    conversationId,
    auditWrites,
    FakeWeeklyPlanningTraceFirestoreClient,
  };
});

vi.mock('./weeklyPlanningTraceFirestore', () => ({
  WeeklyPlanningTraceFirestoreClient:
    fakeFirestore.FakeWeeklyPlanningTraceFirestoreClient,
}));

import { handleWeeklyPlanningTraceApi } from './weeklyPlanningTraceApi';
import { resolveWeeklyPlanningTraceEpoch } from './weeklyPlanningTracePrivacy';

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

describe('weekly planning trace admin API integration', () => {
  it('lists a session and retrieves its entries with the same opaque lookup ID', async () => {
    const sessionsResult = await handleWeeklyPlanningTraceApi(
      new Request('https://example.test/weekly-planning-trace/admin/sessions'),
      env(),
      { uid: 'admin-user' },
    );

    expect(sessionsResult.status).toBe(200);
    const sessions = sessionsResult.body.sessions as Array<Record<string, unknown>>;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(fakeFirestore.sessionId);
    expect(sessions[0].logicalConversationId).toBe(fakeFirestore.conversationId);
    expect(JSON.stringify(sessions)).not.toContain('traceSubjectToken');

    const entriesResult = await handleWeeklyPlanningTraceApi(
      new Request('https://example.test/weekly-planning-trace/admin/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: String(sessions[0].id) }),
      }),
      env(),
      { uid: 'admin-user' },
    );

    expect(entriesResult.status).toBe(200);
    const entries = entriesResult.body.entries as Array<Record<string, unknown>>;
    expect(entries.map((entry) => entry.id)).toEqual([
      `${fakeFirestore.sessionId}-00000000`,
      `${fakeFirestore.sessionId}-00000001`,
    ]);
    expect(entries.every((entry) => entry.sessionId === fakeFirestore.sessionId)).toBe(true);
    expect(JSON.stringify(entries)).not.toContain('traceSubjectToken');
    expect(fakeFirestore.auditWrites).toHaveLength(2);
  });

  it('retrieves entries for the exact legacy redacted session handle', async () => {
    const result = await handleWeeklyPlanningTraceApi(
      new Request('https://example.test/weekly-planning-trace/admin/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: fakeFirestore.legacySessionId }),
      }),
      env(),
      { uid: 'admin-user' },
    );

    expect(result.status).toBe(200);
    const entries = result.body.entries as Array<Record<string, unknown>>;
    expect(entries).toEqual([
      expect.objectContaining({
        id: `${fakeFirestore.legacySessionId}-00000000`,
        sessionId: fakeFirestore.legacySessionId,
        content: 'legacy',
      }),
    ]);
  });

});
