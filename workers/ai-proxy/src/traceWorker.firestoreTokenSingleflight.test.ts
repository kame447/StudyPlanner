import { afterEach, describe, expect, it, vi } from 'vitest';
import traceWorker from './traceWorker';

const env = {
  FIREBASE_PROJECT_ID: 'test-project',
  FIREBASE_SERVICE_ACCOUNT_EMAIL: 'service@example.com',
  FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'AQ==',
  FIREBASE_WEB_API_KEY: 'web-api-key',
  OBSERVABILITY_IDENTITY_SECRET: '0123456789abcdef0123456789abcdef',
  ENVIRONMENT: 'test',
};

function installCryptoMock(): void {
  vi.stubGlobal('crypto', {
    subtle: {
      importKey: async () => ({}) as CryptoKey,
      sign: async () => new ArrayBuffer(0),
    },
  } as unknown as Crypto);
}

function installFetchMock(): string[] {
  installCryptoMock();
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
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
      return new Response(JSON.stringify({
        name: 'projects/test-project/databases/(default)/documents/admins/admin-uid',
        fields: { enabled: { booleanValue: true } },
      }), { status: 200 });
    }
    if (url.endsWith('/documents:batchGet')) {
      const body = JSON.parse(String(init?.body)) as { documents: string[] };
      return new Response(JSON.stringify(body.documents.map((name) => ({ missing: name }))), {
        status: 200,
      });
    }
    if (url.includes(':runAggregationQuery')) {
      return new Response(JSON.stringify([{
        result: { aggregateFields: { count: { integerValue: '0' } } },
      }]), { status: 200 });
    }
    return new Response(null, { status: 404 });
  });
  return calls;
}

async function fetchOverview(from: string, to: string): Promise<string[]> {
  const calls = installFetchMock();
  const response = await traceWorker.fetch(
    new Request(`https://worker.example/observability/admin/overview?from=${from}&to=${to}`, {
      headers: { Authorization: 'Bearer firebase-id-token' },
    }),
    env,
  );
  expect(response.status).toBe(200);
  await response.text();
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('traceWorker Firestore token sharing', () => {
  it('keeps 30-day admin overview below the Workers subrequest limit', async () => {
    const calls = await fetchOverview('2026-08-01', '2026-08-30');

    expect(calls).toHaveLength(9);
    expect(calls.filter((url) => url === 'https://oauth2.googleapis.com/token')).toHaveLength(1);
    expect(calls.filter((url) => url.includes('identitytoolkit.googleapis.com'))).toHaveLength(1);
  });

  it('keeps the 7-day admin overview at its expected request count', async () => {
    const calls = await fetchOverview('2026-08-24', '2026-08-30');

    expect(calls).toHaveLength(9);
    expect(calls.filter((url) => url === 'https://oauth2.googleapis.com/token')).toHaveLength(1);
  });
});
