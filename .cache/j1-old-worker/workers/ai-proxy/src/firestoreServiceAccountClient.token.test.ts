import { afterEach, describe, expect, it, vi } from 'vitest';
import { FirestoreServiceAccountTokenProvider } from './firestoreServiceAccountClient';

const env = {
  FIREBASE_PROJECT_ID: 'test-project',
  FIREBASE_SERVICE_ACCOUNT_EMAIL: 'service@example.com',
  FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'AQ==',
};

function cryptoApi(): Crypto {
  return {
    subtle: {
      importKey: vi.fn(async () => ({}) as CryptoKey),
      sign: vi.fn(async () => new ArrayBuffer(0)),
    },
  } as unknown as Crypto;
}

function tokenResponse(token: string, expiresIn = 3600): Response {
  return new Response(JSON.stringify({ access_token: token, expires_in: expiresIn }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('FirestoreServiceAccountTokenProvider', () => {
  it('shares one OAuth exchange across parallel calls', async () => {
    let exchangeCount = 0;
    const provider = new FirestoreServiceAccountTokenProvider(
      env,
      async () => {
        exchangeCount += 1;
        await Promise.resolve();
        return tokenResponse('shared-token');
      },
      cryptoApi(),
    );

    const tokens = await Promise.all(
      Array.from({ length: 12 }, () => provider.getToken()),
    );

    expect(tokens).toEqual(Array(12).fill('shared-token'));
    expect(exchangeCount).toBe(1);
  });

  it('refreshes at the early-refresh boundary and reuses the token before it', async () => {
    vi.useFakeTimers();
    const start = new Date('2026-09-25T08:00:00.000Z');
    vi.setSystemTime(start);
    let exchangeCount = 0;
    const provider = new FirestoreServiceAccountTokenProvider(
      env,
      async () => {
        exchangeCount += 1;
        return tokenResponse(`token-${exchangeCount}`, 120);
      },
      cryptoApi(),
    );

    await expect(provider.getToken()).resolves.toBe('token-1');
    vi.setSystemTime(new Date(start.getTime() + 59_999));
    await expect(provider.getToken()).resolves.toBe('token-1');
    vi.setSystemTime(new Date(start.getTime() + 60_000));
    await expect(provider.getToken()).resolves.toBe('token-2');
    expect(exchangeCount).toBe(2);
  });

  it('clears a failed exchange so the next call can retry', async () => {
    let exchangeCount = 0;
    let fail = true;
    const provider = new FirestoreServiceAccountTokenProvider(
      env,
      async () => {
        exchangeCount += 1;
        if (fail) return new Response('failed', { status: 500 });
        return tokenResponse('recovered-token');
      },
      cryptoApi(),
    );

    await expect(provider.getToken()).rejects.toThrow('token exchange failed');
    fail = false;
    await expect(provider.getToken()).resolves.toBe('recovered-token');
    expect(exchangeCount).toBe(2);
  });

  it('does not share tokens between separately created providers', async () => {
    let exchangeCount = 0;
    const fetcher: typeof fetch = async () => {
      exchangeCount += 1;
      return tokenResponse(`token-${exchangeCount}`);
    };
    const first = new FirestoreServiceAccountTokenProvider(env, fetcher, cryptoApi());
    const second = new FirestoreServiceAccountTokenProvider(env, fetcher, cryptoApi());

    await expect(Promise.all([first.getToken(), second.getToken()])).resolves.toEqual([
      'token-1',
      'token-2',
    ]);
    expect(exchangeCount).toBe(2);
  });
});
