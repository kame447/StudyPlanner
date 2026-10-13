import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listObservabilityDatesInclusive } from '../../../shared/productObservabilityDateRange';
import { FirestoreServiceAccountClient } from './firestoreServiceAccountClient';
import { createEmptyDailyRollup } from './productObservabilityReadModelProjection';
import { ProductObservabilityReadModelService } from './productObservabilityReadModelService';

const env = {
  FIREBASE_PROJECT_ID: 'snapshot-test',
  FIREBASE_SERVICE_ACCOUNT_EMAIL: 'unused@example.test',
  FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused',
};
const documentRoot = 'projects/snapshot-test/databases/(default)/documents/';
const now = '2026-10-13T08:00:00.000Z';

function encodeValue(input: unknown): Record<string, unknown> {
  if (input === null) return { nullValue: null };
  if (typeof input === 'boolean') return { booleanValue: input };
  if (typeof input === 'number') return { integerValue: String(input) };
  if (typeof input === 'string') return { stringValue: input };
  if (Array.isArray(input)) return { arrayValue: { values: input.map(encodeValue) } };
  return { mapValue: { fields: encodeFields(input as Record<string, unknown>) } };
}

function encodeFields(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, encodeValue(value)]));
}

function fixture(days: number) {
  const toDate = new Date(Date.UTC(2026, 5, 25 + days - 1)).toISOString().slice(0, 10);
  const params = { environment: 'production' as const, fromDate: '2026-06-25', toDate };
  const dates = listObservabilityDatesInclusive(params.fromDate, toDate, 93);
  const daily = dates.map((localDate) => createEmptyDailyRollup({
    environment: 'production', localDate, nowIso: now,
  }));
  const activeUsers = {
    schemaVersion: 1, environment: 'production', asOfDate: toDate,
    reportingTimeZone: 'Asia/Tokyo', today: 2, last7Days: 3, last30Days: 4,
    updatedAt: now, expireAt: '2027-01-01T00:00:00.000Z',
  };
  const checkpoint = {
    schemaVersion: 1, cursor: null, processedEventCount: 0, activeUserDirtySources: [],
    lastRunStartedAt: null, lastSuccessfulRunAt: null,
    lastFailureAt: null, lastFailureCategory: null, updatedAt: now,
  };
  const documents = new Map<string, Record<string, unknown>>();
  daily.forEach((rollup) => documents.set(
    `observability_daily_rollups/production:${rollup.localDate}`, { ...rollup },
  ));
  const activeKey = `observability_active_user_windows/production:${toDate}`;
  documents.set(activeKey, activeUsers);
  documents.set('observability_rollup_state/main', checkpoint);
  return { params, dates, daily, activeUsers, activeKey, checkpoint, documents };
}

function installTransport(
  documents: Map<string, Record<string, unknown>>,
  options: { indexed?: number; incompleteBatch?: boolean; batchStatus?: number } = {},
) {
  const batches: string[][] = [];
  const countQueries: Array<Record<string, unknown>> = [];
  // All requests terminate here. Unexpected reads/writes fail instead of reaching a network.
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('manual');
    const body = JSON.parse(String(init?.body));
    const base = `https://firestore.googleapis.com/v1/${documentRoot.slice(0, -1)}`;
    if (url === `${base}:batchGet`) {
      const names = body.documents as string[];
      batches.push(names);
      if (options.batchStatus) return new Response('synthetic failure', { status: options.batchStatus });
      const results = names.map((name) => {
        expect(name.startsWith(documentRoot)).toBe(true);
        const data = documents.get(name.slice(documentRoot.length));
        return data ? { found: { name, fields: encodeFields(data) } } : { missing: name };
      }).reverse();
      return Response.json(options.incompleteBatch ? results.slice(1) : results);
    }
    if (url === `${base}:runAggregationQuery`) {
      const query = body.structuredAggregationQuery;
      expect(query.structuredQuery.from).toEqual([{ collectionId: 'profiles' }]);
      expect(query.aggregations).toEqual([{ alias: 'count', count: {} }]);
      countQueries.push(query.structuredQuery);
      const where = query.structuredQuery.where;
      const count = !where ? 5 : where.compositeFilter ? 2 : options.indexed ?? 5;
      return Response.json([{ result: { aggregateFields: { count: { integerValue: String(count) } } } }]);
    }
    throw new Error(`Unexpected snapshot request: ${url}`);
  });
  vi.stubGlobal('fetch', fetcher);
  const firestore = new FirestoreServiceAccountClient(env, { getToken: async () => 'synthetic-token' });
  return { service: new ProductObservabilityReadModelService(env, firestore), fetcher, batches, countQueries };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(now));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe.each(['getOverview', 'getUserTrend'] as const)('%s REST snapshot', (method) => {
  it.each([7, 30, 93])('loads %i days and window/checkpoint in one request despite reversed results', async (days) => {
    const data = fixture(days);
    const { service, fetcher, batches, countQueries } = installTransport(data.documents);
    const result = await service[method](data.params);

    expect(result.daily).toEqual(data.daily);
    expect(result.activeUsers).toEqual(data.activeUsers);
    expect(batches).toEqual([[
      ...data.dates.map((date) => `${documentRoot}observability_daily_rollups/production:${date}`),
      `${documentRoot}${data.activeKey}`, `${documentRoot}observability_rollup_state/main`,
    ]]);
    expect(fetcher).toHaveBeenCalledTimes(method === 'getOverview' ? 4 : 1);
    expect(countQueries).toHaveLength(method === 'getOverview' ? 3 : 0);
    if (method === 'getOverview') {
      expect(result).toMatchObject({
        rollupCheckpoint: data.checkpoint,
        registeredUsers: { total: 5, newInPeriod: 2, registrationIndexReady: true, scope: 'firebase_project' },
      });
    } else {
      expect(Object.keys(result).sort()).toEqual(['activeUsers', 'daily']);
    }
  });

  it.each(['daily', 'window', 'checkpoint', 'all'] as const)('preserves missing %s semantics', async (missing) => {
    const data = fixture(7);
    if (missing === 'daily') data.documents.delete(`observability_daily_rollups/production:${data.dates[1]}`);
    if (missing === 'window') data.documents.delete(data.activeKey);
    if (missing === 'checkpoint') data.documents.delete('observability_rollup_state/main');
    if (missing === 'all') data.documents.clear();
    const { service } = installTransport(data.documents);
    const result = await service[method](data.params);

    expect(result.daily).toEqual(missing === 'all' ? [] : data.daily.filter((_, i) => missing !== 'daily' || i !== 1));
    expect(result.activeUsers).toEqual(missing === 'all' || missing === 'window' ? null : data.activeUsers);
    if (method === 'getOverview' && (missing === 'checkpoint' || missing === 'all')) {
      expect(result).toHaveProperty('rollupCheckpoint', data.checkpoint);
    }
  });

  it.each([
    ['production', '2026-07-01', true],
    ['preview', '2026-07-01', false],
    ['production', '2026-01-01', false],
  ] as const)('respects dirty source %s/%s', async (environment, localDate, dirty) => {
    const data = fixture(7);
    data.documents.set('observability_rollup_state/main', {
      ...data.checkpoint, activeUserDirtySources: [{ environment, localDate, revision: 1 }],
    });
    const { service } = installTransport(data.documents);
    expect((await service[method](data.params)).activeUsers).toEqual(dirty ? null : data.activeUsers);
  });

  it('fails closed for incomplete batch responses', async () => {
    const data = fixture(7);
    const { service } = installTransport(data.documents, { incompleteBatch: true });
    await expect(service[method](data.params)).rejects.toThrow('Firestore batch get response was incomplete');
  });

  it.each([403, 404, 503])('rejects a batch HTTP %i rather than treating it as missing documents', async (batchStatus) => {
    const data = fixture(7);
    const { service } = installTransport(data.documents, { batchStatus });
    await expect(service[method](data.params)).rejects.toThrow(`Firestore batch get failed: ${batchStatus}`);
  });
});

it('keeps incomplete registration unknown and omits the period COUNT', async () => {
  const data = fixture(30);
  const { service, fetcher, countQueries } = installTransport(data.documents, { indexed: 4 });
  expect((await service.getOverview(data.params)).registeredUsers).toEqual({
    total: 5, newInPeriod: null, registrationIndexReady: false, scope: 'firebase_project',
  });
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(countQueries).toHaveLength(2);
});
