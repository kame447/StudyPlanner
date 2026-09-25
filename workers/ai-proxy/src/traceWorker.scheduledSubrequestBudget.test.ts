import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SCHEDULED_INVOCATIONS_PER_DAY,
  scheduledObservabilityPhase,
} from './traceWorker';
import traceWorker from './traceWorker';

const env = {
  FIREBASE_PROJECT_ID: 'test-project',
  FIREBASE_SERVICE_ACCOUNT_EMAIL: 'service@example.com',
  FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'AQ==',
  ENVIRONMENT: 'production',
};

interface FetchCall {
  url: string;
  init?: RequestInit;
}

type Scenario = 'rollup' | 'snapshot' | 'backfill' | 'retention';

interface ScenarioState {
  calls: FetchCall[];
  rollupSuccessfulBatches: number;
  rollupConflictsRemaining: number;
  snapshotDirty: boolean;
  snapshotCurrentExists: boolean;
  snapshotMaxPages: boolean;
  snapshotConflictNextCommit: boolean;
  snapshotFullDates: Set<string>;
  backfillProcessed: number;
  backfillTotal: number;
  backfillCompleted: boolean;
  userEnrichmentTotal: number;
  userEnrichmentProcessed: number;
  userEnrichmentEnvironmentIndex: number;
  userEnrichmentCheckpointExists: boolean;
  userEnrichmentLastPageCount: number;
  retentionMax: boolean;
  retentionDeleted: number;
}

function firestoreValue(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return { integerValue: String(value) };
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(firestoreValue) } };
  }
  return {
    mapValue: {
      fields: Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .map(([key, item]) => [key, firestoreValue(item)]),
      ),
    },
  };
}

function firestoreDocument(
  collection: string,
  id: string,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return {
    name: `projects/test-project/databases/(default)/documents/${collection}/${id}`,
    updateTime: '2026-09-25T00:00:00.000000Z',
    fields: Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, firestoreValue(value)]),
    ),
  };
}

function rollupCheckpoint(successfulBatches: number, dirty = false): Record<string, unknown> {
  const processed = successfulBatches * 20;
  const lastIndex = processed - 1;
  return {
    schemaVersion: 1,
    cursor: lastIndex >= 0
      ? {
          observedAt: eventTime(lastIndex),
          documentName:
            `projects/test-project/databases/(default)/documents/observability_events/event-${String(lastIndex).padStart(4, '0')}`,
        }
      : null,
    processedEventCount: processed,
    activeUserDirtySources: dirty
      ? [{ environment: 'production', localDate: '2026-09-25', revision: 1 }]
      : [],
    lastRunStartedAt: null,
    lastSuccessfulRunAt: null,
    lastFailureAt: null,
    lastFailureCategory: null,
    updatedAt: '2026-09-25T00:00:00.000Z',
  };
}

function eventTime(index: number): string {
  return new Date(Date.UTC(2020, 0, 1, 0, index)).toISOString();
}

function planningEvent(index: number): Record<string, unknown> {
  return {
    schemaVersion: 1,
    eventId: `planning-${index}`,
    eventType: 'planning_outcome',
    occurredAt: eventTime(index),
    observedAt: eventTime(index),
    actorSubjectId: `actor-${String(index).padStart(8, '0')}`,
    environment: 'production',
    appVersion: '1.0.0',
    source: 'weekly_planning',
    correlation: { featureSessionId: `session-${index}`, requestId: `request-${index}` },
    payload: {
      outcomeType: 'session_started',
      turnIndex: 1,
      stateRevision: null,
      previewCount: null,
      unscheduledCount: null,
      fallbackUsed: null,
      repairUsed: null,
      staleObserved: null,
      approvalFailureObserved: null,
      schedulerVersion: null,
      promptVersion: null,
      model: null,
    },
    expireAt: '2027-01-01T00:00:00.000Z',
  };
}

function collectionFromQuery(init?: RequestInit): string {
  const body = JSON.parse(String(init?.body ?? '{}')) as {
    structuredQuery?: { from?: Array<{ collectionId?: string }> };
  };
  return body.structuredQuery?.from?.[0]?.collectionId ?? '';
}

function localDateFromQuery(init?: RequestInit): string {
  const body = JSON.parse(String(init?.body ?? '{}')) as {
    structuredQuery?: {
      where?: {
        fieldFilter?: { field?: { fieldPath?: string }; value?: { stringValue?: string } };
      };
    };
  };
  return body.structuredQuery?.where?.fieldFilter?.value?.stringValue ?? '';
}

function queryHasCursor(init?: RequestInit): boolean {
  const body = JSON.parse(String(init?.body ?? '{}')) as {
    structuredQuery?: { startAt?: unknown };
  };
  return Boolean(body.structuredQuery?.startAt);
}

function installScenario(
  scenario: Scenario,
  overrides: Partial<Omit<ScenarioState, 'calls' | 'snapshotFullDates'>> = {},
): ScenarioState {
  vi.stubGlobal('crypto', {
    subtle: {
      importKey: async () => ({}) as CryptoKey,
      sign: async () => new ArrayBuffer(32),
    },
  } as unknown as Crypto);
  const state: ScenarioState = {
    calls: [],
    rollupSuccessfulBatches: 0,
    rollupConflictsRemaining: 0,
    snapshotDirty: true,
    snapshotCurrentExists: false,
    snapshotMaxPages: false,
    snapshotConflictNextCommit: false,
    snapshotFullDates: new Set(),
    backfillProcessed: 0,
    backfillTotal: 0,
    backfillCompleted: false,
    userEnrichmentTotal: 0,
    userEnrichmentProcessed: 0,
    userEnrichmentEnvironmentIndex: 0,
    userEnrichmentCheckpointExists: false,
    userEnrichmentLastPageCount: 0,
    retentionMax: false,
    retentionDeleted: 0,
    ...overrides,
  };

  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    state.calls.push({ url, init });
    if (url === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ access_token: 'scheduled-token', expires_in: 3600 }), {
        status: 200,
      });
    }

    if (url.includes(':beginTransaction')) {
      return new Response(JSON.stringify({
        transaction: `tx-${state.calls.length}`,
      }), { status: 200 });
    }
    if (url.includes(':rollback')) return new Response(null, { status: 200 });

    if (scenario === 'rollup') {
      if (url.endsWith('/documents/observability_rollup_state/main')) {
        return new Response(JSON.stringify(firestoreDocument(
          'observability_rollup_state',
          'main',
          rollupCheckpoint(state.rollupSuccessfulBatches),
        )), { status: 200 });
      }
      if (url.includes(':runQuery')) {
        const start = state.rollupSuccessfulBatches * 20;
        return new Response(JSON.stringify(Array.from({ length: 20 }, (_, offset) => {
          const index = start + offset;
          return {
            document: firestoreDocument(
              'observability_events',
              `event-${String(index).padStart(4, '0')}`,
              planningEvent(index),
            ),
          };
        })), { status: 200 });
      }
      if (url.endsWith('/documents:batchGet')) {
        const body = JSON.parse(String(init?.body)) as { documents: string[] };
        return new Response(JSON.stringify(body.documents.map((name) =>
          name.endsWith('/observability_rollup_state/main')
            ? {
                found: firestoreDocument(
                  'observability_rollup_state',
                  'main',
                  rollupCheckpoint(state.rollupSuccessfulBatches),
                ),
              }
            : { missing: name })), { status: 200 });
      }
      if (url.endsWith('/documents:commit')) {
        if (
          state.rollupSuccessfulBatches === 4
          && state.rollupConflictsRemaining > 0
        ) {
          state.rollupConflictsRemaining -= 1;
          return new Response(null, { status: 409 });
        }
        state.rollupSuccessfulBatches += 1;
        return new Response(null, { status: 200 });
      }
    }

    if (scenario === 'snapshot') {
      if (url.endsWith('/documents/observability_rollup_state/main')) {
        return new Response(JSON.stringify(firestoreDocument(
          'observability_rollup_state',
          'main',
          rollupCheckpoint(0, state.snapshotDirty),
        )), { status: 200 });
      }
      if (url.endsWith('/documents:batchGet')) {
        const body = JSON.parse(String(init?.body)) as { documents: string[] };
        return new Response(JSON.stringify(body.documents.map((name) => {
          if (name.endsWith('/observability_rollup_state/main')) {
            return {
              found: firestoreDocument(
                'observability_rollup_state',
                'main',
                rollupCheckpoint(0, state.snapshotDirty),
              ),
            };
          }
          if (
            state.snapshotCurrentExists
            && name.endsWith('/observability_active_user_windows/production%3A2026-09-25')
          ) {
            return { found: firestoreDocument(
              'observability_active_user_windows',
              'production:2026-09-25',
              { schemaVersion: 1, environment: 'production', asOfDate: '2026-09-25' },
            ) };
          }
          if (
            state.snapshotCurrentExists
            && name.endsWith('/observability_active_user_windows/production:2026-09-25')
          ) {
            return { found: firestoreDocument(
              'observability_active_user_windows',
              'production:2026-09-25',
              { schemaVersion: 1, environment: 'production', asOfDate: '2026-09-25' },
            ) };
          }
          return { missing: name };
        })), { status: 200 });
      }
      if (url.includes(':runQuery')) {
        const localDate = localDateFromQuery(init);
        const cursor = queryHasCursor(init);
        const isFullDate = state.snapshotFullDates.has(localDate);
        if (
          state.snapshotMaxPages
          && !cursor
          && (!isFullDate && state.snapshotFullDates.size < 5)
        ) {
          state.snapshotFullDates.add(localDate);
          return new Response(JSON.stringify(Array.from({ length: 500 }, (_, index) => ({
            document: firestoreDocument(
              'observability_actor_day',
              `${localDate}-${String(index).padStart(4, '0')}`,
              {
                schemaVersion: 1,
                environment: 'production',
                localDate,
                actorSubjectId:
                  `actor-${localDate.replaceAll('-', '')}${String(index).padStart(8, '0')}`,
              },
            ),
          }))), { status: 200 });
        }
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.endsWith('/documents:commit')) {
        if (state.snapshotConflictNextCommit) {
          state.snapshotConflictNextCommit = false;
          return new Response(null, { status: 409 });
        }
        return new Response(null, { status: 200 });
      }
    }

    if (scenario === 'backfill') {
      if (url.endsWith('/documents/observability_profile_registration_backfill_state/main')) {
        if (state.backfillProcessed === 0 && !state.backfillCompleted) {
          return new Response(null, { status: 404 });
        }
        const last = Math.max(0, state.backfillProcessed - 1);
        return new Response(JSON.stringify(firestoreDocument(
          'observability_profile_registration_backfill_state',
          'main',
          {
            schemaVersion: 1,
            cursor: state.backfillProcessed > 0
              ? {
                  orderedValue: eventTime(last),
                  documentName:
                    `projects/test-project/databases/(default)/documents/profiles/profile-${String(last).padStart(4, '0')}`,
                }
              : null,
            processedProfiles: state.backfillProcessed,
            normalizedProfiles: state.backfillProcessed,
            malformedProfiles: 0,
            completed: state.backfillCompleted,
            updatedAt: '2026-09-25T00:00:00.000Z',
          },
        )), { status: 200 });
      }
      if (url.endsWith('/documents/observability_user_enrichment_backfill_state/main')) {
        if (!state.userEnrichmentCheckpointExists) {
          return new Response(null, { status: 404 });
        }
        const completedEnvironments = [
          'production',
          'preview',
          'development',
          'test',
        ].slice(0, state.userEnrichmentEnvironmentIndex);
        return new Response(JSON.stringify(firestoreDocument(
          'observability_user_enrichment_backfill_state',
          'main',
          {
            schemaVersion: 1,
            environmentIndex: state.userEnrichmentEnvironmentIndex,
            cursorDocumentName: state.userEnrichmentProcessed > 0
              ? `projects/test-project/databases/(default)/documents/observability_user_summary_production/actor-${String(state.userEnrichmentProcessed - 1).padStart(8, '0')}`
              : null,
            pendingRecentErrorScan: null,
            completedEnvironments,
            processedUsers: state.userEnrichmentProcessed,
            enrichedUsers: state.userEnrichmentProcessed,
            completed: state.userEnrichmentEnvironmentIndex >= 4,
            updatedAt: '2026-09-25T00:00:00.000Z',
          },
        )), { status: 200 });
      }
      if (url.includes(':runAggregationQuery')) {
        return new Response(JSON.stringify([{
          result: { aggregateFields: { count: { integerValue: '2' } } },
        }]), { status: 200 });
      }
      if (url.includes(':runQuery')) {
        const collection = collectionFromQuery(init);
        if (collection === 'profiles') {
          const count = Math.min(100, state.backfillTotal - state.backfillProcessed);
          return new Response(JSON.stringify(Array.from({ length: Math.max(0, count) }, (_, offset) => {
            const index = state.backfillProcessed + offset;
            return {
              document: firestoreDocument(
                'profiles',
                `profile-${String(index).padStart(4, '0')}`,
                { createdAt: eventTime(index) },
              ),
            };
          })), { status: 200 });
        }
        if (collection.startsWith('observability_user_summary_')) {
          const isProduction = collection === 'observability_user_summary_production';
          const count = isProduction
            ? Math.min(17, state.userEnrichmentTotal - state.userEnrichmentProcessed)
            : 0;
          state.userEnrichmentLastPageCount = Math.max(0, count);
          return new Response(JSON.stringify(Array.from(
            { length: state.userEnrichmentLastPageCount },
            (_, offset) => {
              const index = state.userEnrichmentProcessed + offset;
              const actorSubjectId = `actor-${String(index).padStart(8, '0')}`;
              return {
                document: firestoreDocument(collection, actorSubjectId, {
                  schemaVersion: 1,
                  actorSubjectId,
                  firstActivityAt: '2026-09-01T00:00:00.000Z',
                  lastActivityAt: '2026-09-25T00:00:00.000Z',
                  firstActivityDate: '2026-09-01',
                  lastActivityDate: '2026-09-25',
                  eventCount: 1,
                  productActivityCount: 1,
                  aiRequestCount: 0,
                  planningOutcomeCount: 0,
                  lastProductAction: 'plan_created',
                  lastPlanningOutcome: null,
                  updatedAt: '2026-09-25T00:00:00.000Z',
                }),
              };
            },
          )), { status: 200 });
        }
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.endsWith('/documents:commit')) {
        const body = JSON.parse(String(init?.body)) as {
          writes: Array<{ update?: { name?: string } }>;
        };
        const userCheckpoint = body.writes.some((write) =>
          write.update?.name?.includes('/observability_user_enrichment_backfill_state/main'));
        if (userCheckpoint) {
          state.userEnrichmentCheckpointExists = true;
          state.userEnrichmentProcessed += state.userEnrichmentLastPageCount;
          if (state.userEnrichmentLastPageCount < 17) {
            state.userEnrichmentEnvironmentIndex += 1;
          }
        } else {
          const count = Math.min(100, state.backfillTotal - state.backfillProcessed);
          state.backfillProcessed += Math.max(0, count);
          state.backfillCompleted = count < 100;
        }
        return new Response(null, { status: 200 });
      }
    }

    if (scenario === 'retention') {
      if (url.includes(':runQuery')) {
        const collection = collectionFromQuery(init);
        const count = state.retentionMax ? 100 : 0;
        return new Response(JSON.stringify(Array.from({ length: count }, (_, index) => ({
          document: firestoreDocument(
            collection,
            `expired-${state.retentionDeleted + index}`,
            { expireAt: '2020-01-01T00:00:00.000Z' },
          ),
        }))), { status: 200 });
      }
      if (url.endsWith('/documents:commit')) {
        const body = JSON.parse(String(init?.body)) as { writes: unknown[] };
        state.retentionDeleted += body.writes.length;
        return new Response(null, { status: 200 });
      }
    }

    return new Response(null, { status: 404 });
  });
  return state;
}

async function runScheduled(minute: number): Promise<void> {
  const pending: Promise<unknown>[] = [];
  await traceWorker.scheduled(
    { scheduledTime: Date.UTC(2026, 8, 25, 0, minute) },
    env,
    {
      waitUntil(promise: Promise<unknown>) {
        pending.push(promise);
      },
    } as ExecutionContext,
  );
  await Promise.all(pending);
}

function externalCalls(state: ScenarioState): number {
  return state.calls.length;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-25T12:00:00.000Z'));
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('traceWorker scheduled subrequest budget', () => {
  it('routes solely from the scheduled UTC minute and keeps one daily trigger below Free requests', async () => {
    expect([
      scheduledObservabilityPhase(Date.UTC(2026, 8, 25, 0, 0)),
      scheduledObservabilityPhase(Date.UTC(2026, 8, 25, 0, 1)),
      scheduledObservabilityPhase(Date.UTC(2026, 8, 25, 0, 2)),
      scheduledObservabilityPhase(Date.UTC(2026, 8, 25, 0, 3)),
      scheduledObservabilityPhase(Date.UTC(2026, 8, 25, 0, 4)),
      scheduledObservabilityPhase(Date.UTC(2026, 8, 25, 23, 56)),
      scheduledObservabilityPhase(Date.UTC(2026, 8, 25, 23, 59)),
      scheduledObservabilityPhase(Date.UTC(2026, 8, 26, 0, 0)),
    ]).toEqual([
      'rollup',
      'active_user_snapshot',
      'profile_registration_backfill',
      'retention',
      'no_op',
      'active_user_snapshot',
      'no_op',
      'rollup',
    ]);
    expect(SCHEDULED_INVOCATIONS_PER_DAY).toBe(1_440);
    expect(SCHEDULED_INVOCATIONS_PER_DAY).toBeLessThan(100_000);

    const config = JSON.parse(readFileSync(
      new URL('../wrangler.jsonc', import.meta.url),
      'utf8',
    )) as { triggers?: { crons?: string[] } };
    expect(config.triggers?.crons).toEqual(['* * * * *']);

    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    await runScheduled(4);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps an empty and a five-batch rollup at exact 6 and 31 requests', async () => {
    const empty = installScenario('rollup');
    // An empty page is represented by treating the first query as the end.
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes(':runQuery')) {
        empty.calls.push({ url, init });
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return await originalFetch(input, init);
    });
    await runScheduled(0);
    expect(externalCalls(empty)).toBe(6);

    vi.unstubAllGlobals();
    const maximum = installScenario('rollup');
    await runScheduled(0);
    expect(externalCalls(maximum)).toBe(31);
    expect(maximum.rollupSuccessfulBatches).toBe(5);
  });

  it('uses the full 45-request application budget for two late rollup conflicts', async () => {
    const state = installScenario('rollup', { rollupConflictsRemaining: 2 });

    await runScheduled(0);

    expect(externalCalls(state)).toBe(45);
    expect(state.rollupSuccessfulBatches).toBe(5);
    expect(state.rollupConflictsRemaining).toBe(0);
  });

  it('defers at 45 when retries exhaust the budget and progresses on the next invocation', async () => {
    const state = installScenario('rollup', { rollupConflictsRemaining: 3 });

    await runScheduled(0);
    const firstCalls = externalCalls(state);
    expect(firstCalls).toBe(45);
    expect(state.rollupSuccessfulBatches).toBe(4);

    await runScheduled(0);
    expect(externalCalls(state) - firstCalls).toBe(31);
    expect(state.rollupSuccessfulBatches).toBe(9);
  });

  it('moves a rollup backlog forward by five batches on every invocation', async () => {
    const state = installScenario('rollup');

    await runScheduled(0);
    const firstCalls = externalCalls(state);
    await runScheduled(0);
    const secondCalls = externalCalls(state) - firstCalls;

    expect([firstCalls, secondCalls]).toEqual([31, 31]);
    expect(state.rollupSuccessfulBatches).toBe(10);
  });

  it('keeps snapshot initial, steady, maximum, and conflict paths below 50', async () => {
    const initial = installScenario('snapshot', { snapshotDirty: false });
    await runScheduled(1);
    expect(externalCalls(initial)).toBe(36);

    vi.unstubAllGlobals();
    const steady = installScenario('snapshot', {
      snapshotDirty: false,
      snapshotCurrentExists: true,
    });
    await runScheduled(1);
    expect(externalCalls(steady)).toBe(3);

    vi.unstubAllGlobals();
    const maximum = installScenario('snapshot', {
      snapshotDirty: true,
      snapshotMaxPages: true,
    });
    await runScheduled(1);
    expect(externalCalls(maximum)).toBe(44);
    expect(maximum.snapshotFullDates.size).toBe(5);

    vi.unstubAllGlobals();
    const conflict = installScenario('snapshot', {
      snapshotDirty: true,
      snapshotMaxPages: true,
      snapshotConflictNextCommit: true,
    });
    await runScheduled(1);
    expect(externalCalls(conflict)).toBe(42);
  });

  it('keeps the combined profile and user-enrichment backfill at exact bounded counts', async () => {
    const initial = installScenario('backfill', { backfillTotal: 0 });
    await runScheduled(2);
    expect(externalCalls(initial)).toBe(7);

    vi.unstubAllGlobals();
    const steady = installScenario('backfill', {
      backfillCompleted: true,
      userEnrichmentCheckpointExists: true,
      userEnrichmentEnvironmentIndex: 4,
    });
    await runScheduled(2);
    expect(externalCalls(steady)).toBe(3);

    vi.unstubAllGlobals();
    const backlog = installScenario('backfill', {
      backfillTotal: 250,
      userEnrichmentTotal: 17,
    });
    await runScheduled(2);
    const firstCalls = externalCalls(backlog);
    expect(firstCalls).toBe(44);
    expect(firstCalls).toBeLessThan(50);
    expect(backlog.backfillProcessed).toBe(200);
    expect(backlog.userEnrichmentProcessed).toBe(17);
    await runScheduled(2);
    expect(externalCalls(backlog) - firstCalls).toBe(7);
    expect(backlog.backfillProcessed).toBe(250);
    expect(backlog.backfillCompleted).toBe(true);
  });

  it('keeps retention steady and two 400-delete commits at exact 5 and 11', async () => {
    const steady = installScenario('retention');
    await runScheduled(3);
    expect(externalCalls(steady)).toBe(5);

    vi.unstubAllGlobals();
    const backlog = installScenario('retention', { retentionMax: true });
    await runScheduled(3);
    const firstCalls = externalCalls(backlog);
    expect(firstCalls).toBe(11);
    expect(backlog.retentionDeleted).toBe(800);
    await runScheduled(3);
    expect(externalCalls(backlog) - firstCalls).toBe(11);
    expect(backlog.retentionDeleted).toBe(1_600);
  });
});
