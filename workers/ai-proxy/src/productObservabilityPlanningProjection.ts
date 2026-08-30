import type {
  ObservabilityEnvironment,
  PlanningOutcomeMetricPayload,
  StoredObservabilityEvent,
} from '../../../shared/productObservabilityContract';
import { PRODUCT_OBSERVABILITY_REPORTING_TIME_ZONE } from '../../../shared/productObservabilityReadModel';
import {
  PRODUCT_OBSERVABILITY_PLANNING_COHORT_RETENTION_DAYS,
  PRODUCT_OBSERVABILITY_PLANNING_DAILY_COLLECTION,
  PRODUCT_OBSERVABILITY_PLANNING_READ_MODEL_VERSION,
  PRODUCT_OBSERVABILITY_PLANNING_SESSION_COLLECTION,
  PRODUCT_OBSERVABILITY_PLANNING_SESSION_RETENTION_DAYS,
  type ObservabilityPlanningDailyCohort,
  type ObservabilityPlanningDimensionAggregate,
  type ObservabilityPlanningRates,
  type ObservabilityPlanningSessionAggregate,
  type ObservabilityPlanningSessionSummary,
} from '../../../shared/productObservabilityPlanningReadModel';
import { observabilityReportingDate } from './productObservabilityReadModelProjection';

const MAX_DIMENSION_VALUES = 32;
const OTHER_DIMENSION_KEY = '__other__';
const UNKNOWN_DIMENSION_KEY = 'unknown';

type StoredPlanningOutcomeEvent = StoredObservabilityEvent<PlanningOutcomeMetricPayload>;

const aggregateFields = [
  'sessionCount',
  'previewReachedCount',
  'approvalReachedCount',
  'saveCompletedCount',
  'abandonedCount',
  'failedCount',
  'fallbackUsedCount',
  'semanticRepairUsedCount',
  'staleObservedCount',
  'unscheduledObservedCount',
  'approvalFailureObservedCount',
  'turnCountSum',
  'firstPreviewTurnIndexSum',
  'firstPreviewTurnIndexKnownCount',
] as const satisfies readonly (keyof ObservabilityPlanningSessionAggregate)[];

function expiryFrom(nowIso: string, retentionDays: number): string {
  return new Date(new Date(nowIso).getTime() + retentionDays * 86_400_000).toISOString();
}

function boundedDimension(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 128) : null;
}

function mergedDimension(
  current: string | null,
  incoming: string | null | undefined,
): string | null {
  const normalized = boundedDimension(incoming);
  if (!normalized) return current;
  if (!current) return normalized;
  return current === normalized ? current : '__mixed__';
}

function validTurnIndex(value: number | null | undefined): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function planningSessionDocumentId(
  environment: ObservabilityEnvironment,
  featureSessionId: string,
): string {
  return `${environment}:${base64Url(featureSessionId)}`;
}

export function planningDailyCohortDocumentId(
  environment: ObservabilityEnvironment,
  cohortDate: string,
): string {
  return `${environment}:${cohortDate}`;
}

export function createEmptyPlanningSessionAggregate(): ObservabilityPlanningSessionAggregate {
  return {
    sessionCount: 0,
    previewReachedCount: 0,
    approvalReachedCount: 0,
    saveCompletedCount: 0,
    abandonedCount: 0,
    failedCount: 0,
    fallbackUsedCount: 0,
    semanticRepairUsedCount: 0,
    staleObservedCount: 0,
    unscheduledObservedCount: 0,
    approvalFailureObservedCount: 0,
    turnCountSum: 0,
    firstPreviewTurnIndexSum: 0,
    firstPreviewTurnIndexKnownCount: 0,
  };
}

export function mergePlanningSessionAggregates(
  values: readonly ObservabilityPlanningSessionAggregate[],
): ObservabilityPlanningSessionAggregate {
  return values.reduce((merged, value) => {
    const next = { ...merged };
    for (const field of aggregateFields) next[field] += value[field];
    return next;
  }, createEmptyPlanningSessionAggregate());
}

export function planningRates(
  aggregate: ObservabilityPlanningSessionAggregate,
): ObservabilityPlanningRates {
  const sessions = aggregate.sessionCount;
  const rate = (value: number) => sessions > 0 ? value / sessions : null;
  return {
    previewRate: rate(aggregate.previewReachedCount),
    approvalRate: rate(aggregate.approvalReachedCount),
    saveRate: rate(aggregate.saveCompletedCount),
    failureObservedRate: rate(aggregate.failedCount),
    fallbackRate: rate(aggregate.fallbackUsedCount),
    semanticRepairRate: rate(aggregate.semanticRepairUsedCount),
    staleObservedRate: rate(aggregate.staleObservedCount),
    unscheduledObservedRate: rate(aggregate.unscheduledObservedCount),
    approvalFailureObservedRate: rate(aggregate.approvalFailureObservedCount),
    averageTurns: sessions > 0 ? aggregate.turnCountSum / sessions : null,
    averageTurnsToFirstPreview: aggregate.firstPreviewTurnIndexKnownCount > 0
      ? aggregate.firstPreviewTurnIndexSum / aggregate.firstPreviewTurnIndexKnownCount
      : null,
  };
}

function createSessionSummary(params: {
  event: StoredPlanningOutcomeEvent;
  featureSessionId: string;
  nowIso: string;
}): ObservabilityPlanningSessionSummary {
  return {
    schemaVersion: PRODUCT_OBSERVABILITY_PLANNING_READ_MODEL_VERSION,
    environment: params.event.environment,
    featureSessionId: params.featureSessionId,
    startedAt: null,
    startedDate: null,
    lastOccurredAt: params.event.occurredAt,
    appVersion: null,
    schedulerVersion: null,
    promptVersion: null,
    model: null,
    turnCount: 0,
    maxTurnIndex: null,
    previewReached: false,
    firstPreviewTurnIndex: null,
    approvalReached: false,
    saveCompleted: false,
    abandoned: false,
    failed: false,
    fallbackUsed: false,
    semanticRepairUsed: false,
    staleObserved: false,
    unscheduledObserved: false,
    approvalFailureObserved: false,
    updatedAt: params.nowIso,
    expireAt: expiryFrom(params.nowIso, PRODUCT_OBSERVABILITY_PLANNING_SESSION_RETENTION_DAYS),
  };
}

export function projectPlanningSessionSummary(params: {
  current: ObservabilityPlanningSessionSummary | null;
  event: StoredPlanningOutcomeEvent;
  nowIso: string;
}): ObservabilityPlanningSessionSummary {
  const featureSessionId = params.event.correlation.featureSessionId?.trim() ?? '';
  if (!featureSessionId) throw new Error('invalid_planning_session_event');
  const payload = params.event.payload;
  const base = params.current ?? createSessionSummary({
    event: params.event,
    featureSessionId,
    nowIso: params.nowIso,
  });
  if (base.environment !== params.event.environment || base.featureSessionId !== featureSessionId) {
    throw new Error('invalid_planning_session_summary');
  }

  const eventTurnIndex = validTurnIndex(payload.turnIndex);
  const startedAt = payload.outcomeType === 'session_started'
    ? base.startedAt === null || params.event.occurredAt < base.startedAt
      ? params.event.occurredAt
      : base.startedAt
    : base.startedAt;
  const firstPreviewTurnIndex = payload.outcomeType === 'preview_generated' && eventTurnIndex !== null
    ? base.firstPreviewTurnIndex === null
      ? eventTurnIndex
      : Math.min(base.firstPreviewTurnIndex, eventTurnIndex)
    : base.firstPreviewTurnIndex;
  const maxTurnIndex = eventTurnIndex === null
    ? base.maxTurnIndex
    : base.maxTurnIndex === null
      ? eventTurnIndex
      : Math.max(base.maxTurnIndex, eventTurnIndex);

  return {
    ...base,
    startedAt,
    startedDate: startedAt ? observabilityReportingDate(startedAt) : null,
    lastOccurredAt: params.event.occurredAt > base.lastOccurredAt
      ? params.event.occurredAt
      : base.lastOccurredAt,
    appVersion: payload.outcomeType === 'session_started'
      ? boundedDimension(params.event.appVersion) ?? base.appVersion
      : base.appVersion,
    schedulerVersion: mergedDimension(base.schedulerVersion, payload.schedulerVersion),
    promptVersion: mergedDimension(base.promptVersion, payload.promptVersion),
    model: mergedDimension(base.model, payload.model),
    turnCount: base.turnCount + (payload.outcomeType === 'turn_started' ? 1 : 0),
    maxTurnIndex,
    previewReached: base.previewReached || payload.outcomeType === 'preview_generated',
    firstPreviewTurnIndex,
    approvalReached: base.approvalReached
      || payload.outcomeType === 'approval_started'
      || payload.outcomeType === 'approval_completed'
      || payload.outcomeType === 'save_completed',
    saveCompleted: base.saveCompleted || payload.outcomeType === 'save_completed',
    abandoned: base.abandoned || payload.outcomeType === 'abandoned',
    failed: base.failed || payload.outcomeType === 'failed',
    fallbackUsed: base.fallbackUsed || payload.outcomeType === 'fallback_used'
      || payload.fallbackUsed === true,
    semanticRepairUsed: base.semanticRepairUsed || payload.outcomeType === 'semantic_repair_used'
      || payload.repairUsed === true,
    staleObserved: base.staleObserved || payload.outcomeType === 'stale_observed'
      || payload.staleObserved === true,
    unscheduledObserved: base.unscheduledObserved || payload.outcomeType === 'unscheduled_observed'
      || (typeof payload.unscheduledCount === 'number' && payload.unscheduledCount > 0),
    approvalFailureObserved: base.approvalFailureObserved
      || payload.outcomeType === 'approval_failure_observed'
      || payload.approvalFailureObserved === true,
    updatedAt: params.nowIso,
    expireAt: expiryFrom(params.nowIso, PRODUCT_OBSERVABILITY_PLANNING_SESSION_RETENTION_DAYS),
  };
}

function contribution(
  summary: ObservabilityPlanningSessionSummary | null,
  cohortDate: string,
): ObservabilityPlanningSessionAggregate {
  if (!summary || summary.startedDate !== cohortDate) return createEmptyPlanningSessionAggregate();
  return {
    sessionCount: 1,
    previewReachedCount: summary.previewReached ? 1 : 0,
    approvalReachedCount: summary.approvalReached ? 1 : 0,
    saveCompletedCount: summary.saveCompleted ? 1 : 0,
    abandonedCount: summary.abandoned ? 1 : 0,
    failedCount: summary.failed ? 1 : 0,
    fallbackUsedCount: summary.fallbackUsed ? 1 : 0,
    semanticRepairUsedCount: summary.semanticRepairUsed ? 1 : 0,
    staleObservedCount: summary.staleObserved ? 1 : 0,
    unscheduledObservedCount: summary.unscheduledObserved ? 1 : 0,
    approvalFailureObservedCount: summary.approvalFailureObserved ? 1 : 0,
    turnCountSum: summary.turnCount,
    firstPreviewTurnIndexSum: summary.firstPreviewTurnIndex ?? 0,
    firstPreviewTurnIndexKnownCount: summary.firstPreviewTurnIndex === null ? 0 : 1,
  };
}

function applyAggregateDelta(
  current: ObservabilityPlanningSessionAggregate,
  previous: ObservabilityPlanningSessionAggregate,
  next: ObservabilityPlanningSessionAggregate,
): ObservabilityPlanningSessionAggregate {
  const updated = { ...current };
  for (const field of aggregateFields) {
    const value = current[field] - previous[field] + next[field];
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid_planning_cohort_delta');
    updated[field] = value;
  }
  return updated;
}

function dimensionKey(value: string | null): string {
  return boundedDimension(value) ?? UNKNOWN_DIMENSION_KEY;
}

function targetDimensionKey(
  values: readonly ObservabilityPlanningDimensionAggregate[],
  requested: string,
): string {
  if (values.some((entry) => entry.key === requested)) return requested;
  return values.length < MAX_DIMENSION_VALUES ? requested : OTHER_DIMENSION_KEY;
}

function updateDimensionValue(
  values: ObservabilityPlanningDimensionAggregate[],
  requestedKey: string,
  previous: ObservabilityPlanningSessionAggregate,
  next: ObservabilityPlanningSessionAggregate,
): ObservabilityPlanningDimensionAggregate[] {
  const key = targetDimensionKey(values, requestedKey);
  const existing = values.find((entry) => entry.key === key);
  if (!existing) {
    return [...values, {
      key,
      aggregate: applyAggregateDelta(createEmptyPlanningSessionAggregate(), previous, next),
    }];
  }
  return values.map((entry) => entry.key === key
    ? { ...entry, aggregate: applyAggregateDelta(entry.aggregate, previous, next) }
    : entry);
}

function updateDimension(params: {
  values: ObservabilityPlanningDimensionAggregate[];
  previousSummary: ObservabilityPlanningSessionSummary | null;
  nextSummary: ObservabilityPlanningSessionSummary | null;
  previousContribution: ObservabilityPlanningSessionAggregate;
  nextContribution: ObservabilityPlanningSessionAggregate;
  select(summary: ObservabilityPlanningSessionSummary): string | null;
}): ObservabilityPlanningDimensionAggregate[] {
  const previousKey = params.previousSummary
    ? dimensionKey(params.select(params.previousSummary))
    : null;
  const nextKey = params.nextSummary ? dimensionKey(params.select(params.nextSummary)) : null;
  if (previousKey !== null && previousKey === nextKey) {
    return updateDimensionValue(
      params.values,
      previousKey,
      params.previousContribution,
      params.nextContribution,
    );
  }

  let values = params.values;
  if (previousKey !== null) {
    values = updateDimensionValue(
      values,
      previousKey,
      params.previousContribution,
      createEmptyPlanningSessionAggregate(),
    );
  }
  if (nextKey !== null) {
    values = updateDimensionValue(
      values,
      nextKey,
      createEmptyPlanningSessionAggregate(),
      params.nextContribution,
    );
  }
  return values;
}

function createEmptyPlanningDailyCohort(params: {
  environment: ObservabilityEnvironment;
  cohortDate: string;
  nowIso: string;
}): ObservabilityPlanningDailyCohort {
  return {
    schemaVersion: PRODUCT_OBSERVABILITY_PLANNING_READ_MODEL_VERSION,
    environment: params.environment,
    cohortDate: params.cohortDate,
    reportingTimeZone: PRODUCT_OBSERVABILITY_REPORTING_TIME_ZONE,
    aggregate: createEmptyPlanningSessionAggregate(),
    byAppVersion: [],
    bySchedulerVersion: [],
    byPromptVersion: [],
    byModel: [],
    updatedAt: params.nowIso,
    expireAt: expiryFrom(params.nowIso, PRODUCT_OBSERVABILITY_PLANNING_COHORT_RETENTION_DAYS),
  };
}

export function projectPlanningDailyCohort(params: {
  current: ObservabilityPlanningDailyCohort | null;
  previousSession: ObservabilityPlanningSessionSummary | null;
  nextSession: ObservabilityPlanningSessionSummary | null;
  environment: ObservabilityEnvironment;
  cohortDate: string;
  nowIso: string;
}): ObservabilityPlanningDailyCohort {
  const base = params.current ?? createEmptyPlanningDailyCohort(params);
  if (base.environment !== params.environment || base.cohortDate !== params.cohortDate) {
    throw new Error('invalid_planning_daily_cohort');
  }
  const previousContribution = contribution(params.previousSession, params.cohortDate);
  const nextContribution = contribution(params.nextSession, params.cohortDate);
  const previousSummary = previousContribution.sessionCount > 0 ? params.previousSession : null;
  const nextSummary = nextContribution.sessionCount > 0 ? params.nextSession : null;

  return {
    ...base,
    aggregate: applyAggregateDelta(base.aggregate, previousContribution, nextContribution),
    byAppVersion: updateDimension({
      values: base.byAppVersion,
      previousSummary,
      nextSummary,
      previousContribution,
      nextContribution,
      select: (summary) => summary.appVersion,
    }),
    bySchedulerVersion: updateDimension({
      values: base.bySchedulerVersion,
      previousSummary,
      nextSummary,
      previousContribution,
      nextContribution,
      select: (summary) => summary.schedulerVersion,
    }),
    byPromptVersion: updateDimension({
      values: base.byPromptVersion,
      previousSummary,
      nextSummary,
      previousContribution,
      nextContribution,
      select: (summary) => summary.promptVersion,
    }),
    byModel: updateDimension({
      values: base.byModel,
      previousSummary,
      nextSummary,
      previousContribution,
      nextContribution,
      select: (summary) => summary.model,
    }),
    updatedAt: params.nowIso,
    expireAt: expiryFrom(params.nowIso, PRODUCT_OBSERVABILITY_PLANNING_COHORT_RETENTION_DAYS),
  };
}

export {
  PRODUCT_OBSERVABILITY_PLANNING_DAILY_COLLECTION,
  PRODUCT_OBSERVABILITY_PLANNING_SESSION_COLLECTION,
};
