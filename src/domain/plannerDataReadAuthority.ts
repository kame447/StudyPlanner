export type PlannerDataReadStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'unavailable'
  | 'stale';

export type PlannerDataAvailability =
  | {
      status: 'idle';
      ownerId: null;
      observedAt: null;
      lastSuccessfulAt: null;
    }
  | {
      status: 'loading';
      ownerId: string;
      observedAt: string;
      lastSuccessfulAt: string | null;
    }
  | {
      status: 'ready';
      ownerId: string;
      observedAt: string;
      lastSuccessfulAt: string;
    }
  | {
      status: 'unavailable';
      ownerId: string;
      observedAt: string;
      lastSuccessfulAt: null;
    }
  | {
      status: 'stale';
      ownerId: string;
      observedAt: string;
      lastSuccessfulAt: string;
    };

export interface PlannerDataOwnerScope {
  readonly ownerId: string;
  readonly epoch: number;
}

export interface PlannerDataProjectionLease extends PlannerDataOwnerScope {
  readonly acceptedRevision: number;
}

export interface PlannerDataLoadToken extends PlannerDataOwnerScope {
  readonly generation: number;
  readonly requestRevision: number;
}

export interface PlannerDataLoadStart {
  token: PlannerDataLoadToken;
  availability: PlannerDataAvailability;
  ownerChanged: boolean;
}

export type PlannerRepairTarget = 'actual-material' | 'month-events' | 'plans-todos';

// Fixed repair groups, in stable order; tickets never borrow a caller's mutable array.
function repairTargets(...groups: readonly (readonly PlannerRepairTarget[])[]): readonly PlannerRepairTarget[] {
  return Object.freeze((['actual-material', 'month-events', 'plans-todos'] as const).filter(target =>
    groups.some(group => group.includes(target))));
}

export interface PlannerDataReconciliationTicket extends PlannerDataProjectionLease {
  readonly targets: readonly PlannerRepairTarget[];
  readonly generation: number;
  readonly requestId: number;
  readonly attemptId: number;
}

export interface PlannerDataRecovery {
  ownerId: string;
  reason: 'full-read' | 'actual-material' | 'full-read-and-actual-material'
    | 'month-events' | 'plans-todos' | 'projections' | 'full-read-and-projections';
  phase: 'waiting' | 'refreshing' | 'failed';
  canRetry: boolean;
}

export interface PlannerDataReadSnapshot {
  availability: PlannerDataAvailability;
  recovery: PlannerDataRecovery | null;
  projectionLease: PlannerDataProjectionLease | null;
}

type ProjectionConcern = {
  requestId: number;
  targets: readonly PlannerRepairTarget[];
  phase: 'pending' | 'reading' | 'failed';
  attemptId?: number;
};

export function createInitialPlannerDataAvailability(): PlannerDataAvailability {
  return { status: 'idle', ownerId: null, observedAt: null, lastSuccessfulAt: null };
}

export function isPlannerDataReadyForOwner(availability: PlannerDataAvailability, ownerId: string): boolean {
  return availability.status === 'ready' && availability.ownerId === ownerId;
}

/** Full-load health and one repair batch spanning disjoint projection groups. */
export class PlannerDataReadAuthority {
  private ownerId: string | null = null;
  private epoch = 0;
  private generation = 0;
  private requestRevision = 0;
  private attemptId = 0;
  private acceptedRevision = 0;
  private full: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  private concern: ProjectionConcern | null = null;
  private observedAt: string | null = null;
  private lastSuccessfulAt: string | null = null;

  captureOwnerScope(): PlannerDataOwnerScope | null {
    return this.ownerId === null ? null : { ownerId: this.ownerId, epoch: this.epoch };
  }

  isOwnerCurrent(scope: PlannerDataOwnerScope): boolean {
    return scope.ownerId === this.ownerId && scope.epoch === this.epoch;
  }

  captureProjectionLease(): PlannerDataProjectionLease | null {
    const scope = this.captureOwnerScope();
    return scope ? { ...scope, acceptedRevision: this.acceptedRevision } : null;
  }

  hasAcceptedProjectionChanged(lease: PlannerDataProjectionLease): boolean {
    return this.isOwnerCurrent(lease) && lease.acceptedRevision !== this.acceptedRevision;
  }

  isProjectionUsable(lease: PlannerDataProjectionLease): boolean {
    return this.isOwnerCurrent(lease) && lease.acceptedRevision === this.acceptedRevision
      && this.full === 'ready' && this.concern === null;
  }

  read(): PlannerDataAvailability {
    if (this.ownerId === null || this.observedAt === null) return createInitialPlannerDataAvailability();
    const common = { ownerId: this.ownerId, observedAt: this.observedAt };
    if (this.full === 'loading') return { ...common, status: 'loading', lastSuccessfulAt: this.lastSuccessfulAt };
    if (this.full === 'ready' && !this.concern && this.lastSuccessfulAt !== null) {
      return { ...common, status: 'ready', lastSuccessfulAt: this.lastSuccessfulAt };
    }
    return this.lastSuccessfulAt !== null
      ? { ...common, status: 'stale', lastSuccessfulAt: this.lastSuccessfulAt }
      : { ...common, status: 'unavailable', lastSuccessfulAt: null };
  }

  readSnapshot(): PlannerDataReadSnapshot {
    let recovery: PlannerDataRecovery | null = null;
    if (this.ownerId !== null && (this.full !== 'ready' || this.concern !== null)) {
      const fullProblem = this.full === 'loading' || this.full === 'failed';
      const projectionReason = this.concern && this.concern.targets.length > 1
        ? 'projections' : this.concern?.targets[0] ?? 'actual-material';
      recovery = {
        ownerId: this.ownerId,
        reason: fullProblem
          ? this.concern ? projectionReason === 'actual-material' ? 'full-read-and-actual-material' : 'full-read-and-projections' : 'full-read'
          : projectionReason,
        phase: this.full === 'loading' ? 'refreshing' : this.full === 'failed' || this.concern?.phase === 'failed'
          ? 'failed' : this.concern?.phase === 'reading' ? 'refreshing' : 'waiting',
        canRetry: this.full === 'failed' || (this.full !== 'loading' && this.concern?.phase === 'failed'),
      };
    }
    return { availability: this.read(), recovery, projectionLease: this.captureProjectionLease() };
  }

  begin(ownerId: string, observedAt: string): PlannerDataLoadStart {
    const ownerChanged = this.ownerId !== ownerId;
    if (ownerChanged) {
      this.epoch += 1;
      this.ownerId = ownerId;
      this.lastSuccessfulAt = null;
      this.acceptedRevision = 0;
      this.concern = null;
    }
    this.generation += 1;
    this.full = 'loading';
    this.observedAt = observedAt;
    if (this.concern?.phase === 'reading') this.concern = { ...this.concern, phase: 'pending', attemptId: undefined };
    return {
      token: { ownerId, epoch: this.epoch, generation: this.generation, requestRevision: this.requestRevision },
      availability: this.read(), ownerChanged,
    };
  }

  isCurrent(token: PlannerDataLoadToken): boolean {
    return this.isOwnerCurrent(token) && token.generation === this.generation && this.full === 'loading';
  }

  succeed(
    token: PlannerDataLoadToken,
    observedAt: string,
    projectionStable = true,
    overlappingTargets: readonly PlannerRepairTarget[] = [],
  ): PlannerDataAvailability | null {
    if (!this.isCurrent(token)) return null;
    // A full snapshot covers older requests, but cannot discharge requests or
    // declared effects observed while its collection reads were in flight.
    const targets = repairTargets(
      projectionStable ? [] : ['actual-material'],
      overlappingTargets,
      token.requestRevision !== this.requestRevision ? this.concern?.targets ?? [] : [],
    );
    this.full = 'ready';
    this.lastSuccessfulAt = observedAt;
    this.observedAt = observedAt;
    this.acceptedRevision += 1;
    this.concern = null;
    // Retire all prior tickets, and atomically express new overlap evidence.
    if (targets.length) this.requireReconciliation(token, observedAt, targets);
    return this.read();
  }

  fail(token: PlannerDataLoadToken, observedAt: string): PlannerDataAvailability | null {
    if (!this.isCurrent(token)) return null;
    this.full = 'failed';
    this.observedAt = observedAt;
    return this.read();
  }

  requireActualMaterialReconciliation(scope: PlannerDataOwnerScope, observedAt: string): boolean {
    return this.requireReconciliation(scope, observedAt, ['actual-material']);
  }

  requireReconciliation(scope: PlannerDataOwnerScope, observedAt: string, requested: readonly PlannerRepairTarget[]): boolean {
    if (!this.isOwnerCurrent(scope) || !requested.length) return false;
    const targets = repairTargets(this.concern?.targets ?? [], requested);
    this.concern = { requestId: ++this.requestRevision, targets, phase: 'pending' };
    this.observedAt = observedAt;
    return true;
  }

  beginReconciliation(scope: PlannerDataOwnerScope, observedAt: string): PlannerDataReconciliationTicket | null {
    if (!this.isOwnerCurrent(scope) || this.full === 'loading' || this.concern?.phase !== 'pending') return null;
    this.concern = { ...this.concern, phase: 'reading', attemptId: ++this.attemptId };
    this.observedAt = observedAt;
    return { ...scope, targets: this.concern.targets, generation: this.generation, requestId: this.concern.requestId,
      attemptId: this.attemptId, acceptedRevision: this.acceptedRevision };
  }

  isCurrentReconciliation(ticket: PlannerDataReconciliationTicket): boolean {
    return this.isOwnerCurrent(ticket) && this.full !== 'loading' && ticket.generation === this.generation
      && this.concern?.phase === 'reading' && this.concern.requestId === ticket.requestId
      && this.concern.attemptId === ticket.attemptId && this.acceptedRevision === ticket.acceptedRevision;
  }

  acceptReconciliation(ticket: PlannerDataReconciliationTicket, observedAt: string): boolean {
    if (!this.isCurrentReconciliation(ticket)) return false;
    this.concern = null;
    this.acceptedRevision += 1;
    this.observedAt = observedAt;
    return true;
  }

  failReconciliation(ticket: PlannerDataReconciliationTicket, observedAt: string): boolean {
    return this.finishAttempt(ticket, observedAt, 'failed');
  }

  discardReconciliation(ticket: PlannerDataReconciliationTicket, observedAt: string): boolean {
    return this.finishAttempt(ticket, observedAt, 'pending');
  }

  private finishAttempt(ticket: PlannerDataReconciliationTicket, observedAt: string, phase: 'pending' | 'failed'): boolean {
    if (!this.isCurrentReconciliation(ticket)) return false;
    this.concern = { requestId: ticket.requestId, targets: ticket.targets, phase };
    this.observedAt = observedAt;
    return true;
  }

  retryAction(scope: PlannerDataOwnerScope): 'full' | 'projection' | null {
    if (!this.isOwnerCurrent(scope) || this.full === 'loading') return null;
    if (this.full === 'failed') return 'full';
    return this.concern?.phase === 'failed' ? 'projection' : null;
  }

  retryReconciliation(scope: PlannerDataOwnerScope, observedAt: string): boolean {
    if (!this.isOwnerCurrent(scope) || this.full === 'loading' || this.concern?.phase !== 'failed') return false;
    this.concern = { requestId: this.concern.requestId, targets: this.concern.targets, phase: 'pending' };
    this.observedAt = observedAt;
    return true;
  }

  reset(): PlannerDataAvailability {
    this.epoch += 1;
    this.generation += 1;
    this.ownerId = null;
    this.full = 'idle';
    this.concern = null;
    this.observedAt = null;
    this.lastSuccessfulAt = null;
    this.acceptedRevision = 0;
    return this.read();
  }
}
