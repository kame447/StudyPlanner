import { describe, expect, it } from 'vitest';
import {
  WeeklyPlanningTraceApiError,
  isWeeklyPlanningTraceRetriableError,
  isWeeklyPlanningTraceServerHandleRejection,
  weeklyPlanningTraceErrorSummary,
} from '../../../src/features/weeklyPlanning/trace/weeklyPlanningTracePrivacyClient';

describe('weekly planning trace typed error classification', () => {
  it('validation errorをretry対象にしない', () => {
    const error = new WeeklyPlanningTraceApiError('invalid', {
      stage: 'append',
      status: 400,
      code: 'trace_validation_failed',
      category: 'validation',
      correlationId: 'correlation-1',
      retryable: false,
    });
    expect(isWeeklyPlanningTraceRetriableError(error)).toBe(false);
    expect(weeklyPlanningTraceErrorSummary(error)).toMatchObject({
      stage: 'append',
      status: 400,
      code: 'trace_validation_failed',
      correlationId: 'correlation-1',
    });
  });

  it('storage unavailableをretry対象にする', () => {
    const error = new WeeklyPlanningTraceApiError('unavailable', {
      stage: 'append',
      status: 503,
      code: 'trace_storage_unavailable',
      category: 'storage',
      correlationId: 'correlation-2',
      retryable: true,
    });
    expect(isWeeklyPlanningTraceRetriableError(error)).toBe(true);
  });

  it('server handle rejectionだけをhandle再発行対象にする', () => {
    const error = new WeeklyPlanningTraceApiError('missing', {
      stage: 'append',
      status: 404,
      code: 'trace_session_not_started',
      category: 'conflict',
      correlationId: 'correlation-3',
      retryable: false,
    });
    expect(isWeeklyPlanningTraceServerHandleRejection(error)).toBe(true);
  });
});
