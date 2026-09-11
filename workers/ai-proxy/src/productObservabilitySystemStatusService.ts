import type { ObservabilityEnvironment } from '../../../shared/productObservabilityContract';
import {
  PRODUCT_OBSERVABILITY_ROLLUP_WARNING_AFTER_SECONDS,
  PRODUCT_OBSERVABILITY_SYSTEM_READ_MODEL_VERSION,
  type ObservabilitySystemComponentStatus,
  type ObservabilitySystemHealth,
  type ObservabilitySystemReadModel,
} from '../../../shared/productObservabilitySystemReadModel';
import {
  FirestoreServiceAccountClient,
  type FirestoreOrderedDocument,
  type FirestoreServiceAccountEnv,
} from './firestoreServiceAccountClient';

const OBSERVABILITY_EVENTS = 'observability_events';
const ROLLUP_STATE = 'observability_rollup_state';
const ROLLUP_STATE_ID = 'main';
const TRACE_SESSIONS = 'weekly_planning_trace_sessions';
const TELEMETRY_PROBE_LIMIT = 50;

interface SystemStatusFirestore {
  getDocument(collection: string, id: string): Promise<Record<string, unknown> | null>;
  queryDocumentsAfter(params: {
    collection: string;
    orderByField: string;
    filters?: Array<{ field: string; value: string }>;
    limit?: number;
    direction?: 'ASCENDING' | 'DESCENDING';
  }): Promise<FirestoreOrderedDocument[]>;
}

interface ProbeResult<T> {
  ok: boolean;
  value: T | null;
}

interface AggregationProbe {
  processedEventCount: number;
  dirtySourceCount: number;
  lastRunStartedAt: string | null;
  lastSuccessfulRunAt: string | null;
  lastFailureAt: string | null;
  lastFailureCategory: string | null;
}

export interface ProductObservabilitySystemStatusEnv extends FirestoreServiceAccountEnv {}

function isoTimestamp(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime())
    ? value
    : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function ageSeconds(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((nowMs - timestamp) / 1000));
}

function aggregationProbe(
  value: Record<string, unknown> | null,
  environment: ObservabilityEnvironment,
): AggregationProbe | null {
  if (!value) return null;
  const processedEventCount = nonNegativeInteger(value.processedEventCount);
  const dirtySources = value.activeUserDirtySources;
  if (processedEventCount === null || (dirtySources !== undefined && !Array.isArray(dirtySources))) {
    return null;
  }
  const dirtySourceCount = (Array.isArray(dirtySources) ? dirtySources : []).filter((source) => {
    return Boolean(source)
      && typeof source === 'object'
      && (source as Record<string, unknown>).environment === environment;
  }).length;
  return {
    processedEventCount,
    dirtySourceCount,
    lastRunStartedAt: isoTimestamp(value.lastRunStartedAt),
    lastSuccessfulRunAt: isoTimestamp(value.lastSuccessfulRunAt),
    lastFailureAt: isoTimestamp(value.lastFailureAt),
    lastFailureCategory: typeof value.lastFailureCategory === 'string'
      ? value.lastFailureCategory
      : null,
  };
}

function worstStatus(statuses: readonly ObservabilitySystemHealth[]): ObservabilitySystemHealth {
  if (statuses.includes('unavailable')) return 'unavailable';
  if (statuses.includes('warning')) return 'warning';
  if (statuses.includes('unknown')) return 'unknown';
  return 'healthy';
}

async function probe<T>(read: () => Promise<T>): Promise<ProbeResult<T>> {
  try {
    return { ok: true, value: await read() };
  } catch {
    return { ok: false, value: null };
  }
}

export function buildObservabilitySystemReadModel(params: {
  environment: ObservabilityEnvironment;
  generatedAt: string;
  telemetryProbe: ProbeResult<{ observedAt: string | null }>;
  aggregationProbe: ProbeResult<AggregationProbe | null>;
  traceProbe: ProbeResult<{ lastActivityAt: string | null; retained: boolean }>;
}): ObservabilitySystemReadModel {
  const nowMs = new Date(params.generatedAt).getTime();
  const components: ObservabilitySystemComponentStatus[] = [
    {
      key: 'ai_proxy',
      status: 'healthy',
      summary: 'Admin API is responding through the AI proxy.',
      lastObservedAt: params.generatedAt,
      ageSeconds: 0,
      detail: 'This status is generated inside the authenticated proxy request.',
    },
    {
      key: 'authentication',
      status: 'healthy',
      summary: 'Firebase authentication and admin authorization succeeded.',
      lastObservedAt: params.generatedAt,
      ageSeconds: 0,
      detail: 'No raw UID or token is included in this read model.',
    },
  ];

  if (!params.telemetryProbe.ok) {
    components.push({
      key: 'telemetry_ingestion',
      status: 'unavailable',
      summary: 'Telemetry storage could not be queried.',
      lastObservedAt: null,
      ageSeconds: null,
      detail: 'The status endpoint does not infer ingestion health from missing data.',
    });
  } else {
    const observedAt = params.telemetryProbe.value?.observedAt ?? null;
    components.push({
      key: 'telemetry_ingestion',
      status: observedAt ? 'healthy' : 'unknown',
      summary: observedAt
        ? 'Telemetry storage is reachable; latest accepted event is shown.'
        : 'Telemetry storage is reachable, but no retained event for this environment was found in the bounded probe.',
      lastObservedAt: observedAt,
      ageSeconds: ageSeconds(observedAt, nowMs),
      detail: 'Inactivity alone is not treated as an ingestion failure.',
    });
  }

  const aggregation = params.aggregationProbe.value;
  if (!params.aggregationProbe.ok) {
    components.push({
      key: 'aggregation_read_model',
      status: 'unavailable',
      summary: 'Aggregation checkpoint could not be read.',
      lastObservedAt: null,
      ageSeconds: null,
      detail: null,
    });
  } else if (!aggregation) {
    components.push({
      key: 'aggregation_read_model',
      status: 'unknown',
      summary: 'Aggregation checkpoint is not available yet.',
      lastObservedAt: null,
      ageSeconds: null,
      detail: null,
    });
  } else {
    const successAge = ageSeconds(aggregation.lastSuccessfulRunAt, nowMs);
    const failedAfterSuccess = Boolean(
      aggregation.lastFailureAt
      && (!aggregation.lastSuccessfulRunAt
        || aggregation.lastFailureAt > aggregation.lastSuccessfulRunAt),
    );
    const stale = successAge !== null
      && successAge > PRODUCT_OBSERVABILITY_ROLLUP_WARNING_AFTER_SECONDS;
    const warning = failedAfterSuccess || stale || aggregation.dirtySourceCount > 0;
    components.push({
      key: 'aggregation_read_model',
      status: warning ? 'warning' : aggregation.lastSuccessfulRunAt ? 'healthy' : 'unknown',
      summary: failedAfterSuccess
        ? 'The latest rollup attempt ended with a failure.'
        : stale
          ? 'The rollup checkpoint is older than the expected freshness window.'
          : aggregation.dirtySourceCount > 0
            ? 'Rollup succeeded, but active-user snapshots still have dirty sources.'
            : aggregation.lastSuccessfulRunAt
              ? 'Aggregation checkpoint is current.'
              : 'No successful aggregation run has been recorded yet.',
      lastObservedAt: aggregation.lastSuccessfulRunAt,
      ageSeconds: successAge,
      detail: aggregation.lastFailureCategory,
    });
  }

  if (!params.traceProbe.ok) {
    components.push({
      key: 'trace_availability',
      status: 'unavailable',
      summary: 'Trace storage could not be queried.',
      lastObservedAt: null,
      ageSeconds: null,
      detail: 'Detailed trace access remains separately restricted.',
    });
  } else {
    const latest = params.traceProbe.value?.lastActivityAt ?? null;
    components.push({
      key: 'trace_availability',
      status: 'healthy',
      summary: params.traceProbe.value?.retained
        ? 'Trace storage is reachable and retained sessions exist.'
        : 'Trace storage is reachable; no retained session is currently visible.',
      lastObservedAt: latest,
      ageSeconds: ageSeconds(latest, nowMs),
      detail: 'Trace contents require weeklyPlanningTraceReader permission.',
    });
  }

  return {
    schemaVersion: PRODUCT_OBSERVABILITY_SYSTEM_READ_MODEL_VERSION,
    environment: params.environment,
    generatedAt: params.generatedAt,
    overallStatus: worstStatus(components.map((component) => component.status)),
    components,
    aggregation: {
      processedEventCount: aggregation?.processedEventCount ?? null,
      dirtySourceCount: aggregation?.dirtySourceCount ?? null,
      lastRunStartedAt: aggregation?.lastRunStartedAt ?? null,
      lastSuccessfulRunAt: aggregation?.lastSuccessfulRunAt ?? null,
      lastFailureAt: aggregation?.lastFailureAt ?? null,
      lastFailureCategory: aggregation?.lastFailureCategory ?? null,
    },
    trace: {
      retainedSessionObserved: params.traceProbe.ok
        ? params.traceProbe.value?.retained ?? false
        : null,
      latestSessionActivityAt: params.traceProbe.value?.lastActivityAt ?? null,
      accessMode: 'restricted',
    },
  };
}

export class ProductObservabilitySystemStatusService {
  constructor(
    env: ProductObservabilitySystemStatusEnv,
    private readonly firestore: SystemStatusFirestore = new FirestoreServiceAccountClient(env),
  ) {}

  async getSystemStatus(environment: ObservabilityEnvironment): Promise<ObservabilitySystemReadModel> {
    const generatedAt = new Date().toISOString();
    const [telemetryResult, aggregationResult, traceResult] = await Promise.all([
      probe(async () => {
        const latest = await this.firestore.queryDocumentsAfter({
          collection: OBSERVABILITY_EVENTS,
          orderByField: 'observedAt',
          direction: 'DESCENDING',
          limit: TELEMETRY_PROBE_LIMIT,
        });
        const latestForEnvironment = latest.find((event) => event.environment === environment);
        return { observedAt: isoTimestamp(latestForEnvironment?.observedAt) };
      }),
      probe(async () => aggregationProbe(
        await this.firestore.getDocument(ROLLUP_STATE, ROLLUP_STATE_ID),
        environment,
      )),
      probe(async () => {
        const latest = await this.firestore.queryDocumentsAfter({
          collection: TRACE_SESSIONS,
          orderByField: 'lastActivityAt',
          direction: 'DESCENDING',
          limit: 1,
        });
        return {
          retained: latest.length > 0,
          lastActivityAt: isoTimestamp(latest[0]?.lastActivityAt),
        };
      }),
    ]);

    return buildObservabilitySystemReadModel({
      environment,
      generatedAt,
      telemetryProbe: telemetryResult,
      aggregationProbe: aggregationResult,
      traceProbe: traceResult,
    });
  }
}
