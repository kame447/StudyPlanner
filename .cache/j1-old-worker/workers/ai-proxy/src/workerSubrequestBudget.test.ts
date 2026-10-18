import { describe, expect, it, vi } from 'vitest';
import {
  WORKER_SUBREQUEST_HARD_LIMIT,
  WORKER_SUBREQUEST_WARNING_THRESHOLD,
  WorkerSubrequestBudget,
  WorkerSubrequestBudgetExceededError,
} from './workerSubrequestBudget';

describe('WorkerSubrequestBudget', () => {
  it('warns once at the threshold and rejects the request after the hard limit', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const completion = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const budget = new WorkerSubrequestBudget('fetch', 'observability_admin');

    for (let count = 0; count < WORKER_SUBREQUEST_HARD_LIMIT; count += 1) {
      budget.beforeSubrequest(count % 2 === 0 ? 'firestore' : 'oauth_token');
    }

    expect(budget.snapshot()).toEqual({
      attemptedSubrequests: WORKER_SUBREQUEST_HARD_LIMIT,
      hardLimit: WORKER_SUBREQUEST_HARD_LIMIT,
      phaseTotals: {
        oauth_token: 22,
        firestore: 23,
        identity_toolkit: 0,
      },
    });
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      '[Worker Subrequest Budget] warning',
      expect.objectContaining({
        invocationKind: 'fetch',
        operation: 'observability_admin',
        attemptedSubrequests: WORKER_SUBREQUEST_WARNING_THRESHOLD,
        hardLimit: WORKER_SUBREQUEST_HARD_LIMIT,
      }),
    );
    expect(() => budget.beforeSubrequest('identity_toolkit'))
      .toThrow(WorkerSubrequestBudgetExceededError);
    expect(budget.snapshot().attemptedSubrequests).toBe(WORKER_SUBREQUEST_HARD_LIMIT);
    expect(JSON.stringify(warning.mock.calls)).not.toMatch(/token=|authorization|firebaseUid/i);

    budget.logCompletion();
    expect(completion).toHaveBeenCalledWith(
      '[Worker Subrequest Budget] completed',
      {
        invocationKind: 'fetch',
        operation: 'observability_admin',
        attemptedSubrequests: WORKER_SUBREQUEST_HARD_LIMIT,
        hardLimit: WORKER_SUBREQUEST_HARD_LIMIT,
        phaseTotals: {
          oauth_token: 22,
          firestore: 23,
          identity_toolkit: 0,
        },
      },
    );
    expect(JSON.stringify(completion.mock.calls)).not.toMatch(/token=|authorization|firebaseUid/i);

    warning.mockRestore();
    completion.mockRestore();
  });
});
