import { describe, expect, it, vi } from 'vitest';
import { FirestoreServiceAccountClient } from './firestoreServiceAccountClient';

function clientWithFetcher(fetcher: typeof fetch): FirestoreServiceAccountClient {
  const client = new FirestoreServiceAccountClient(
    {
      FIREBASE_PROJECT_ID: 'test-project',
      FIREBASE_SERVICE_ACCOUNT_EMAIL: 'service@example.com',
      FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused',
    },
    fetcher,
  );
  Object.assign(client as unknown as Record<string, unknown>, {
    accessToken: 'cached-token',
    accessTokenExpiresAt: Date.now() + 3_600_000,
  });
  return client;
}

describe('FirestoreServiceAccountClient countDocuments', () => {
  it('sends a COUNT aggregation with bounded string range filters', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify([{
        result: {
          aggregateFields: {
            count: { integerValue: '17' },
          },
        },
      }]), { status: 200 }));
    const client = clientWithFetcher(fetcher as typeof fetch);

    const count = await client.countDocuments('profiles', [
      {
        field: 'registeredAtIso',
        operator: 'GREATER_THAN_OR_EQUAL',
        value: '2026-08-01T15:00:00.000Z',
      },
      {
        field: 'registeredAtIso',
        operator: 'LESS_THAN',
        value: '2026-08-29T15:00:00.000Z',
      },
    ]);

    expect(count).toBe(17);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(
      'https://firestore.googleapis.com/v1/projects/test-project/databases/(default)/documents:runAggregationQuery',
    );
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer cached-token');
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      structuredAggregationQuery: {
        structuredQuery: {
          from: [{ collectionId: 'profiles' }],
          where: {
            compositeFilter: {
              op: 'AND',
              filters: [
                {
                  fieldFilter: {
                    field: { fieldPath: 'registeredAtIso' },
                    op: 'GREATER_THAN_OR_EQUAL',
                    value: { stringValue: '2026-08-01T15:00:00.000Z' },
                  },
                },
                {
                  fieldFilter: {
                    field: { fieldPath: 'registeredAtIso' },
                    op: 'LESS_THAN',
                    value: { stringValue: '2026-08-29T15:00:00.000Z' },
                  },
                },
              ],
            },
          },
        },
        aggregations: [{ alias: 'count', count: {} }],
      },
    });
  });

  it('rejects missing or invalid aggregate count values', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([{
      result: { aggregateFields: {} },
    }]), { status: 200 }));
    const client = clientWithFetcher(fetcher as typeof fetch);

    await expect(client.countDocuments('profiles')).rejects.toThrow(
      'Firestore aggregation count was invalid',
    );
  });
});
