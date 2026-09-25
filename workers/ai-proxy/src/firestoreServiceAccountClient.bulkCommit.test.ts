import { describe, expect, it, vi } from 'vitest';
import { FirestoreServiceAccountClient } from './firestoreServiceAccountClient';

const env = {
  FIREBASE_PROJECT_ID: 'test-project',
  FIREBASE_SERVICE_ACCOUNT_EMAIL: 'service@example.com',
  FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused',
};

function documentName(collection: string, id: string): string {
  return `projects/test-project/databases/(default)/documents/${collection}/${id}`;
}

function clientWithFetcher(fetcher: typeof fetch): FirestoreServiceAccountClient {
  const client = new FirestoreServiceAccountClient(env, {
    getToken: async () => 'cached-token',
  });
  Object.assign(client as unknown as Record<string, unknown>, { fetcher });
  return client;
}

describe('FirestoreServiceAccountClient bulk commits', () => {
  it('commits masked updates and idempotent deletes in one request', async () => {
    let capturedInit: RequestInit | undefined;
    let cancelled = false;
    const client = clientWithFetcher(async (_input, init) => {
      capturedInit = init;
      return new Response(new ReadableStream({
        cancel: () => { cancelled = true; },
      }), { status: 200 });
    });

    await client.commitWrites([
      {
        collection: 'profiles',
        id: 'profile-1',
        value: { registeredAt: '2026-09-25T00:00:00.000Z' },
        updateMask: ['registeredAt'],
      },
      {
        collection: 'observability_events',
        id: 'expired-1',
        delete: true,
      },
    ]);

    expect(capturedInit?.redirect).toBe('manual');
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      writes: [
        {
          update: {
            name: documentName('profiles', 'profile-1'),
            fields: {
              registeredAt: { timestampValue: '2026-09-25T00:00:00.000Z' },
            },
          },
          updateMask: { fieldPaths: ['registeredAt'] },
        },
        { delete: documentName('observability_events', 'expired-1') },
      ],
    });
    expect(cancelled).toBe(true);
  });

  it('supports transactionally deleting accumulator shards with the published snapshot', async () => {
    let capturedBody: unknown;
    const client = clientWithFetcher(async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(null, { status: 200 });
    });

    await client.commitTransaction(
      'transaction-token',
      [{ collection: 'snapshots', id: 'today', value: { today: 2 } }],
      [{ collection: 'snapshot_accumulator', id: 'main:00' }],
    );

    expect(capturedBody).toEqual({
      transaction: 'transaction-token',
      writes: [
        {
          update: {
            name: documentName('snapshots', 'today'),
            fields: { today: { integerValue: '2' } },
          },
        },
        { delete: documentName('snapshot_accumulator', 'main:00') },
      ],
    });
  });

  it('rejects over-500 and oversized commits before fetch', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = clientWithFetcher(fetcher);
    const tooMany = Array.from({ length: 501 }, (_, index) => ({
      collection: 'items',
      id: `item-${index}`,
      delete: true as const,
    }));

    await expect(client.commitWrites(tooMany))
      .rejects.toThrow('Firestore commit write limit exceeded');
    await expect(client.commitWrites([{
      collection: 'items',
      id: 'large',
      value: { payload: 'x'.repeat(10 * 1024 * 1024) },
    }])).rejects.toThrow('Firestore commit request was too large');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
