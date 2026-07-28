import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_TRACE_CONTRACT_VERSION,
  WEEKLY_PLANNING_TRACE_HEADERS,
} from '../../../shared/weeklyPlanningTraceContract';
import { handleWeeklyPlanningTraceApi } from './weeklyPlanningTraceApi';
import { resolveWeeklyPlanningTraceEpoch } from './weeklyPlanningTracePrivacy';

function env() {
  const epoch = resolveWeeklyPlanningTraceEpoch(new Date());
  return {
    FIREBASE_PROJECT_ID: 'test-project',
    FIREBASE_SERVICE_ACCOUNT_EMAIL: 'service@example.com',
    FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused',
    WEEKLY_PLANNING_TRACE_HMAC_SECRETS: JSON.stringify({
      [epoch]: 'a'.repeat(32),
    }),
    WEEKLY_PLANNING_TRACE_WORKER_REVISION: 'test-revision',
  };
}

describe('weekly planning trace API contract', () => {
  it('healthでcontract version、revision、correlation IDを返す', async () => {
    const result = await handleWeeklyPlanningTraceApi(
      new Request('https://example.test/weekly-planning-trace/health', {
        headers: {
          [WEEKLY_PLANNING_TRACE_HEADERS.contractVersion]:
            WEEKLY_PLANNING_TRACE_CONTRACT_VERSION,
          [WEEKLY_PLANNING_TRACE_HEADERS.correlationId]: 'correlation-1234',
        },
      }),
      env(),
      { uid: 'user-1' },
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      contractVersion: WEEKLY_PLANNING_TRACE_CONTRACT_VERSION,
      workerRevision: 'test-revision',
      correlationId: 'correlation-1234',
      storageLayoutVersion: 2,
    });
    expect(result.headers).toMatchObject({
      [WEEKLY_PLANNING_TRACE_HEADERS.contractVersion]:
        WEEKLY_PLANNING_TRACE_CONTRACT_VERSION,
      [WEEKLY_PLANNING_TRACE_HEADERS.workerRevision]: 'test-revision',
      [WEEKLY_PLANNING_TRACE_HEADERS.correlationId]: 'correlation-1234',
    });
  });

  it('不一致contractをsession作成前に拒否する', async () => {
    const result = await handleWeeklyPlanningTraceApi(
      new Request('https://example.test/weekly-planning-trace/session/start', {
        method: 'POST',
        headers: {
          [WEEKLY_PLANNING_TRACE_HEADERS.contractVersion]: 'old-contract',
          [WEEKLY_PLANNING_TRACE_HEADERS.correlationId]: 'correlation-5678',
        },
        body: '{}',
      }),
      env(),
      { uid: 'user-1' },
    );

    expect(result.status).toBe(426);
    expect(result.body).toMatchObject({
      ok: false,
      errorCode: 'trace_contract_mismatch',
      errorCategory: 'contract',
      retryable: false,
      correlationId: 'correlation-5678',
    });
  });
});
