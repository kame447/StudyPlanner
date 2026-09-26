export const WORKER_SUBREQUEST_WARNING_THRESHOLD = 40;
export const WORKER_SUBREQUEST_HARD_LIMIT = 45;

export type WorkerSubrequestPhase = 'oauth_token' | 'firestore' | 'identity_toolkit';

export interface WorkerSubrequestObserver {
  beforeSubrequest(phase: WorkerSubrequestPhase): void;
}

export class WorkerSubrequestBudgetExceededError extends Error {
  constructor() {
    super('worker_subrequest_budget_exceeded');
    this.name = 'WorkerSubrequestBudgetExceededError';
  }
}

export class WorkerSubrequestBudget implements WorkerSubrequestObserver {
  private attemptedSubrequests = 0;
  private warningLogged = false;
  private readonly phaseTotals: Record<WorkerSubrequestPhase, number> = {
    oauth_token: 0,
    firestore: 0,
    identity_toolkit: 0,
  };

  constructor(
    private readonly invocationKind: 'fetch' | 'scheduled',
    private readonly operation: string,
  ) {}

  beforeSubrequest(phase: WorkerSubrequestPhase): void {
    if (this.attemptedSubrequests >= WORKER_SUBREQUEST_HARD_LIMIT) {
      throw new WorkerSubrequestBudgetExceededError();
    }
    this.attemptedSubrequests += 1;
    this.phaseTotals[phase] += 1;
    if (!this.warningLogged
      && this.attemptedSubrequests >= WORKER_SUBREQUEST_WARNING_THRESHOLD) {
      this.warningLogged = true;
      console.warn('[Worker Subrequest Budget] warning', {
        invocationKind: this.invocationKind,
        operation: this.operation,
        phase,
        attemptedSubrequests: this.attemptedSubrequests,
        hardLimit: WORKER_SUBREQUEST_HARD_LIMIT,
      });
    }
  }

  snapshot(): {
    attemptedSubrequests: number;
    hardLimit: number;
    phaseTotals: Record<WorkerSubrequestPhase, number>;
  } {
    return {
      attemptedSubrequests: this.attemptedSubrequests,
      hardLimit: WORKER_SUBREQUEST_HARD_LIMIT,
      phaseTotals: { ...this.phaseTotals },
    };
  }

  logCompletion(): void {
    console.info('[Worker Subrequest Budget] completed', {
      invocationKind: this.invocationKind,
      operation: this.operation,
      ...this.snapshot(),
    });
  }
}
