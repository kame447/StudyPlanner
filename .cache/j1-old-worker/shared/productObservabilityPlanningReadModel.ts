import type { ObservabilityEnvironment } from './productObservabilityContract';
import { PRODUCT_OBSERVABILITY_REPORTING_TIME_ZONE } from './productObservabilityReadModel';

export const PRODUCT_OBSERVABILITY_PLANNING_READ_MODEL_VERSION = 1 as const;
export const PRODUCT_OBSERVABILITY_PLANNING_SESSION_RETENTION_DAYS = 120 as const;
export const PRODUCT_OBSERVABILITY_PLANNING_COHORT_RETENTION_DAYS = 400 as const;
export const PRODUCT_OBSERVABILITY_PLANNING_SESSION_COLLECTION =
  'observability_planning_session_summary' as const;
export const PRODUCT_OBSERVABILITY_PLANNING_DAILY_COLLECTION =
  'observability_planning_daily_rollups' as const;

export interface ObservabilityPlanningSessionSummary {
  schemaVersion: typeof PRODUCT_OBSERVABILITY_PLANNING_READ_MODEL_VERSION;
  environment: ObservabilityEnvironment;
  featureSessionId: string;
  startedAt: string | null;
  startedDate: string | null;
  lastOccurredAt: string;
  appVersion: string | null;
  schedulerVersion: string | null;
  promptVersion: string | null;
  model: string | null;
  turnCount: number;
  maxTurnIndex: number | null;
  previewReached: boolean;
  firstPreviewTurnIndex: number | null;
  approvalReached: boolean;
  saveCompleted: boolean;
  abandoned: boolean;
  failed: boolean;
  fallbackUsed: boolean;
  semanticRepairUsed: boolean;
  staleObserved: boolean;
  unscheduledObserved: boolean;
  approvalFailureObserved: boolean;
  updatedAt: string;
  expireAt: string;
}

export interface ObservabilityPlanningSessionAggregate {
  sessionCount: number;
  previewReachedCount: number;
  approvalReachedCount: number;
  saveCompletedCount: number;
  abandonedCount: number;
  failedCount: number;
  fallbackUsedCount: number;
  semanticRepairUsedCount: number;
  staleObservedCount: number;
  unscheduledObservedCount: number;
  approvalFailureObservedCount: number;
  turnCountSum: number;
  firstPreviewTurnIndexSum: number;
  firstPreviewTurnIndexKnownCount: number;
}

export interface ObservabilityPlanningDimensionAggregate {
  key: string;
  aggregate: ObservabilityPlanningSessionAggregate;
}

export interface ObservabilityPlanningDailyCohort {
  schemaVersion: typeof PRODUCT_OBSERVABILITY_PLANNING_READ_MODEL_VERSION;
  environment: ObservabilityEnvironment;
  cohortDate: string;
  reportingTimeZone: typeof PRODUCT_OBSERVABILITY_REPORTING_TIME_ZONE;
  aggregate: ObservabilityPlanningSessionAggregate;
  byAppVersion: ObservabilityPlanningDimensionAggregate[];
  bySchedulerVersion: ObservabilityPlanningDimensionAggregate[];
  byPromptVersion: ObservabilityPlanningDimensionAggregate[];
  byModel: ObservabilityPlanningDimensionAggregate[];
  updatedAt: string;
  expireAt: string;
}

export interface ObservabilityPlanningRates {
  previewRate: number | null;
  approvalRate: number | null;
  saveRate: number | null;
  failureObservedRate: number | null;
  fallbackRate: number | null;
  semanticRepairRate: number | null;
  staleObservedRate: number | null;
  unscheduledObservedRate: number | null;
  approvalFailureObservedRate: number | null;
  averageTurns: number | null;
  averageTurnsToFirstPreview: number | null;
}

export interface ObservabilityPlanningDimensionSummary {
  key: string;
  aggregate: ObservabilityPlanningSessionAggregate;
  rates: ObservabilityPlanningRates;
}

export interface ObservabilityPlanningDailySummary {
  localDate: string;
  aggregate: ObservabilityPlanningSessionAggregate;
  rates: ObservabilityPlanningRates;
}

export interface ObservabilityPlanningAnalysisReadModel {
  fromDate: string;
  toDate: string;
  environment: ObservabilityEnvironment;
  reportingTimeZone: typeof PRODUCT_OBSERVABILITY_REPORTING_TIME_ZONE;
  aggregate: ObservabilityPlanningSessionAggregate;
  rates: ObservabilityPlanningRates;
  byAppVersion: ObservabilityPlanningDimensionSummary[];
  bySchedulerVersion: ObservabilityPlanningDimensionSummary[];
  byPromptVersion: ObservabilityPlanningDimensionSummary[];
  byModel: ObservabilityPlanningDimensionSummary[];
  daily: ObservabilityPlanningDailySummary[];
  measurementStartedAt: string | null;
  lastUpdatedAt: string | null;
  abandonedMeasured: boolean;
}
