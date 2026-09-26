import { describe, expect, it, vi } from 'vitest';
import type { ObservabilityPlanningDailyCohort } from '../../../shared/productObservabilityPlanningReadModel';
import { ProductObservabilityAdminPlanningAnalysisService } from './productObservabilityAdminPlanningAnalysisService';
import { createEmptyPlanningSessionAggregate } from './productObservabilityPlanningProjection';

function cohort(cohortDate: string, sessionCount: number): ObservabilityPlanningDailyCohort {
  return {
    schemaVersion: 1,
    environment: 'production',
    cohortDate,
    reportingTimeZone: 'Asia/Tokyo',
    aggregate: {
      ...createEmptyPlanningSessionAggregate(),
      sessionCount,
      previewReachedCount: sessionCount,
      turnCountSum: sessionCount,
    },
    byAppVersion: [],
    bySchedulerVersion: [],
    byPromptVersion: [],
    byModel: [],
    updatedAt: `${cohortDate}T01:00:00.000Z`,
    expireAt: '2027-12-31T00:00:00.000Z',
  };
}

describe('ProductObservabilityAdminPlanningAnalysisService', () => {
  it('keeps missing dates zero-filled without shifting later batch results', async () => {
    const batchGetDocuments = vi.fn(async () => [
      { ...cohort('2026-09-01', 1), id: 'production:2026-09-01' },
      null,
      { ...cohort('2026-09-03', 3), id: 'production:2026-09-03' },
    ]);
    const service = new ProductObservabilityAdminPlanningAnalysisService(
      {
        FIREBASE_PROJECT_ID: 'test-project',
        FIREBASE_SERVICE_ACCOUNT_EMAIL: 'service@example.com',
        FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused',
      },
      { batchGetDocuments },
    );

    const result = await service.getPlanningAnalysis({
      environment: 'production',
      fromDate: '2026-09-01',
      toDate: '2026-09-03',
    });

    expect(batchGetDocuments).toHaveBeenCalledWith(
      'observability_planning_daily_rollups',
      [
        'production:2026-09-01',
        'production:2026-09-02',
        'production:2026-09-03',
      ],
    );
    expect(result.daily.map((day) => ({
      localDate: day.localDate,
      sessionCount: day.aggregate.sessionCount,
    }))).toEqual([
      { localDate: '2026-09-01', sessionCount: 1 },
      { localDate: '2026-09-02', sessionCount: 0 },
      { localDate: '2026-09-03', sessionCount: 3 },
    ]);
    expect(result.aggregate.sessionCount).toBe(4);
  });
});
