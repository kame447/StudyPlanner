import type {
  AiRequestMetricStatus,
  ObservabilityEnvironment,
  PlanningOutcomeType,
  ProductActivityAction,
} from './productObservabilityContract';

export const PRODUCT_OBSERVABILITY_READ_MODEL_VERSION = 1 as const;
export const PRODUCT_OBSERVABILITY_REPORTING_TIME_ZONE = 'Asia/Tokyo' as const;
export const OBSERVABILITY_LATENCY_HISTOGRAM_VERSION = 'latency-ms-v1' as const;
export const OBSERVABILITY_LATENCY_BUCKET_UPPER_BOUNDS_MS = [
  100,
  250,
  500,
  1_000,
  2_000,
  5_000,
  10_000,
  30_000,
  60_000,
] as const;

export interface ObservabilityLatencyHistogram {
  version: typeof OBSERVABILITY_LATENCY_HISTOGRAM_VERSION;
  bucketCounts: number[];
  sampleCount: number;
  sumMs: number;
  minMs: number | null;
  maxMs: number | null;
}

export interface ObservabilityAiAggregate {
  requestCount: number;
  successCount: number;
  failureCount: number;
  statusCounts: Partial<Record<AiRequestMetricStatus, number>>;
  promptTokens: number;
  promptTokensUnknownCount: number;
  completionTokens: number;
  completionTokensUnknownCount: number;
  totalTokens: number;
  totalTokensUnknownCount: number;
  cachedTokens: number;
  cachedTokensUnknownCount: number;
  estimatedCostMicros: number;
  estimatedCostUnknownCount: number;
  latency: ObservabilityLatencyHistogram;
}

export interface ObservabilityDimensionAggregate<TAggregate> {
  key: string;
  aggregate: TAggregate;
}

export interface ObservabilityPlanningAggregate {
  outcomeCounts: Partial<Record<PlanningOutcomeType, number>>;
  previewCountSum: number;
  previewCountUnknownCount: number;
  unscheduledCountSum: number;
  unscheduledCountUnknownCount: number;
}

export interface ObservabilityDailyRollup {
  schemaVersion: typeof PRODUCT_OBSERVABILITY_READ_MODEL_VERSION;
  environment: ObservabilityEnvironment;
  localDate: string;
  reportingTimeZone: typeof PRODUCT_OBSERVABILITY_REPORTING_TIME_ZONE;
  processedEventCount: number;
  activeActorCount: number;
  firstOccurredAt: string | null;
  lastOccurredAt: string | null;
  productActivity: {
    eventCount: number;
    actionCounts: Partial<Record<ProductActivityAction, number>>;
  };
  ai: ObservabilityAiAggregate;
  aiByModel: Array<ObservabilityDimensionAggregate<ObservabilityAiAggregate>>;
  aiByPurpose: Array<ObservabilityDimensionAggregate<ObservabilityAiAggregate>>;
  aiByPhase: Array<ObservabilityDimensionAggregate<ObservabilityAiAggregate>>;
  planning: ObservabilityPlanningAggregate;
  planningBySchedulerVersion: Array<ObservabilityDimensionAggregate<ObservabilityPlanningAggregate>>;
  planningByPromptVersion: Array<ObservabilityDimensionAggregate<ObservabilityPlanningAggregate>>;
  planningByModel: Array<ObservabilityDimensionAggregate<ObservabilityPlanningAggregate>>;
  updatedAt: string;
  expireAt: string;
}

export interface ObservabilityActorDay {
  schemaVersion: typeof PRODUCT_OBSERVABILITY_READ_MODEL_VERSION;
  environment: ObservabilityEnvironment;
  localDate: string;
  actorSubjectId: string;
  firstOccurredAt: string;
  lastOccurredAt: string;
  eventCount: number;
  productActivityObserved: boolean;
  aiRequestObserved: boolean;
  planningObserved: boolean;
  updatedAt: string;
  expireAt: string;
}

export interface ObservabilityUserSummary {
  schemaVersion: typeof PRODUCT_OBSERVABILITY_READ_MODEL_VERSION;
  actorSubjectId: string;
  firstActivityAt: string;
  lastActivityAt: string;
  firstActivityDate: string;
  lastActivityDate: string;
  eventCount: number;
  productActivityCount: number;
  aiRequestCount: number;
  planningOutcomeCount: number;
  lastProductAction: ProductActivityAction | null;
  lastPlanningOutcome: PlanningOutcomeType | null;
  updatedAt: string;
}

export interface ObservabilityRollupCursor {
  observedAt: string;
  documentName: string;
}

export interface ObservabilityRollupCheckpoint {
  schemaVersion: typeof PRODUCT_OBSERVABILITY_READ_MODEL_VERSION;
  cursor: ObservabilityRollupCursor | null;
  processedEventCount: number;
  lastRunStartedAt: string | null;
  lastSuccessfulRunAt: string | null;
  lastFailureAt: string | null;
  lastFailureCategory: string | null;
  updatedAt: string;
}

export interface ObservabilityOverviewQuery {
  fromDate: string;
  toDate: string;
}

export interface ObservabilityOverviewReadModel {
  schemaVersion: typeof PRODUCT_OBSERVABILITY_READ_MODEL_VERSION;
  fromDate: string;
  toDate: string;
  reportingTimeZone: typeof PRODUCT_OBSERVABILITY_REPORTING_TIME_ZONE;
  daily: ObservabilityDailyRollup[];
  distinctActiveActors: number;
  aiLatencyP50Ms: number | null;
  aiLatencyP95Ms: number | null;
  rollupCheckpoint: ObservabilityRollupCheckpoint;
}
