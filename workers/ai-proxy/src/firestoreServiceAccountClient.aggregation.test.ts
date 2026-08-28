import { describe, expect, it } from 'vitest';
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

describe('FirestoreServiceAccountClient aggregation support', () => {
  it('sends a COUNT aggregation with timestamp range filters', async () => {
    let capturedInput: Parameters<typeof fetch>[0] | null = null;
    let capturedInit: Parameters<typeof fetch>[1] | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      capturedInput = input;
      capturedInit = init;
      return new Response(JSON.stringify([{
        result: {
          aggregateFields: {
            count: { integerValue: '17' },
          },
        },
      }]), { status: 200 });
    };
    const client = clientWithFetcher(fetcher);

    const count = await client.countDocuments('profiles', [
      {
        field: 'registeredAt',
        operator: 'GREATER_THAN_OR_EQUAL',
        value: '2026-08-01T15:00:00.000Z',
        valueType: 'timestamp',
      },
      {
        field: 'registeredAt',
        operator: 'LESS_THAN',
        value: '2026-08-29T15:00:00.000Z',
        valueType: 'timestamp',
      },
    ]);

    expect(count).toBe(17);
    expect(String(capturedInput)).toBe(
      'https://firestore.googleapis.com/v1/projects/test-project/databases/(default)/documents:runAggregationQuery',
    );
    expect(capturedInit?.method).toBe('POST');
    expect(new Headers(capturedInit?.headers).get('Authorization')).toBe('Bearer cached-token');
    const body = JSON.parse(String(capturedInit?.body));
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
                    field: { fieldPath: 'registeredAt' },
                    op: 'GREATER_THAN_OR_EQUAL',
                    value: { timestampValue: '2026-08-01T15:00:00.000Z' },
                  },
                },
                {
                  fieldFilter: {
                    field: { fieldPath: 'registeredAt' },
                    op: 'LESS_THAN',
                    value: { timestampValue: '2026-08-29T15:00:00.000Z' },
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

  it('encodes server-maintained registration timestamps as Firestore timestamps', async () => {
    let capturedInit: Parameters<typeof fetch>[1] | undefined;
    const fetcher: typeof fetch = async (_input, init) => {
      capturedInit = init;
      return new Response('{}', { status: 200 });
    };
    const client = clientWithFetcher(fetcher);

    await client.setDocument(
      'profiles',
      'user-1',
      { registeredAt: '2026-08-28T12:00:00.000Z' },
      ['registeredAt'],
    );

    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      fields: {
        registeredAt: { timestampValue: '2026-08-28T12:00:00.000Z' },
      },
    });
  });

  it('rejects missing or invalid aggregate count values', async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify([{
      result: { aggregateFields: {} },
    }]), { status: 200 });
    const client = clientWithFetcher(fetcher);

    await expect(client.countDocuments('profiles')).rejects.toThrow(
      'Firestore aggregation count was invalid',
    );
  });
});
