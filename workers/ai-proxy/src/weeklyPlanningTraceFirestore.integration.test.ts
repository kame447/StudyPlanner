import { describe, expect, it, vi } from 'vitest';
import { WeeklyPlanningTraceFirestoreClient } from './weeklyPlanningTraceFirestore';

const SESSION_ID = 'weekly-trace-123e4567-e89b-12d3-a456-426614174000';
const ENTRY_ID = `${SESSION_ID}-00000000`;

function firestoreDocument(id: string, fields: Record<string, unknown>) {
  const encode = (value: unknown): Record<string, unknown> => {
    if (typeof value === 'string') return { stringValue: value };
    if (typeof value === 'number') return { integerValue: String(value) };
    if (typeof value === 'boolean') return { booleanValue: value };
    throw new Error(`unsupported fixture value: ${String(value)}`);
  };

  return {
    name: `projects/integration-project/databases/(default)/documents/weekly_planning_trace_entries/${id}`,
    fields: Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, encode(value)]),
    ),
  };
}

function fakeCrypto(): Crypto {
  return {
    subtle: {
      importKey: vi.fn(async () => ({}) as CryptoKey),
      sign: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
    } as unknown as SubtleCrypto,
  } as Crypto;
}

function env() {
  return {
    FIREBASE_PROJECT_ID: 'integration-project',
    FIREBASE_SERVICE_ACCOUNT_EMAIL: 'service@example.com',
    FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY:
      '-----BEGIN PRIVATE KEY-----\nAQID\n-----END PRIVATE KEY-----',
  };
}

describe('weekly planning trace Firestore protocol integration', () => {
  it('creates immutable documents atomically and accepts an identical retry', async () => {
    const value = { id: ENTRY_ID, sessionId: SESSION_ID, sequence: 0, content: 'first' };
    let createAttempts = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/weekly_planning_trace_entries?documentId=')) {
        expect(init?.method).toBe('POST');
        createAttempts += 1;
        return createAttempts === 1
          ? new Response('{}', { status: 200 })
          : new Response('{}', { status: 409 });
      }
      if (url.endsWith(`/weekly_planning_trace_entries/${encodeURIComponent(ENTRY_ID)}`)) {
        return new Response(JSON.stringify(firestoreDocument(ENTRY_ID, value)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const client = new WeeklyPlanningTraceFirestoreClient(
      env(),
      fetcher as typeof fetch,
      fakeCrypto(),
    );

    await expect(client.setImmutableDocument(
      'weekly_planning_trace_entries',
      ENTRY_ID,
      value,
    )).resolves.toBeUndefined();
    await expect(client.setImmutableDocument(
      'weekly_planning_trace_entries',
      ENTRY_ID,
      value,
    )).resolves.toBeUndefined();
    expect(createAttempts).toBe(2);
  });

  it('rejects an immutable retry whose payload differs from the stored document', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/weekly_planning_trace_entries?documentId=')) {
        return new Response('{}', { status: 409 });
      }
      if (url.endsWith(`/weekly_planning_trace_entries/${encodeURIComponent(ENTRY_ID)}`)) {
        return new Response(JSON.stringify(firestoreDocument(ENTRY_ID, {
          id: ENTRY_ID,
          sessionId: SESSION_ID,
          sequence: 0,
          content: 'stored',
        })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const client = new WeeklyPlanningTraceFirestoreClient(
      env(),
      fetcher as typeof fetch,
      fakeCrypto(),
    );

    await expect(client.setImmutableDocument(
      'weekly_planning_trace_entries',
      ENTRY_ID,
      { id: ENTRY_ID, sessionId: SESSION_ID, sequence: 0, content: 'different' },
    )).rejects.toThrow(/immutable trace document conflict/);
  });

  it('preserves entryCount during metadata PATCH and applies an atomic maximum transform', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes(`/weekly_planning_trace_sessions/${encodeURIComponent(SESSION_ID)}?`)) {
        expect(init?.method).toBe('PATCH');
        expect(url).not.toContain('updateMask.fieldPaths=entryCount');
        const body = JSON.parse(String(init?.body)) as {
          fields: Record<string, unknown>;
        };
        expect(body.fields.entryCount).toBeUndefined();
        return new Response('{}', { status: 200 });
      }
      if (url.endsWith('/documents:commit')) {
        expect(init?.method).toBe('POST');
        const body = JSON.parse(String(init?.body)) as {
          writes: Array<{
            transform: {
              document: string;
              fieldTransforms: Array<{
                fieldPath: string;
                maximum: { integerValue: string };
              }>;
            };
          }>;
        };
        expect(body.writes[0]?.transform.document).toContain(SESSION_ID);
        expect(body.writes[0]?.transform.fieldTransforms).toEqual([{
          fieldPath: 'entryCount',
          maximum: { integerValue: '7' },
        }]);
        return new Response('{}', { status: 200 });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const client = new WeeklyPlanningTraceFirestoreClient(
      env(),
      fetcher as typeof fetch,
      fakeCrypto(),
    );

    await expect(client.setDocumentWithMaximumInteger(
      'weekly_planning_trace_sessions',
      SESSION_ID,
      {
        id: SESSION_ID,
        logicalConversationId: 'weekly-conversation-223e4567-e89b-12d3-a456-426614174000',
        entryCount: 7,
      },
      'entryCount',
      7,
    )).resolves.toBeUndefined();
  });

  it('uses the Firestore document path ID instead of redacted structural fields for get and query', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const document = firestoreDocument(ENTRY_ID, {
        id: '[UUID]',
        sessionId: '[UUID]',
        sequence: 0,
        content: 'first',
      });
      if (url.endsWith(`/weekly_planning_trace_entries/${encodeURIComponent(ENTRY_ID)}`)) {
        return new Response(JSON.stringify(document), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/documents:runQuery')) {
        return new Response(JSON.stringify([{ document }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const client = new WeeklyPlanningTraceFirestoreClient(
      env(),
      fetcher as typeof fetch,
      fakeCrypto(),
    );

    const fetched = await client.getDocument('weekly_planning_trace_entries', ENTRY_ID);
    expect(fetched).toEqual(expect.objectContaining({
      id: ENTRY_ID,
      sessionId: '[UUID]',
      sequence: 0,
      content: 'first',
    }));

    const queried = await client.queryDocuments(
      'weekly_planning_trace_entries',
      [{ field: 'sessionId', value: SESSION_ID }],
    );
    expect(queried).toEqual([
      expect.objectContaining({
        id: ENTRY_ID,
        sessionId: '[UUID]',
      }),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
