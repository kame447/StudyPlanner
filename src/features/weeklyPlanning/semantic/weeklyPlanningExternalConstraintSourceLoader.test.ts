import { describe, expect, it, vi } from 'vitest';
import {
  loadExternalConstraintSourceAtomically,
  type ExternalConstraintSourceFetchAttemptResult,
} from './weeklyPlanningExternalConstraintSourceLoader';

function event() {
  return {
    eventId: 'event-1',
    ownerId: 'user-1',
    start: { date: '2026-07-22', time: '10:00' },
    end: { date: '2026-07-22', time: '11:00' },
    timeZone: 'Asia/Tokyo',
    constraintLevel: 'hard' as const,
  };
}

function context() {
  return { kind: 'timetable' as const, ownerId: 'user-1' };
}

describe('external constraint source atomic loader', () => {
  it('treats a successful empty result as no registered events', async () => {
    const fetchAttempt = vi.fn().mockResolvedValue({
      status: 'success',
      ownerId: 'user-1',
      activeSourceId: 'timetable-1',
      events: [],
    } satisfies ExternalConstraintSourceFetchAttemptResult);

    const result = await loadExternalConstraintSourceAtomically({
      context: context(),
      fetchAttempt,
      wait: vi.fn(),
    });

    expect(result).toEqual({
      kind: 'timetable',
      status: 'success',
      ownerId: 'user-1',
      activeSourceId: 'timetable-1',
      events: [],
      attemptCount: 1,
    });
    expect(fetchAttempt).toHaveBeenCalledTimes(1);
  });

  it('automatically retries temporary failures and returns only the final success', async () => {
    const fetchAttempt = vi.fn()
      .mockResolvedValueOnce({ status: 'failure', failureKind: 'timeout' })
      .mockResolvedValueOnce({ status: 'failure', failureKind: 'network_error' })
      .mockResolvedValueOnce({
        status: 'success',
        ownerId: 'user-1',
        activeSourceId: 'timetable-1',
        events: [event()],
      });
    const wait = vi.fn().mockResolvedValue(undefined);

    const result = await loadExternalConstraintSourceAtomically({
      context: context(),
      fetchAttempt,
      wait,
      retryPolicy: { maxAttempts: 3, retryDelaysMs: [10, 20] },
    });

    expect(result.status).toBe('success');
    expect(result.attemptCount).toBe(3);
    if (result.status === 'success') {
      expect(result.events).toEqual([event()]);
    }
    expect(wait).toHaveBeenNthCalledWith(1, 10);
    expect(wait).toHaveBeenNthCalledWith(2, 20);
  });

  it('does not retry authentication or permission failures', async () => {
    const fetchAttempt = vi.fn().mockResolvedValue({
      status: 'failure',
      failureKind: 'authentication_error',
    } satisfies ExternalConstraintSourceFetchAttemptResult);

    const result = await loadExternalConstraintSourceAtomically({
      context: context(),
      fetchAttempt,
      wait: vi.fn(),
    });

    expect(result).toEqual({
      kind: 'timetable',
      status: 'failure',
      ownerId: 'user-1',
      activeSourceId: null,
      failureKind: 'authentication_error',
      attemptCount: 1,
    });
    expect(fetchAttempt).toHaveBeenCalledTimes(1);
  });

  it('returns one failure after retryable failures are exhausted', async () => {
    const fetchAttempt = vi.fn().mockResolvedValue({
      status: 'failure',
      failureKind: 'server_error',
    } satisfies ExternalConstraintSourceFetchAttemptResult);

    const result = await loadExternalConstraintSourceAtomically({
      context: context(),
      fetchAttempt,
      wait: vi.fn().mockResolvedValue(undefined),
      retryPolicy: { maxAttempts: 3, retryDelaysMs: [0, 0] },
    });

    expect(result).toEqual({
      kind: 'timetable',
      status: 'failure',
      ownerId: 'user-1',
      activeSourceId: null,
      failureKind: 'server_error',
      attemptCount: 3,
    });
    expect(fetchAttempt).toHaveBeenCalledTimes(3);
    expect('events' in result).toBe(false);
  });
});
