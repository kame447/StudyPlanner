import type { ObservabilityEnvironment } from '../../../shared/productObservabilityContract';
import { PRODUCT_OBSERVABILITY_REPORTING_TIME_ZONE } from '../../../shared/productObservabilityReadModel';
import {
  PRODUCT_OBSERVABILITY_PLANNING_DAILY_COLLECTION,
  PRODUCT_OBSERVABILITY_PLANNING_READ_MODEL_VERSION,
  type ObservabilityPlanningAnalysisReadModel,
  type ObservabilityPlanningDailyCohort,
  type ObservabilityPlanningDimensionAggregate,
  type ObservabilityPlanningDimensionSummary,
  type ObservabilityPlanningSessionAggregate,
} from '../../../shared/productObservabilityPlanningReadModel';
import { FirestoreServiceAccountClient } from './firestoreServiceAccountClient';
import {
  createEmptyPlanningSessionAggregate,
  mergePlanningSessionAggregates,
  planningDailyCohortDocumentId,
  planningRates,
} from './productObservabilityPlanningProjection';
import type { ProductObservabilityReadModelEnv } from './productObservabilityReadModelService';

const MAX_ANALYSIS_DAYS = 93;

interface PlanningAnalysisFirestore {
  getDocument(collection: string, id: string): Promise<Record<string, unknown> | null>;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(new Date(`${value}T00:00:00.000Z`).getTime());
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime());
}

function listDatesInclusive(fromDate: string, toDate: string): string[] {
  if (!isIsoDate(fromDate) || !isIsoDate(toDate) || fromDate > toDate) {
    throw new Error('observability_date_range_invalid');
  }
  const start = new Date(`${fromDate}T00:00:00.000Z`);
  const end = new Date(`${toDate}T00:00:00.000Z`);
  const result: string[] = [];
  for (let value = start.getTime(); value <= end.getTime(); value += 86_400_000) {
    result.push(new Date(value).toISOString().slice(0, 10));
    if (result.length > MAX_ANALYSIS_DAYS) throw new Error('observability_date_range_too_large');
  }
  return result;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function validAggregate(value: unknown): value is ObservabilityPlanningSessionAggregate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const aggregate = value as Record<string, unknown>;
  const fields: Array<keyof ObservabilityPlanningSessionAggregate> = [
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
  ];
  if (!fields.every((field) => nonNegativeInteger(aggregate[field]))) return false;
  const sessions = Number(aggregate.sessionCount);
  return Number(aggregate.previewReachedCount) <= sessions
    && Number(aggregate.approvalReachedCount) <= sessions
    && Number(aggregate.saveCompletedCount) <= sessions
    && Number(aggregate.abandonedCount) <= sessions
    && Number(aggregate.failedCount) <= sessions
    && Number(aggregate.fallbackUsedCount) <= sessions
    && Number(aggregate.semanticRepairUsedCount) <= sessions
    && Number(aggregate.staleObservedCount) <= sessions
    && Number(aggregate.unscheduledObservedCount) <= sessions
    && Number(aggregate.approvalFailureObservedCount) <= sessions
    && Number(aggregate.firstPreviewTurnIndexKnownCount) <= Number(aggregate.previewReachedCount);
}

function validDimensions(value: unknown): value is ObservabilityPlanningDimensionAggregate[] {
  return Array.isArray(value) && value.every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const record = entry as Record<string, unknown>;
    return typeof record.key === 'string' && record.key.length > 0 && validAggregate(record.aggregate);
  });
}

function readDailyCohort(
  value: Record<string, unknown> | null,
  environment: ObservabilityEnvironment,
  cohortDate: string,
): ObservabilityPlanningDailyCohort | null {
  if (!value) return null;
  const { id: _id, ...document } = value;
  const cohort = document as unknown as ObservabilityPlanningDailyCohort;
  if (
    cohort.schemaVersion !== PRODUCT_OBSERVABILITY_PLANNING_READ_MODEL_VERSION
    || cohort.environment !== environment
    || cohort.cohortDate !== cohortDate
    || cohort.reportingTimeZone !== PRODUCT_OBSERVABILITY_REPORTING_TIME_ZONE
    || !validAggregate(cohort.aggregate)
    || !validDimensions(cohort.byAppVersion)
    || !validDimensions(cohort.bySchedulerVersion)
    || !validDimensions(cohort.byPromptVersion)
    || !validDimensions(cohort.byModel)
    || !isIsoTimestamp(cohort.updatedAt)
  ) {
    throw new Error('observability_planning_daily_cohort_invalid');
  }
  return cohort;
}

function mergeDimensions(
  daily: readonly ObservabilityPlanningDailyCohort[],
  select: (value: ObservabilityPlanningDailyCohort) => ObservabilityPlanningDimensionAggregate[],
): ObservabilityPlanningDimensionSummary[] {
  const byKey = new Map<string, ObservabilityPlanningSessionAggregate[]>();
  for (const cohort of daily) {
    for (const entry of select(cohort)) {
      const values = byKey.get(entry.key) ?? [];
      values.push(entry.aggregate);
      byKey.set(entry.key, values);
    }
  }
  return [...byKey.entries()]
    .map(([key, values]) => {
      const aggregate = mergePlanningSessionAggregates(values);
      return { key, aggregate, rates: planningRates(aggregate) };
    })
    .filter((entry) => entry.aggregate.sessionCount > 0)
    .sort((left, right) => right.aggregate.sessionCount - left.aggregate.sessionCount
      || left.key.localeCompare(right.key));
}

function measurementStart(daily: readonly ObservabilityPlanningDailyCohort[]): string | null {
  const first = daily.find((entry) => entry.aggregate.sessionCount > 0);
  if (!first) return null;
  return new Date(`${first.cohortDate}T00:00:00+09:00`).toISOString();
}

export class ProductObservabilityAdminPlanningAnalysisService {
  constructor(
    env: ProductObservabilityReadModelEnv,
    private readonly firestore: PlanningAnalysisFirestore = new FirestoreServiceAccountClient(env),
  ) {}

  async getPlanningAnalysis(params: {
    environment: ObservabilityEnvironment;
    fromDate: string;
    toDate: string;
  }): Promise<ObservabilityPlanningAnalysisReadModel> {
    const dates = listDatesInclusive(params.fromDate, params.toDate);
    const values = await Promise.all(dates.map(async (cohortDate) => ({
      cohortDate,
      value: await this.firestore.getDocument(
        PRODUCT_OBSERVABILITY_PLANNING_DAILY_COLLECTION,
        planningDailyCohortDocumentId(params.environment, cohortDate),
      ),
    })));
    const daily = values
      .map(({ cohortDate, value }) => readDailyCohort(value, params.environment, cohortDate))
      .filter((value): value is ObservabilityPlanningDailyCohort => Boolean(value));
    const aggregate = daily.length > 0
      ? mergePlanningSessionAggregates(daily.map((entry) => entry.aggregate))
      : createEmptyPlanningSessionAggregate();
    const updated = daily.map((entry) => entry.updatedAt).sort();

    return {
      fromDate: params.fromDate,
      toDate: params.toDate,
      environment: params.environment,
      reportingTimeZone: PRODUCT_OBSERVABILITY_REPORTING_TIME_ZONE,
      aggregate,
      rates: planningRates(aggregate),
      byAppVersion: mergeDimensions(daily, (entry) => entry.byAppVersion),
      bySchedulerVersion: mergeDimensions(daily, (entry) => entry.bySchedulerVersion),
      byPromptVersion: mergeDimensions(daily, (entry) => entry.byPromptVersion),
      byModel: mergeDimensions(daily, (entry) => entry.byModel),
      daily: dates.map((localDate) => {
        const found = daily.find((entry) => entry.cohortDate === localDate);
        const dayAggregate = found?.aggregate ?? createEmptyPlanningSessionAggregate();
        return { localDate, aggregate: dayAggregate, rates: planningRates(dayAggregate) };
      }),
      measurementStartedAt: measurementStart(daily),
      lastUpdatedAt: updated.length > 0 ? updated[updated.length - 1] : null,
      abandonedMeasured: false,
    };
  }
}
