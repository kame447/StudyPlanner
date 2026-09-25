import type { AiRequestMetricStatus } from '../../../shared/productObservabilityContract';
import {
  PRODUCT_OBSERVABILITY_USER_ENRICHMENT_VERSION,
  type ObservabilityUserSummary,
} from '../../../shared/productObservabilityReadModel';

const AI_STATUSES = new Set<AiRequestMetricStatus>([
  'success',
  'quota_rejected',
  'timeout',
  'network_failure',
  'provider_error',
  'empty_response',
  'invalid_response',
  'cancelled',
  'unknown_failure',
]);

export interface ObservabilityClassifiedError {
  occurredAt: string;
  category: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function classifyObservabilityEventError(
  value: Readonly<Record<string, unknown>>,
): ObservabilityClassifiedError | null {
  const occurredAt = typeof value.occurredAt === 'string' ? value.occurredAt : '';
  if (!occurredAt || !Number.isFinite(new Date(occurredAt).getTime())) return null;
  const payload = record(value.payload) ?? {};
  if (value.eventType === 'ai_request_metric'
    && typeof payload.status === 'string'
    && AI_STATUSES.has(payload.status as AiRequestMetricStatus)
    && payload.status !== 'success') {
    return {
      occurredAt,
      category: typeof payload.errorCategory === 'string' && payload.errorCategory.trim()
        ? payload.errorCategory
        : payload.status,
    };
  }
  if (value.eventType === 'planning_outcome' && payload.outcomeType === 'failed') {
    return { occurredAt, category: 'planning_failed' };
  }
  if (value.eventType === 'planning_outcome'
    && payload.outcomeType === 'approval_failure_observed') {
    return { occurredAt, category: 'planning_approval_failure' };
  }
  return null;
}

export function userSummaryEnrichmentReady(
  summary: ObservabilityUserSummary | null,
): summary is ObservabilityUserSummary & {
  userEnrichmentVersion: typeof PRODUCT_OBSERVABILITY_USER_ENRICHMENT_VERSION;
  activeDayCount: number;
  latestErrorAt: string | null;
  latestErrorCategory: string | null;
  userEnrichmentUpdatedAt: string;
} {
  return summary?.userEnrichmentVersion === PRODUCT_OBSERVABILITY_USER_ENRICHMENT_VERSION
    && Number.isSafeInteger(summary.activeDayCount)
    && Number(summary.activeDayCount) >= 0
    && (summary.latestErrorAt === null
      || (typeof summary.latestErrorAt === 'string'
        && Number.isFinite(new Date(summary.latestErrorAt).getTime())))
    && (summary.latestErrorCategory === null
      || (typeof summary.latestErrorCategory === 'string'
        && Boolean(summary.latestErrorCategory.trim())))
    && (summary.latestErrorAt === null) === (summary.latestErrorCategory === null)
    && typeof summary.userEnrichmentUpdatedAt === 'string'
    && Number.isFinite(new Date(summary.userEnrichmentUpdatedAt).getTime());
}
