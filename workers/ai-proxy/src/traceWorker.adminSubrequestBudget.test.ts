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
  if (typeof input === 'boolean') return { booleanValue: input };
  if (typeof input === 'number') return { integerValue: String(input) };
  return { stringValue: String(input) };
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
        const count = options.populatedUsers ? 25 : 5;
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

  it('returns the existing generic 503 before sending a 46th external request', async () => {
    const calls = installFetchMock({ populatedUsers: true });

    const response = await adminGet('/observability/admin/users?limit=25');
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(calls).toHaveLength(45);
    expect(body).toEqual({ error: 'Observability read model is temporarily unavailable.' });
    expect(JSON.stringify(body)).not.toMatch(/45|subrequest|budget/i);
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
