import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleWeeklyPlanningTraceApi } from './weeklyPlanningTraceApi';
import { resolveWeeklyPlanningTraceEpoch } from './weeklyPlanningTracePrivacy';

const fakeFirestore = (() => {
  const sessionId = 'weekly-trace-123e4567-e89b-12d3-a456-426614174000';
  const conversationId = 'weekly-conversation-223e4567-e89b-12d3-a456-426614174000';
  const legacySessionId = 'weekly-trace-[UUID]';
  const sessionDocument = {
    id: sessionId,
    logicalConversationId: conversationId,
    entryCount: 2,
    storageLayoutVersion: 2,
    serverIssued: true,
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
  const initialEntries = new Map(entryDocuments);
  const auditWrites: Array<Record<string, unknown>> = [];
  const requestedEntryIds: string[] = [];
  let queriedCurrentSequences = [0, 1];

  const requests: string[] = [];
  const batchSizes: number[] = [];

  function document(collection: string, id: string, value: Record<string, unknown>) {
    return {
      name: `projects/integration-project/databases/(default)/documents/${collection}/${id}`,
      fields: Object.fromEntries(Object.entries(value).map(([key, field]) => {
        if (typeof field === 'string') return [key, { stringValue: field }];
        if (typeof field === 'number') return [key, { integerValue: String(field) }];
        if (typeof field === 'boolean') return [key, { booleanValue: field }];
        throw new Error(`unsupported fixture value: ${String(field)}`);
      })),
    };
  }

  async function fetcher(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = String(input);
    requests.push(url);
    const respond = (value: unknown) => new Response(JSON.stringify(value));
    if (url.endsWith('/admins/admin-user')) {
      return respond(document('admins', 'admin-user', {
        enabled: true, weeklyPlanningTraceReader: true,
      }));
    }
    if (url.endsWith(`/weekly_planning_trace_sessions/${encodeURIComponent(sessionId)}`)) {
      return respond(document('weekly_planning_trace_sessions', sessionId, sessionDocument));
    }
    if (url.endsWith(`/weekly_planning_trace_sessions/${encodeURIComponent(legacySessionId)}`)) {
      return respond(document('weekly_planning_trace_sessions', legacySessionId, legacySessionDocument));
    }
    if (url.endsWith('/documents:batchGet')) {
      const { documents } = JSON.parse(String(init?.body)) as { documents: string[] };
      batchSizes.push(documents.length);
      return respond(documents.map((name) => {
        const id = name.split('/').pop()!;
        if (id.startsWith(sessionId)) requestedEntryIds.push(id);
        const entry = entryDocuments.get(id);
        return entry
          ? { found: document('weekly_planning_trace_entries', id, entry) }
          : { missing: name };
      }).reverse());
    }
    if (url.endsWith('/documents:runQuery')) {
      const body = JSON.parse(String(init?.body));
      const collection = body.structuredQuery.from[0].collectionId;
      if (collection === 'weekly_planning_trace_sessions') {
        return respond([{ document: document(collection, sessionId, sessionDocument) }]);
      }
      if (collection === 'weekly_planning_trace_entries') {
        return respond(queriedCurrentSequences.flatMap((sequence) => {
          const id = `${sessionId}-${String(sequence).padStart(8, '0')}`;
          const entry = entryDocuments.get(id);
          return entry ? [{ document: document(collection, id, entry) }] : [];
        }));
      }
    }
    if (url.includes('/weekly_planning_trace_access_audit?documentId=')) {
      auditWrites.push(JSON.parse(String(init?.body)));
      return respond({});
    }
    throw new Error(`unexpected request: ${url}`);
  }

  return {
    sessionId,
    legacySessionId,
    conversationId,
    auditWrites,
    requestedEntryIds,
    setQueriedCurrentSequences(sequences: number[]) {
      queriedCurrentSequences = [...sequences];
    },
    requests,
    batchSizes,
    entryDocuments,
    sessionDocument,
    fetcher,
    reset() {
      entryDocuments.clear();
      initialEntries.forEach((entry, id) => entryDocuments.set(id, { ...entry }));
      sessionDocument.entryCount = 2;
      requests.length = 0;
      batchSizes.length = 0;
      auditWrites.length = 0;
      requestedEntryIds.length = 0;
      queriedCurrentSequences = [0, 1];
    },
  };
})();

const tokenProvider = { getToken: async () => 'cached-token' };

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

function adminEntriesRequest(sessionId: string): Request {
  return new Request('https://example.test/weekly-planning-trace/admin/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
}

describe('weekly planning trace admin API integration', () => {
  beforeEach(() => {
    fakeFirestore.reset();
    vi.stubGlobal('fetch', fakeFirestore.fetcher);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('lists a session and retrieves its entries with the same opaque lookup ID', async () => {
    const sessionsResult = await handleWeeklyPlanningTraceApi(
      new Request('https://example.test/weekly-planning-trace/admin/sessions'),
      env(),
      { uid: 'admin-user' },
      tokenProvider,
    );

    expect(sessionsResult.status).toBe(200);
    const sessions = sessionsResult.body.sessions as Array<Record<string, unknown>>;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(fakeFirestore.sessionId);
    expect(sessions[0].logicalConversationId).toBe(fakeFirestore.conversationId);
    expect(JSON.stringify(sessions)).not.toContain('traceSubjectToken');

    const entriesResult = await handleWeeklyPlanningTraceApi(
      adminEntriesRequest(String(sessions[0].id)),
      env(),
      { uid: 'admin-user' },
      tokenProvider,
    );

    expect(entriesResult.status).toBe(200);
    const entries = entriesResult.body.entries as Array<Record<string, unknown>>;
    expect(entries.map((entry) => entry.id)).toEqual([
      `${fakeFirestore.sessionId}-00000000`,
      `${fakeFirestore.sessionId}-00000001`,
    ]);
    expect(entries.every((entry) => entry.sessionId === fakeFirestore.sessionId)).toBe(true);
    expect(JSON.stringify(entries)).not.toContain('traceSubjectToken');
    expect(fakeFirestore.requestedEntryIds).toEqual([]);
    expect(fakeFirestore.batchSizes).toEqual([]);
    expect(fakeFirestore.auditWrites).toHaveLength(2);
  });

  it('recovers a missing current-layout entry by its deterministic document ID', async () => {
    fakeFirestore.setQueriedCurrentSequences([0]);

    const result = await handleWeeklyPlanningTraceApi(
      adminEntriesRequest(fakeFirestore.sessionId),
      env(),
      { uid: 'admin-user' },
      tokenProvider,
    );

    expect(result.status).toBe(200);
    const entries = result.body.entries as Array<Record<string, unknown>>;
    expect(entries.map((entry) => entry.content)).toEqual(['first', 'second']);
    expect(fakeFirestore.requestedEntryIds).toEqual([
      `${fakeFirestore.sessionId}-00000001`,
    ]);
  });

  it('recovers all entries when a mixed deployment makes the sessionId query return no rows', async () => {
    fakeFirestore.setQueriedCurrentSequences([]);

    const result = await handleWeeklyPlanningTraceApi(
      adminEntriesRequest(fakeFirestore.sessionId),
      env(),
      { uid: 'admin-user' },
      tokenProvider,
    );

    expect(result.status).toBe(200);
    const entries = result.body.entries as Array<Record<string, unknown>>;
    expect(entries.map((entry) => entry.id)).toEqual([
      `${fakeFirestore.sessionId}-00000000`,
      `${fakeFirestore.sessionId}-00000001`,
    ]);
    expect(entries.every((entry) => entry.sessionId === fakeFirestore.sessionId)).toBe(true);
    expect(fakeFirestore.requestedEntryIds).toEqual([
      `${fakeFirestore.sessionId}-00000000`,
      `${fakeFirestore.sessionId}-00000001`,
    ]);
  });

  it('retrieves entries for the exact legacy redacted session handle', async () => {
    const result = await handleWeeklyPlanningTraceApi(
      adminEntriesRequest(fakeFirestore.legacySessionId),
      env(),
      { uid: 'admin-user' },
      tokenProvider,
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

  it('recovers 500 missing query sequences in five reads, restoring IDs and skipping absent documents', async () => {
    fakeFirestore.setQueriedCurrentSequences([]);
    fakeFirestore.sessionDocument.entryCount = 500;
    const expectedEntries = Array.from({ length: 500 }, (_, sequence) => ({
      id: `${fakeFirestore.sessionId}-${String(sequence).padStart(8, '0')}`,
      sessionId: fakeFirestore.sessionId,
      sequence,
      content: `entry ${sequence}`,
    })).filter((entry) => entry.sequence !== 99 && entry.sequence !== 100);
    fakeFirestore.entryDocuments.clear();
    expectedEntries.forEach((entry) => {
      fakeFirestore.entryDocuments.set(entry.id, {
        ...entry,
        id: '[UUID]',
        sessionId: '[UUID]',
        sequence: -1,
        traceSubjectToken: 'wpt_hidden-entry-token',
      });
    });

    const result = await handleWeeklyPlanningTraceApi(
      adminEntriesRequest(fakeFirestore.sessionId),
      env(),
      { uid: 'admin-user' },
      tokenProvider,
    );

    expect(result.status).toBe(200);
    expect(result.body.entries).toEqual(expectedEntries.map((entry) => ({
      ...entry, subjectAlias: 'subject--entry-token',
    })));
    expect(fakeFirestore.batchSizes).toEqual([100, 100, 100, 100, 100]);
    expect(fakeFirestore.requestedEntryIds).toHaveLength(500);
    // Reader authorization, session, audit, query, then five batch requests.
    expect(fakeFirestore.requests).toHaveLength(9);
    expect(fakeFirestore.requests.length).toBeLessThan(50);
  });
});
