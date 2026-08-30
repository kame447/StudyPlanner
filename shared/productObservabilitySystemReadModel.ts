import type { ObservabilityEnvironment } from './productObservabilityContract';

export const PRODUCT_OBSERVABILITY_SYSTEM_READ_MODEL_VERSION = 1 as const;
export const PRODUCT_OBSERVABILITY_ROLLUP_SCHEDULE_SECONDS = 5 * 60;
export const PRODUCT_OBSERVABILITY_ROLLUP_WARNING_AFTER_SECONDS = 15 * 60;

export type ObservabilitySystemHealth =
  | 'healthy'
  | 'warning'
  | 'unavailable'
  | 'unknown';

export type ObservabilitySystemComponentKey =
  | 'ai_proxy'
  | 'authentication'
  | 'telemetry_ingestion'
  | 'aggregation_read_model'
  | 'trace_availability';

export interface ObservabilitySystemComponentStatus {
  key: ObservabilitySystemComponentKey;
  status: ObservabilitySystemHealth;
  summary: string;
  lastObservedAt: string | null;
  ageSeconds: number | null;
  detail: string | null;
}

export interface ObservabilitySystemReadModel {
  schemaVersion: typeof PRODUCT_OBSERVABILITY_SYSTEM_READ_MODEL_VERSION;
  environment: ObservabilityEnvironment;
  generatedAt: string;
  overallStatus: ObservabilitySystemHealth;
  components: ObservabilitySystemComponentStatus[];
  aggregation: {
    processedEventCount: number | null;
    dirtySourceCount: number | null;
    lastRunStartedAt: string | null;
    lastSuccessfulRunAt: string | null;
    lastFailureAt: string | null;
    lastFailureCategory: string | null;
  };
  trace: {
    retainedSessionObserved: boolean | null;
    latestSessionActivityAt: string | null;
    accessMode: 'restricted';
  };
}
