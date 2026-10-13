import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FirestoreImmutableDocumentConflictError,
  FirestoreServiceAccountClient,
} from './firestoreServiceAccountClient';

const env = {
  FIREBASE_PROJECT_ID: 'demo-immutable-conflict',
  FIREBASE_SERVICE_ACCOUNT_EMAIL: 'unused@example.test',
  FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused',
};
const path = 'projects/demo-immutable-conflict/databases/(default)/documents/events/event-1';
function client(fetcher: typeof fetch) {
  vi.stubGlobal('fetch', fetcher);
  return new FirestoreServiceAccountClient(env, { getToken: async () => 'synthetic-inert-token' });
}
afterEach(() => vi.unstubAllGlobals());

describe('immutable conflict evidence', () => {
  it('retains one 409 snapshot privately while preserving the previous Error name and message', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === 'POST'
      ? new Response('{}', { status: 409 })
      : new Response(JSON.stringify({ name: path, fields: {
        content: { stringValue: 'private-payload-sentinel' },
      } }), { status: 200 }));
    const operation = client(fetcher).setImmutableDocument('events', 'event-1', { content: 'replacement' }, 'custom conflict');
    const error = await operation.catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(FirestoreImmutableDocumentConflictError);
    expect(error.name).toBe('Error');
    expect(error.message).toBe('custom conflict: events/event-1');
    expect(error.getExistingDocument()).toEqual({ id: 'event-1', content: 'private-payload-sentinel' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const rendered of [JSON.stringify(error), String(error), inspect(error), String(error.stack), JSON.stringify({ ...error })]) {
      expect(rendered).not.toContain('private-payload-sentinel');
    }
  });

  it('preserves lower-layer exact replay comparison and expiry exclusion', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === 'POST'
      ? new Response('{}', { status: 409 })
      : new Response(JSON.stringify({ name: path, fields: {
        content: { stringValue: 'same' }, expireAt: { timestampValue: '2026-10-15T00:00:00.000Z' },
      } }), { status: 200 }));
    await expect(client(fetcher).setImmutableDocument('events', 'event-1', {
      content: 'same', expireAt: '2026-10-20T00:00:00.000Z',
    })).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('retains a missing collision snapshot as missing rather than success', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Response('{}', {
      status: init?.method === 'POST' ? 409 : 404,
    }));
    const error = await client(fetcher).setImmutableDocument('events', 'event-1', { content: 'new' }).catch(error => error);
    expect(error).toBeInstanceOf(FirestoreImmutableDocumentConflictError);
    expect(error.getExistingDocument()).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([403, 429, 500, 503])('does not classify HTTP %i as a known collision', async status => {
    const fetcher = vi.fn(async () => new Response('{}', { status }));
    const error = await client(fetcher).setImmutableDocument('events', 'event-1', { content: 'new' }).catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(FirestoreImmutableDocumentConflictError);
    expect(error.message).toBe(`Firestore immutable write failed: ${status}`);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not manufacture collision evidence when the 409 read itself fails', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Response('{}', {
      status: init?.method === 'POST' ? 409 : 503,
    }));
    const error = await client(fetcher).setImmutableDocument('events', 'event-1', { content: 'new' }).catch(error => error);
    expect(error).not.toBeInstanceOf(FirestoreImmutableDocumentConflictError);
    expect(error.message).toBe('Firestore get failed: 503');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
