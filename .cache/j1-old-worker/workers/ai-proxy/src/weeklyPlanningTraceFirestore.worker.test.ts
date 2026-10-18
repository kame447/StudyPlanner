import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeeklyPlanningTraceFirestoreClient } from './weeklyPlanningTraceFirestore';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WeeklyPlanningTraceFirestoreClient in Cloudflare Workers', () => {
  it('calls the global fetch with the correct receiver', async () => {
    const requestedUrls: string[] = [];

    function receiverSensitiveFetch(
      this: unknown,
      input: RequestInfo | URL,
    ): Promise<Response> {
      if (this !== globalThis) {
        throw new TypeError('Illegal invocation');
      }

      const url = String(input);
      requestedUrls.push(url);

      if (url === 'https://oauth2.googleapis.com/token') {
        return Promise.resolve(new Response(JSON.stringify({
          access_token: 'test-access-token',
          expires_in: 3600,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }

      return Promise.resolve(new Response(null, { status: 404 }));
    }

    vi.stubGlobal('fetch', receiverSensitiveFetch);

    const cryptoApi = {
      subtle: {
        importKey: vi.fn(async () => ({} as CryptoKey)),
        sign: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
      },
    } as unknown as Crypto;

    const client = new WeeklyPlanningTraceFirestoreClient(
      {
        FIREBASE_PROJECT_ID: 'test-project',
        FIREBASE_SERVICE_ACCOUNT_EMAIL: 'service@example.com',
        FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: [
          '-----BEGIN PRIVATE KEY-----',
          'AQ==',
          '-----END PRIVATE KEY-----',
        ].join('\n'),
      },
      undefined,
      cryptoApi,
    );

    await expect(client.getDocument('profiles', 'user-1'))
      .resolves.toBeNull();

    expect(requestedUrls).toEqual([
      'https://oauth2.googleapis.com/token',
      'https://firestore.googleapis.com/v1/projects/test-project/databases/(default)/documents/profiles/user-1',
    ]);
  });
});
