import { describe, expect, it, vi } from 'vitest';
import { FirestoreServiceAccountClient } from './firestoreServiceAccountClient';

const methods = ['queryDocumentsByNameAfter', 'queryDocumentSnapshotsByNameAfter'] as const;
const name = 'projects/test/databases/(default)/documents/items/item-a';
const env = {
  FIREBASE_PROJECT_ID: 'test',
  FIREBASE_SERVICE_ACCOUNT_EMAIL: 'service@example.test',
  FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused',
};

function fixture(fetcher: typeof fetch, getToken = vi.fn(async () => 'cached-token')) {
  const beforeSubrequest = vi.fn();
  const client = new FirestoreServiceAccountClient(env, { getToken, subrequestObserver: { beforeSubrequest } });
  Object.assign(client, { fetcher });
  return { client, getToken, beforeSubrequest };
}

describe('Firestore name-ordered page transport', () => {
  it.each(methods)('%s preserves cursor, limit and authenticated request bytes', async (method) => {
    const cases = [
      { params: { collection: 'items' }, limit: 100, cursor: null },
      { params: { collection: 'items', limit: 0, cursorDocumentName: null }, limit: 1, cursor: null },
      { params: { collection: 'items', limit: 17.9, cursorDocumentName: name }, limit: 17, cursor: name },
      { params: { collection: 'items', limit: 501, cursorDocumentName: '' }, limit: 500, cursor: null },
    ];
    for (const { params, limit, cursor } of cases) {
      const fetcher = vi.fn<typeof fetch>(async () => Response.json([]));
      const { client, getToken, beforeSubrequest } = fixture(fetcher);
      await expect(client[method](params)).resolves.toEqual([]);
      expect(fetcher).toHaveBeenCalledExactlyOnceWith(
        'https://firestore.googleapis.com/v1/projects/test/databases/(default)/documents:runQuery',
        {
          method: 'POST', redirect: 'manual',
          headers: { Authorization: 'Bearer cached-token', 'Content-Type': 'application/json' },
          body: JSON.stringify({ structuredQuery: {
            from: [{ collectionId: 'items' }],
            orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
            ...(cursor ? { startAt: { values: [{ referenceValue: cursor }], before: false } } : {}),
            limit,
          } }),
        },
      );
      expect(getToken).toHaveBeenCalledTimes(1);
      expect(beforeSubrequest).toHaveBeenCalledExactlyOnceWith('firestore');
      expect(getToken.mock.invocationCallOrder[0]).toBeLessThan(beforeSubrequest.mock.invocationCallOrder[0]);
      expect(beforeSubrequest.mock.invocationCallOrder[0]).toBeLessThan(fetcher.mock.invocationCallOrder[0]);
    }
  });

  it('keeps ordinary rows and versioned snapshots as distinct projections', async () => {
    const version = '2026-11-03T00:00:00.123456Z';
    const fields = { count: { integerValue: '2' }, id: { stringValue: 'stored-id' } };
    const { client } = fixture(async () => Response.json([
      {}, { document: { fields } }, { document: { name, updateTime: version, fields } },
    ]));
    await expect(client.queryDocumentsByNameAfter({ collection: 'items' })).resolves.toEqual([
      { count: 2, id: 'item-a', documentName: name },
    ]);
    await expect(client.queryDocumentSnapshotsByNameAfter({ collection: 'items' })).resolves.toEqual([
      { id: 'item-a', documentName: name, updateTime: version, value: { count: 2, id: 'stored-id' } },
    ]);
  });

  it('requires updateTime only for snapshots without adding timestamp validation', async () => {
    for (const updateTime of [undefined, '', 'present-opaque-version']) {
      const { client } = fixture(async () => Response.json([{ document: { name, updateTime } }]));
      await expect(client.queryDocumentsByNameAfter({ collection: 'items' })).resolves.toEqual([
        { id: 'item-a', documentName: name },
      ]);
      const result = client.queryDocumentSnapshotsByNameAfter({ collection: 'items' });
      if (updateTime) {
        await expect(result).resolves.toEqual([{ id: 'item-a', documentName: name, updateTime, value: {} }]);
      } else {
        await expect(result).rejects.toThrow('Firestore document snapshot metadata was incomplete');
      }
    }
  });

  it.each(methods)('%s propagates token failure before observation or fetch', async (method) => {
    const error = new Error('token unavailable');
    const fetcher = vi.fn<typeof fetch>();
    const { client, beforeSubrequest } = fixture(fetcher, vi.fn(async () => { throw error; }));
    await expect(client[method]({ collection: 'items' })).rejects.toBe(error);
    expect(beforeSubrequest).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(methods)('%s propagates transport and JSON failures without retry', async (method) => {
    const error = new Error('network unavailable');
    const fetcher = vi.fn<typeof fetch>(async () => { throw error; });
    const { client } = fixture(fetcher);
    await expect(client[method]({ collection: 'items' })).rejects.toBe(error);
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValueOnce(new Response('{'));
    await expect(client[method]({ collection: 'items' })).rejects.toBeInstanceOf(SyntaxError);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(methods)('%s discards HTTP error bodies and preserves the query error', async (method) => {
    for (const cancellationFails of [false, true]) {
      const cancel = vi.fn(() => { if (cancellationFails) throw new Error('already closed'); });
      const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ cancel }), { status: 503 }));
      const { client } = fixture(fetcher);
      await expect(client[method]({ collection: 'items' })).rejects.toThrow('Firestore name-ordered query failed: 503');
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
});
