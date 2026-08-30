export * from './adminObservabilityService.phase7.stub.js';

const harnessState = new URLSearchParams(window.location.search).get('state') ?? 'populated';

export async function getAdminObservabilitySystemStatus({ environment = 'production' } = {}) {
  if (harnessState === 'error') throw new Error('Harness System status read failed.');
  const empty = harnessState === 'empty';
  return {
    schemaVersion: 1,
    environment,
    generatedAt: '2026-08-30T12:00:00.000Z',
    overallStatus: empty ? 'unknown' : 'warning',
    components: [
      {
        key: 'ai_proxy',
        status: 'healthy',
        summary: 'Admin API is responding through the AI proxy.',
        lastObservedAt: '2026-08-30T12:00:00.000Z',
        ageSeconds: 0,
        detail: 'Authenticated proxy request.',
      },
      {
        key: 'authentication',
        status: 'healthy',
        summary: 'Firebase authentication and admin authorization succeeded.',
        lastObservedAt: '2026-08-30T12:00:00.000Z',
        ageSeconds: 0,
        detail: null,
      },
      {
        key: 'telemetry_ingestion',
        status: empty ? 'unknown' : 'healthy',
        summary: empty ? 'No retained event was found.' : 'Latest accepted event is available.',
        lastObservedAt: empty ? null : '2026-08-30T11:59:20.000Z',
        ageSeconds: empty ? null : 40,
        detail: 'Inactivity alone is not treated as a failure.',
      },
      {
        key: 'aggregation_read_model',
        status: empty ? 'unknown' : 'warning',
        summary: empty ? 'Aggregation checkpoint is not available yet.' : 'Active-user snapshots still have dirty sources.',
        lastObservedAt: empty ? null : '2026-08-30T11:55:00.000Z',
        ageSeconds: empty ? null : 300,
        detail: null,
      },
      {
        key: 'trace_availability',
        status: 'healthy',
        summary: empty ? 'Trace storage is reachable; no retained session is visible.' : 'Trace storage is reachable.',
        lastObservedAt: empty ? null : '2026-08-30T11:40:00.000Z',
        ageSeconds: empty ? null : 1200,
        detail: 'Trace contents require additional permission.',
      },
    ],
    aggregation: {
      processedEventCount: empty ? null : 4821,
      dirtySourceCount: empty ? null : 2,
      lastRunStartedAt: empty ? null : '2026-08-30T11:54:30.000Z',
      lastSuccessfulRunAt: empty ? null : '2026-08-30T11:55:00.000Z',
      lastFailureAt: null,
      lastFailureCategory: null,
    },
    trace: {
      retainedSessionObserved: empty ? false : true,
      latestSessionActivityAt: empty ? null : '2026-08-30T11:40:00.000Z',
      accessMode: 'restricted',
    },
  };
}
