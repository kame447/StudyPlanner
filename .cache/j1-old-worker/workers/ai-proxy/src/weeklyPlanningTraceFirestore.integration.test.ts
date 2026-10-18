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
  it('creates immutable documents atomically and accepts a retry with a refreshed expiry', async () => {
    const storedValue = {
      id: ENTRY_ID,
      sessionId: SESSION_ID,
      sequence: 0,
      content: 'first',
      expireAt: '2027-01-14T00:00:00.000Z',
    };
    const retryValue = {
      ...storedValue,
      expireAt: '2027-01-14T00:00:01.000Z',
    };
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
        return new Response(JSON.stringify(firestoreDocument(ENTRY_ID, storedValue)), {
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
      storedValue,
    )).resolves.toBeUndefined();
    await expect(client.setImmutableDocument(
      'weekly_planning_trace_entries',
      ENTRY_ID,
      retryValue,
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

  it('updates session metadata and entryCount in one atomic commit', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/documents:commit')) {
        expect(init?.method).toBe('POST');
        const body = JSON.parse(String(init?.body)) as {
          writes: Array<{
            update?: {
              name: string;
              fields: Record<string, unknown>;
            };
            updateMask?: { fieldPaths: string[] };
            currentDocument?: { exists: boolean };
            transform?: {
              document: string;
              fieldTransforms: Array<{
                fieldPath: string;
                maximum: { integerValue: string };
              }>;
            };
          }>;
        };
        expect(body.writes).toHaveLength(2);
        expect(body.writes[0]?.update?.name).toContain(SESSION_ID);
        expect(body.writes[0]?.update?.fields.entryCount).toBeUndefined();
        expect(body.writes[0]?.updateMask?.fieldPaths).not.toContain('entryCount');
        expect(body.writes[0]?.currentDocument).toEqual({ exists: true });
        expect(body.writes[1]?.transform?.document).toContain(SESSION_ID);
        expect(body.writes[1]?.transform?.fieldTransforms).toEqual([{
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
    expect(fetcher).toHaveBeenCalledTimes(2);
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

function appendFixture(options: {
  entryState?: 'matching' | 'mismatching' | 'missing' | 'last-mismatching' | 'last-missing';
  storedCount?: number | null;
  loseFirstResponse?: boolean;
  commitStatus?: number;
} = {}) {
  const entries = Array.from({ length: 100 }, (_, sequence) => ({
    id: `${SESSION_ID}-${String(sequence).padStart(8, '0')}`,
    value: {
      sessionId: SESSION_ID,
      sequence,
      content: `entry ${sequence}`,
      expireAt: '2027-01-14T00:00:01.000Z',
    },
  }));
  const params = {
    entryCollection: 'weekly_planning_trace_entries',
    entries,
    sessionCollection: 'weekly_planning_trace_sessions',
    sessionId: SESSION_ID,
    sessionValue: { entryCount: 100, status: 'active' },
    maximumFieldPath: 'entryCount',
    maximum: 100,
  };
  const name = (collection: string, id: string) => (
    `projects/integration-project/databases/(default)/documents/${collection}/${id}`
  );
  const stored = new Map<string, ReturnType<typeof firestoreDocument>['fields']>();
  if (!options.loseFirstResponse) {
    entries.forEach((entry, index) => {
      if (options.entryState === 'missing'
        || (options.entryState === 'last-missing' && index === 99)) return;
      stored.set(name(params.entryCollection, entry.id), firestoreDocument('', {
        ...entry.value,
        id: '[UUID]',
        content: options.entryState === 'mismatching'
          || (options.entryState === 'last-mismatching' && index === 99)
          ? 'different' : entry.value.content,
        expireAt: '2027-01-14T00:00:00.000Z',
      }).fields);
    });
  }
  const aggregateName = name(params.sessionCollection, SESSION_ID);
  if (options.storedCount !== null) {
    stored.set(aggregateName, firestoreDocument('', {
      status: 'active',
      entryCount: options.storedCount ?? (options.loseFirstResponse ? 0 : 100),
    }).fields);
  }
  const batchSizes: number[] = [];
  let commitAttempts = 0;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }));
    }
    if (url.endsWith('/documents:commit')) {
      commitAttempts += 1;
      if (options.loseFirstResponse && commitAttempts === 1) {
        const { writes } = JSON.parse(String(init?.body));
        expect(writes).toHaveLength(102);
        for (const write of writes) {
          if (write.update) {
            expect(write.currentDocument.exists).toBe(write.update.name === aggregateName);
            if (write.update.name === aggregateName) {
              expect(write.update.fields.entryCount).toBeUndefined();
              expect(write.updateMask.fieldPaths).not.toContain('entryCount');
            }
            stored.set(write.update.name, { ...stored.get(write.update.name), ...write.update.fields });
          } else {
            expect(write.transform.document).toBe(aggregateName);
            expect(write.transform.fieldTransforms).toEqual([{
              fieldPath: 'entryCount', maximum: { integerValue: '100' },
            }]);
            const aggregate = stored.get(aggregateName)!;
            aggregate.entryCount = { integerValue: String(Math.max(
              Number(aggregate.entryCount.integerValue),
              Number(write.transform.fieldTransforms[0].maximum.integerValue),
            )) };
          }
        }
        throw new Error('response lost after commit');
      }
      return new Response('{}', { status: options.commitStatus ?? 409 });
    }
    if (url.endsWith('/documents:batchGet')) {
      const { documents } = JSON.parse(String(init?.body)) as { documents: string[] };
      batchSizes.push(documents.length);
      return new Response(JSON.stringify(documents.map((documentName) => {
        const fields = stored.get(documentName);
        return fields ? { found: { name: documentName, fields } } : { missing: documentName };
      }).reverse()));
    }
    throw new Error(`unexpected request: ${url}`);
  });
  return {
    client: new WeeklyPlanningTraceFirestoreClient(env(), fetcher as typeof fetch, fakeCrypto()),
    params,
    fetcher,
    stored,
    batchSizes,
    firestoreRequestCount: () => fetcher.mock.calls.filter(([input]) => (
      String(input).startsWith('https://firestore.googleapis.com/')
    )).length,
  };
}

describe('weekly planning trace batched append replay', () => {
  it.each([
    ['matching', true],
    ['mismatching', false],
    ['missing', false],
    ['last-mismatching', false],
    ['last-missing', false],
  ] as const)('checks 100 %s entries with bounded reads', async (entryState, accepted) => {
    const fixture = appendFixture({ entryState });
    const before = structuredClone(fixture.stored);
    const replay = fixture.client.commitTraceAppend(fixture.params);
    if (accepted) await expect(replay).resolves.toBeUndefined();
    else await expect(replay).rejects.toThrow('immutable trace document conflict: atomic append');

    expect(fixture.stored).toEqual(before);
    expect(fixture.batchSizes).toEqual([100, 1]);
    expect(fixture.firestoreRequestCount()).toBe(3);
    expect(fixture.fetcher).toHaveBeenCalledTimes(4); // Includes OAuth.
    expect(fixture.fetcher.mock.calls.length).toBeLessThan(50);
  });

  it.each([
    [99, false], [100, true], [130, true], [null, false],
  ] as const)('preserves aggregate maximum semantics for stored count %s', async (storedCount, accepted) => {
    const fixture = appendFixture({ storedCount });
    const before = structuredClone(fixture.stored);
    const replay = fixture.client.commitTraceAppend(fixture.params);
    if (accepted) await expect(replay).resolves.toBeUndefined();
    else await expect(replay).rejects.toThrow('immutable trace document conflict: atomic append');
    expect(fixture.stored).toEqual(before);
    expect(fixture.firestoreRequestCount()).toBe(3);
  });

  it('accepts replay after a lost response without rewriting entries or lowering the maximum', async () => {
    const fixture = appendFixture({ loseFirstResponse: true, storedCount: 130 });
    await expect(fixture.client.commitTraceAppend(fixture.params))
      .rejects.toThrow('response lost after commit');
    const committed = structuredClone(fixture.stored);
    expect(committed.size).toBe(101);

    await expect(fixture.client.commitTraceAppend({
      ...fixture.params,
      entries: fixture.params.entries.map((entry) => ({
        ...entry, value: { ...entry.value, expireAt: '2027-01-15T00:00:00.000Z' },
      })),
    })).resolves.toBeUndefined();

    expect(fixture.stored).toEqual(committed);
    expect(fixture.batchSizes).toEqual([100, 1]);
    expect(fixture.firestoreRequestCount()).toBe(4);
    expect(fixture.fetcher).toHaveBeenCalledTimes(5);
  });

  it('does not reinterpret a non-409 failure as an idempotent replay', async () => {
    const fixture = appendFixture({ commitStatus: 412 });
    await expect(fixture.client.commitTraceAppend(fixture.params))
      .rejects.toThrow('Firestore atomic trace append failed: 412');
    expect(fixture.batchSizes).toEqual([]);
    expect(fixture.firestoreRequestCount()).toBe(1);
  });
});
