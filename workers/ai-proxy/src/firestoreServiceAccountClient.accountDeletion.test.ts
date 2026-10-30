import { afterEach, describe, expect, it, vi } from 'vitest';
import { FirestoreServiceAccountClient } from './firestoreServiceAccountClient';

const env = { FIREBASE_PROJECT_ID: 'test', FIREBASE_SERVICE_ACCOUNT_EMAIL: 'test@example.test', FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused' };
const client = () => new FirestoreServiceAccountClient(env, { getToken: async () => 'owner' });
afterEach(() => vi.unstubAllGlobals());

describe('Firestore account deletion primitives', () => {
  it('lists a subcollection including missing parents, with segment-wise path encoding', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ documents: [
      { name: 'projects/test/databases/(default)/documents/class_attendance/owner/classes/template' },
    ] })));
    vi.stubGlobal('fetch', fetcher);
    expect(await client().listCollectionDocuments('class_attendance/owner/classes', 1)).toEqual([{ id: 'template' }]);
    const [input, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const url = new URL(input);
    expect(url.pathname).toBe('/v1/projects/test/databases/(default)/documents/class_attendance/owner/classes');
    expect(url.searchParams.get('showMissing')).toBe('true');
    expect(url.searchParams.get('pageSize')).toBe('1');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer owner');
    expect(init.redirect).toBe('manual');
  });

  it('preserves string expiration boundaries and update times for guarded retention deletes', async () => {
    const expiry = '2026-10-30T00:00:00.000Z';
    const fetcher = vi.fn(async () => new Response(JSON.stringify([{ document: {
      name: 'projects/test/databases/(default)/documents/account_deletions/owner',
      updateTime: expiry, fields: { expiresAt: { stringValue: expiry } },
    } }])));
    vi.stubGlobal('fetch', fetcher);
    const rows = await client().queryDocumentsAfter({ collection: 'account_deletions', orderByField: 'expiresAt', endAtString: expiry });
    expect(rows[0]).toMatchObject({ id: 'owner', expiresAt: expiry, updateTime: expiry });
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).structuredQuery.endAt).toEqual({ values: [{ stringValue: expiry }], before: false });
  });
});
