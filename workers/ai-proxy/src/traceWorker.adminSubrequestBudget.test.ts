import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import traceWorker from './traceWorker';

const SESSION_ID = 'weekly-trace-123e4567-e89b-52d3-a456-426614174000';
const env = {
  FIREBASE_PROJECT_ID: 'test-project',
  FIREBASE_SERVICE_ACCOUNT_EMAIL: 'service@example.com',
  FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'AQ==',
  FIREBASE_WEB_API_KEY: 'web-api-key',
  OBSERVABILITY_IDENTITY_SECRET: '0123456789abcdef0123456789abcdef',
  WEEKLY_PLANNING_TRACE_HMAC_SECRETS: JSON.stringify({
    690: 'trace-test-secret-0123456789abcdef0123456789',
  }),
  ENVIRONMENT: 'test',
};

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function value(input: unknown): Record<string, unknown> {
  if (input === null || input === undefined) return { nullValue: null };
  if (typeof input === 'boolean') return { booleanValue: input };
  if (typeof input === 'number') return { integerValue: String(input) };
  if (typeof input === 'string') return { stringValue: input };
  if (Array.isArray(input)) return { arrayValue: { values: input.map(value) } };
  return {
    mapValue: {
      fields: Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .map(([key, item]) => [key, value(item)]),
      ),
    },
  };
}

function document(
  collection: string,
  id: string,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return {
    name: `projects/test-project/databases/(default)/documents/${collection}/${id}`,
    fields: Object.fromEntries(Object.entries(fields).map(([key, fieldValue]) => [
      key,
      value(fieldValue),
    ])),
  };
}

function queryCollection(init?: RequestInit): string {
  const body = JSON.parse(String(init?.body ?? '{}')) as {
    structuredQuery?: { from?: Array<{ collectionId?: string }> };
  };
  return body.structuredQuery?.from?.[0]?.collectionId ?? '';
}

function installFetchMock(options: {
  populatedUsers?: boolean;
  profileCount?: number;
  usersReady?: boolean;
  missingIdentities?: boolean;
  largeDebugEntries?: boolean;
} = {}): FetchCall[] {
  vi.stubGlobal('crypto', {
    randomUUID: () => '123e4567-e89b-42d3-a456-426614174000',
    subtle: {
      importKey: async () => ({}) as CryptoKey,
      sign: async () => new ArrayBuffer(32),
    },
  } as unknown as Crypto);
  const calls: FetchCall[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('identitytoolkit.googleapis.com')) {
      return new Response(JSON.stringify({
        users: [{ localId: 'admin-uid', emailVerified: true }],
      }), { status: 200 });
    }
    if (url === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ access_token: 'shared-token', expires_in: 3600 }), {
        status: 200,
      });
    }
    if (url.includes('/documents/admins/admin-uid')) {
      return new Response(JSON.stringify(document('admins', 'admin-uid', {
        enabled: true,
        weeklyPlanningTraceReader: true,
      })), { status: 200 });
    }
    if (url.includes('/documents/observability_user_enrichment_backfill_state/main')) {
      if (!options.usersReady) return new Response(null, { status: 404 });
      return new Response(JSON.stringify(document(
        'observability_user_enrichment_backfill_state',
        'main',
        {
          schemaVersion: 1,
          environmentIndex: 4,
          cursorDocumentName: null,
          pendingRecentErrorScan: null,
          completedEnvironments: ['production', 'preview', 'development', 'test'],
          processedUsers: 25,
          enrichedUsers: 25,
          completed: true,
          updatedAt: '2026-09-25T00:00:00.000Z',
        },
      )), { status: 200 });
    }
    if (url.includes(`/documents/weekly_planning_trace_sessions/${SESSION_ID}`)) {
      return new Response(JSON.stringify(document('weekly_planning_trace_sessions', SESSION_ID, {
        startedAt: '2026-09-25T00:00:00.000Z',
        lastActivityAt: '2026-09-25T00:10:00.000Z',
        status: 'completed',
        entryCount: 200,
        turnCount: 10,
      })), { status: 200 });
    }
    if (url.includes('/documents/weekly_planning_trace_access_audit?')) {
      return new Response(null, { status: 200 });
    }
    if (url.includes('/documents/observability_actor_directory/')) {
      const id = url.split('/').pop() ?? 'directory';
      return new Response(JSON.stringify(document('observability_actor_directory', id, {
        actorSubjectId: `actor-${id.slice(-12).padStart(12, '0')}`,
      })), { status: 200 });
    }
    if (url.includes('/documents/observability_user_summary_test/')) {
      const id = decodeURIComponent(url.split('/').pop() ?? 'actor-00000000');
      return new Response(JSON.stringify(document('observability_user_summary_test', id, {
        schemaVersion: 1,
        actorSubjectId: id,
        firstActivityAt: '2026-09-01T00:00:00.000Z',
        lastActivityAt: '2026-09-25T00:00:00.000Z',
        firstActivityDate: '2026-09-01',
        lastActivityDate: '2026-09-25',
        eventCount: 1,
        productActivityCount: 1,
        aiRequestCount: 0,
        planningOutcomeCount: 0,
        updatedAt: '2026-09-25T00:00:01.000Z',
      })), { status: 200 });
    }
    if (url.includes('/documents/profiles/firebase-user-1')) {
      return new Response(JSON.stringify(document('profiles', 'firebase-user-1', {
        email: 'user@example.com',
        username: 'Example User',
        registeredAt: '2026-09-01T00:00:00.000Z',
      })), { status: 200 });
    }
    if (url.endsWith('/documents:batchGet')) {
      const body = JSON.parse(String(init?.body)) as { documents: string[] };
      if (options.largeDebugEntries
        && body.documents.every((name) => name.includes('/weekly_planning_trace_entries/'))) {
        return new Response(JSON.stringify(body.documents.map((name) => {
          const id = name.split('/').pop() ?? '';
          const sequence = Number(id.slice(-8));
          return {
            found: document('weekly_planning_trace_entries', id, {
              sessionId: SESSION_ID,
              sequence,
              kind: 'turn_diagnostic',
              schemaVersion: 2,
              occurredAt: new Date(Date.UTC(2026, 8, 25, 0, 0, sequence)).toISOString(),
              payload: 'x '.repeat(31_500),
            }),
          };
        })), { status: 200 });
      }
      if (body.documents.every((name) => name.includes('/observability_actor_directory/'))) {
        if (options.missingIdentities) {
          return new Response(JSON.stringify(
            body.documents.map((name) => ({ missing: name })),
          ), { status: 200 });
        }
        return new Response(JSON.stringify(body.documents.map((name) => ({
          found: document(
            'observability_actor_directory',
            name.split('/').pop() ?? 'directory',
            { actorSubjectId: 'actor-aaaaaaaa' },
          ),
        }))), { status: 200 });
      }
      if (body.documents.every((name) => name.includes('/observability_user_summary_test/'))) {
        return new Response(JSON.stringify(body.documents.map((name) => ({
          found: document(
            'observability_user_summary_test',
            name.split('/').pop() ?? 'actor-aaaaaaaa',
            {
              schemaVersion: 1,
              actorSubjectId: 'actor-aaaaaaaa',
              firstActivityAt: '2026-09-01T00:00:00.000Z',
              lastActivityAt: '2026-09-25T00:00:00.000Z',
              firstActivityDate: '2026-09-01',
              lastActivityDate: '2026-09-25',
              eventCount: 1,
              productActivityCount: 1,
              aiRequestCount: 0,
              planningOutcomeCount: 0,
              lastProductAction: 'plan_created',
              lastPlanningOutcome: null,
              userEnrichmentVersion: 1,
              activeDayCount: 1,
              latestErrorAt: null,
              latestErrorCategory: null,
              userEnrichmentUpdatedAt: '2026-09-25T00:00:01.000Z',
              updatedAt: '2026-09-25T00:00:01.000Z',
            },
          ),
        }))), { status: 200 });
      }
      return new Response(JSON.stringify(body.documents.map((name) => ({ missing: name }))), {
        status: 200,
      });
    }
    if (url.includes(':runAggregationQuery')) {
      return new Response(JSON.stringify([{
        result: { aggregateFields: { count: { integerValue: '0' } } },
      }]), { status: 200 });
    }
    if (url.includes(':runQuery')) {
      const collection = queryCollection(init);
      if (collection === 'profiles') {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          structuredQuery?: { limit?: number };
        };
        const requestedLimit = body.structuredQuery?.limit ?? 100;
        const count = Math.min(
          options.profileCount ?? (options.populatedUsers ? 25 : 5),
          requestedLimit,
        );
        return new Response(JSON.stringify(Array.from({ length: count }, (_, index) => ({
          document: document('profiles', `firebase-user-${index + 1}`, {
            email: index === 0 ? 'user@example.com' : `user-${index + 1}@example.com`,
            username: options.populatedUsers ? `Example User ${index + 1}` : 'firebase-user-1',
            registeredAt: '2026-09-01T00:00:00.000Z',
          }),
        }))), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }
    return new Response(null, { status: 404 });
  });
  return calls;
}

async function adminGet(path: string): Promise<Response> {
  return await traceWorker.fetch(
    new Request(`https://worker.example${path}`, {
      headers: { Authorization: 'Bearer firebase-id-token' },
    }),
    env,
  );
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('traceWorker admin subrequest budget', () => {
  it.each([
    ['/observability/admin/overview?from=2026-06-25&to=2026-09-25', 9],
    ['/observability/admin/ai?from=2026-06-25&to=2026-09-25', 5],
    ['/observability/admin/planning?from=2026-06-25&to=2026-09-25', 4],
    ['/observability/admin/system', 6],
    ['/observability/admin/user-identity?q=firebase-user-1', 6],
    ['/observability/admin/users?actor=actor-aaaaaaaa&limit=100', 6],
    ['/observability/admin/logs?limit=50', 5],
    [`/observability/admin/log-entries?session=${SESSION_ID}&limit=20`, 6],
    [`/observability/admin/debug-bundle?session=${SESSION_ID}`, 15],
    [`/observability/admin/debug-bundle?session=${SESSION_ID}&request=request-123`, 7],
  ])('keeps %s at its deterministic maximum of %i external requests', async (path, expected) => {
    const calls = installFetchMock();

    const response = await adminGet(path);
    const body = await response.json() as { ok?: boolean; error?: string };

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(calls).toHaveLength(expected);
    expect(calls.every((call) => call.init?.redirect === 'manual')).toBe(true);
    if (path.includes('/user-identity')) {
      expect((body as { matches?: unknown[] }).matches).toHaveLength(5);
    }
  });

  it('keeps ready Users page 25 plus trend at exactly 8 requests', async () => {
    const calls = installFetchMock({ populatedUsers: true, usersReady: true });

    const response = await adminGet('/observability/admin/users?limit=25');
    const body = await response.json() as {
      users?: unknown[];
      enrichmentReady?: boolean;
      nextCursor?: string | null;
    };

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(calls).toHaveLength(8);
    expect(calls.length).toBeLessThan(50);
    expect(body.users).toHaveLength(25);
    expect(body.enrichmentReady).toBe(true);
    expect(body.nextCursor).not.toBeNull();
    const batchCalls = calls.filter((call) => call.url.endsWith('/documents:batchGet'));
    expect(batchCalls).toHaveLength(3);
    const trendDocuments = batchCalls
      .map((call) => (JSON.parse(String(call.init?.body)) as { documents: string[] }).documents)
      .find((documents) => documents.some((name) =>
        name.includes('/observability_daily_rollups/')));
    expect(trendDocuments).toHaveLength(32);
    expect(calls.every((call) => call.init?.redirect === 'manual')).toBe(true);
  });

  it('keeps an empty ready Users page bounded without issuing empty join batches', async () => {
    const calls = installFetchMock({ profileCount: 0, usersReady: true });

    const response = await adminGet('/observability/admin/users?limit=25');
    const body = await response.json() as { users?: unknown[]; enrichmentReady?: boolean };

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(calls).toHaveLength(6);
    expect(body.users).toEqual([]);
    expect(body.enrichmentReady).toBe(true);
  });

  it('keeps all missing actor identities known-empty without summary fan-out', async () => {
    const calls = installFetchMock({
      profileCount: 25,
      usersReady: true,
      missingIdentities: true,
    });

    const response = await adminGet('/observability/admin/users?limit=25');
    const body = await response.json() as {
      users?: Array<{ actorSubjectId: string | null; activeDayCount: number | null }>;
    };

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(calls).toHaveLength(7);
    expect(body.users).toHaveLength(25);
    expect(body.users?.every((user) =>
      user.actorSubjectId === null && user.activeDayCount === 0)).toBe(true);
  });

  it('caps migration-incomplete Users at 9 and exactly 42 requests with a cursor', async () => {
    const calls = installFetchMock({ profileCount: 9, usersReady: false });

    const response = await adminGet('/observability/admin/users?limit=25');
    const body = await response.json() as {
      users?: unknown[];
      enrichmentReady?: boolean;
      nextCursor?: string | null;
    };

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(calls).toHaveLength(42);
    expect(calls.length).toBeLessThan(50);
    expect(body.users).toHaveLength(9);
    expect(body.enrichmentReady).toBe(false);
    expect(body.nextCursor).not.toBeNull();
    expect(calls.every((call) => call.init?.redirect === 'manual')).toBe(true);
  });

  it('scans 200 near-maximum entries in exactly 10 batches without repeats or skips', async () => {
    const calls = installFetchMock({ largeDebugEntries: true });

    const response = await adminGet(`/observability/admin/debug-bundle?session=${SESSION_ID}`);
    const body = await response.json() as {
      bundle?: {
        metrics: { totalEntryCount: number; includedEntryCount: number };
        entries: Array<{ detail: { sequence?: number } }>;
        truncationSummary: {
          omittedEntryCount: number;
          byteLimitReached: boolean;
          scanLimitReached: boolean;
        };
      };
    };

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(calls).toHaveLength(15);
    const batchCalls = calls.filter((call) => call.url.endsWith('/documents:batchGet'));
    expect(batchCalls).toHaveLength(10);
    const requestedNames = batchCalls.flatMap((call) =>
      (JSON.parse(String(call.init?.body)) as { documents: string[] }).documents);
    expect(requestedNames).toHaveLength(200);
    expect(new Set(requestedNames).size).toBe(200);
    expect(requestedNames[0]).toContain(`${SESSION_ID}-00000000`);
    expect(requestedNames.at(-1)).toContain(`${SESSION_ID}-00000199`);

    const bundle = body.bundle;
    expect(bundle?.metrics.totalEntryCount).toBe(200);
    expect(bundle?.metrics.includedEntryCount).toBeGreaterThan(0);
    expect(bundle?.metrics.includedEntryCount).toBeLessThan(200);
    expect(bundle?.entries.map((entry) => entry.detail.sequence)).toEqual(
      Array.from({ length: bundle?.entries.length ?? 0 }, (_, sequence) => sequence),
    );
    expect(bundle?.truncationSummary).toMatchObject({
      omittedEntryCount: 200 - (bundle?.entries.length ?? 0),
      byteLimitReached: true,
      scanLimitReached: false,
    });
  });
});
