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

describe('FirestoreServiceAccountClient batch get support', () => {
  it('restores input order when Firestore returns unordered found and missing entries', async () => {
    let capturedInit: RequestInit | undefined;
    const fetcher: typeof fetch = async (_input, init) => {
      capturedInit = init;
      return new Response(JSON.stringify([
        {
          found: {
            name: documentName('daily', '2026-09-03'),
            fields: { date: { stringValue: '2026-09-03' }, value: { integerValue: '3' } },
          },
        },
        { missing: documentName('daily', '2026-09-02') },
        {
          found: {
            name: documentName('daily', '2026-09-01'),
            fields: { date: { stringValue: '2026-09-01' }, value: { integerValue: '1' } },
          },
        },
      ]), { status: 200 });
    };
    const client = clientWithFetcher(fetcher);

    const documents = await client.batchGetDocuments(
      'daily',
      ['2026-09-01', '2026-09-02', '2026-09-03'],
      'transaction-token',
    );

    expect(documents).toEqual([
      { id: '2026-09-01', date: '2026-09-01', value: 1 },
      null,
      { id: '2026-09-03', date: '2026-09-03', value: 3 },
    ]);
    expect(capturedInit?.redirect).toBe('manual');
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      documents: [
        documentName('daily', '2026-09-01'),
        documentName('daily', '2026-09-02'),
        documentName('daily', '2026-09-03'),
      ],
      transaction: 'transaction-token',
    });
  });

  it('chunks requests at 100 documents without changing the result order', async () => {
    const requestSizes: number[] = [];
    const fetcher: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { documents: string[] };
      requestSizes.push(body.documents.length);
      return new Response(JSON.stringify(body.documents.map((name) => ({
        found: { name, fields: { marker: { stringValue: name.split('/').pop() } } },
      }))), { status: 200 });
    };
    const ids = Array.from({ length: 101 }, (_, index) => `id-${index}`);

    const documents = await clientWithFetcher(fetcher).batchGetDocuments('items', ids);

    expect(requestSizes).toEqual([100, 1]);
    expect(documents.map((document) => document?.id)).toEqual(ids);
    expect(documents.map((document) => document?.marker)).toEqual(ids);
  });

  it('reads mixed collections in one transactional batch while preserving key order', async () => {
    let capturedBody: unknown;
    const client = clientWithFetcher(async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify([
        { missing: documentName('daily', 'day-1') },
        {
          found: {
            name: documentName('state', 'main'),
            fields: { revision: { integerValue: '2' } },
          },
        },
      ]), { status: 200 });
    });

    const documents = await client.batchGetDocumentKeys([
      { collection: 'state', id: 'main' },
      { collection: 'daily', id: 'day-1' },
    ], 'transaction-token');

    expect(documents).toEqual([
      { id: 'main', revision: 2 },
      null,
    ]);
    expect(capturedBody).toEqual({
      documents: [
        documentName('state', 'main'),
        documentName('daily', 'day-1'),
      ],
      transaction: 'transaction-token',
    });
  });

  it('rejects a response that omits a requested document outcome', async () => {
    const client = clientWithFetcher(async () => new Response(JSON.stringify([
      { missing: documentName('items', 'one') },
    ]), { status: 200 }));

    await expect(client.batchGetDocuments('items', ['one', 'two']))
      .rejects.toThrow('Firestore batch get response was incomplete');
  });

  it('rejects an oversized request before sending it', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = clientWithFetcher(fetcher);

    await expect(client.batchGetDocuments('items', ['x'.repeat(10 * 1024 * 1024)]))
      .rejects.toThrow('Firestore batch get request was too large');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('cancels unread 404, non-success, delete, and successful write response bodies', async () => {
    const cancelled: string[] = [];
    const responseWithTrackedBody = (label: string, status: number) => new Response(
      new ReadableStream({
        cancel: () => { cancelled.push(label); },
      }),
      { status },
    );
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(responseWithTrackedBody('get-404', 404))
      .mockResolvedValueOnce(responseWithTrackedBody('batch-500', 500))
      .mockResolvedValueOnce(responseWithTrackedBody('transaction-get-404', 404))
      .mockResolvedValueOnce(responseWithTrackedBody('delete-404', 404))
      .mockResolvedValueOnce(responseWithTrackedBody('write-200', 200));
    const client = clientWithFetcher(fetcher);

    await expect(client.getDocument('items', 'missing')).resolves.toBeNull();
    await expect(client.batchGetDocuments('items', ['one']))
      .rejects.toThrow('Firestore batch get failed: 500');
    await expect(client.getDocumentInTransaction('items', 'missing', 'transaction'))
      .resolves.toBeNull();
    await expect(client.deleteDocument('items', 'missing')).resolves.toBeUndefined();
    await expect(client.setDocument('items', 'one', { value: 1 })).resolves.toBeUndefined();
    expect(cancelled).toEqual([
      'get-404',
      'batch-500',
      'transaction-get-404',
      'delete-404',
      'write-200',
    ]);
  });
});
