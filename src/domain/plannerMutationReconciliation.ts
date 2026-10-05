import { PLANNER_REPAIR_TARGETS, PlannerDataReadAuthority, type PlannerDataOwnerScope, type PlannerDataReconciliationTicket, type PlannerDataProjectionLease, type PlannerRepairTarget } from './plannerDataReadAuthority';

export interface PlannerMutationActivity {
  readonly epoch: number;
  readonly started: number;
  readonly settled: number;
  readonly pending: number;
  readonly successful: Readonly<Record<PlannerRepairTarget, number>>;
  readonly planRestorePending: number;
  readonly planRestoreSettled: number;
}
function emptySuccessCounters(): Record<PlannerRepairTarget, number> {
  return Object.fromEntries(PLANNER_REPAIR_TARGETS.map(target => [target, 0])) as Record<PlannerRepairTarget, number>;
}
const PLAN_RESTORE_TARGETS: readonly PlannerRepairTarget[] = Object.freeze(['actual-material', 'plans-todos']);

export interface PlannerMutationTicket { readonly epoch: number; readonly id: symbol }
interface Configuration<T> {
  isCurrent: (ownerId: string) => boolean;
  read: (ownerId: string, targets: readonly PlannerRepairTarget[]) => Promise<T>;
  publish: (snapshot: T) => void;
  changed: () => void;
}

/** Tracks only local writer activity. Read health, owners and tickets belong to the authority. */
export class PlannerMutationReconciliation<T> {
  private ownerId: string | null = null;
  private epoch = 0;
  private started = 0;
  private settled = 0;
  private successful = emptySuccessCounters();
  private planRestoreSettled = 0;
  private pending = new Map<symbol, {
    targets: readonly PlannerRepairTarget[];
    lease: PlannerDataProjectionLease | null;
    planRestore?: true;
  }>();
  private running: { id: symbol; ticket: PlannerDataReconciliationTicket } | null = null;
  private configuration: Configuration<T> | null = null;

  constructor(private readonly authority: PlannerDataReadAuthority, private readonly now = () => new Date().toISOString()) {}

  configure(configuration: Configuration<T>): void { this.configuration = configuration; }

  activateOwner(ownerId: string | null): void {
    if (this.ownerId !== ownerId) this.reset(ownerId);
  }

  reset(ownerId: string | null = this.ownerId): void {
    this.ownerId = ownerId;
    this.epoch += 1;
    this.started = 0;
    this.settled = 0;
    this.successful = emptySuccessCounters();
    this.planRestoreSettled = 0;
    this.pending.clear();
    this.running = null;
  }

  beginMutation(targets: readonly PlannerRepairTarget[] = []): PlannerMutationTicket {
    const id = Symbol('planner mutation');
    this.started += 1;
    this.pending.set(id, { targets: [...new Set(targets)], lease: this.authority.captureProjectionLease() });
    return { epoch: this.epoch, id };
  }

  /** Arm only immediately before dispatch, after caller-owned admission checks.
   * Repository rejection is untyped: either outcome may change the read projection.
   */
  beginPlanRestore(): PlannerMutationTicket {
    const ticket = this.beginMutation();
    this.pending.get(ticket.id)!.planRestore = true;
    return ticket;
  }

  settleMutation(ticket: PlannerMutationTicket, outcome: 'success' | 'failure' = 'failure'): void {
    if (ticket.epoch !== this.epoch) return;
    const mutation = this.pending.get(ticket.id);
    if (!mutation) return;
    // These are local activity observations, never durable commit revisions.
    // Ordinary tags retain success-only semantics; dispatched Plan Undo also
    // retains failure settlement (including rejection after failed compensation).
    let changed = false;
    if (mutation.lease && this.authority.isOwnerCurrent(mutation.lease)) {
      if (outcome === 'success') {
        for (const target of mutation.targets) this.successful[target] += 1;
      }
      if (mutation.planRestore) this.planRestoreSettled += 1;
      const targets = mutation.planRestore ? PLAN_RESTORE_TARGETS : outcome === 'success' ? mutation.targets : [];
      // A dispatched restore rejection has no trusted no-effect receipt. Repair
      // even without a crossing read: failed compensation can leave partial state.
      const needsRepair = (mutation.planRestore && outcome === 'failure')
        || this.authority.hasAcceptedProjectionChanged(mutation.lease);
      if (needsRepair && targets.length && this.configuration?.isCurrent(mutation.lease.ownerId)) {
        changed = this.authority.requireReconciliation(mutation.lease, this.now(), targets);
      }
    }
    this.pending.delete(ticket.id);
    this.settled += 1;
    // Only notify after bookkeeping is complete: an observer may synchronously
    // repeat settlement or reset/activate a new owner epoch.
    if (changed) {
      try { this.configuration?.changed(); } catch { /* The pump still owns recovery. */ }
    }
    this.pump();
  }

  captureActivity(): PlannerMutationActivity {
    return { epoch: this.epoch, started: this.started, settled: this.settled, pending: this.pending.size,
      successful: { ...this.successful },
      planRestorePending: this.pendingPlanRestores(), planRestoreSettled: this.planRestoreSettled };
  }

  successfulTargetsSince(activity: PlannerMutationActivity): readonly PlannerRepairTarget[] {
    if (activity.epoch !== this.epoch) return [];
    return PLANNER_REPAIR_TARGETS.filter(target =>
      activity.successful[target] !== this.successful[target]);
  }

  planRestoreTargetsSince(activity: PlannerMutationActivity): readonly PlannerRepairTarget[] {
    if (activity.epoch !== this.epoch) return [];
    // Cover restores already active at full-read entry, still active at acceptance,
    // and those that start and settle entirely inside the read, even on failure.
    return activity.planRestorePending > 0 || this.pendingPlanRestores() > 0
      || activity.planRestoreSettled !== this.planRestoreSettled ? PLAN_RESTORE_TARGETS : [];
  }

  private pendingPlanRestores(): number {
    return [...this.pending.values()].filter(mutation => mutation.planRestore).length;
  }

  isQuiescentSince(activity: PlannerMutationActivity): boolean {
    return activity.epoch === this.epoch && activity.started === this.started
      && activity.settled === this.settled && activity.pending === 0 && this.pending.size === 0;
  }

  request(scope: PlannerDataOwnerScope, targets: readonly PlannerRepairTarget[] = ['actual-material']): void {
    if (!this.configuration?.isCurrent(scope.ownerId)) return;
    if (this.authority.requireReconciliation(scope, this.now(), targets)) {
      try { this.configuration.changed(); } catch { /* The pump still owns recovery. */ }
    }
    this.pump();
  }

  pump(): void {
    const configuration = this.configuration;
    const scope = this.authority.captureOwnerScope();
    // A superseding full read/request retires the old attempt immediately. Its
    // repository promise may drain, but it cannot hold the new authority hostage.
    if (this.running && !this.authority.isCurrentReconciliation(this.running.ticket)) this.running = null;
    if (!configuration || !scope || scope.ownerId !== this.ownerId
      || !configuration.isCurrent(scope.ownerId) || this.running || this.pending.size > 0) return;
    const ticket = this.authority.beginReconciliation(scope, this.now());
    if (!ticket) return;
    const id = Symbol('planner projection read');
    this.running = { id, ticket };
    const activity = this.captureActivity();
    const current = () => this.running?.id === id && this.configuration?.isCurrent(scope.ownerId)
      && this.authority.isCurrentReconciliation(ticket);
    const failCurrentAttempt = () => {
      if (!current()) return;
      this.authority.failReconciliation(ticket, this.now());
      // A broken observer must not reject an already-successful writer or make
      // this detached attempt an unhandled rejection. Authority stays retryable.
      try { this.configuration!.changed(); } catch { /* Keep the failure latched. */ }
    };
    try { configuration.changed(); } catch {
      failCurrentAttempt();
      if (this.running?.id === id) this.running = null;
      return;
    }
    const discardUnstable = () => {
      if (this.isQuiescentSince(activity)) return false;
      if (this.authority.discardReconciliation(ticket, this.now())) this.configuration?.changed();
      return true;
    };
    // Detached from every writer: reconciliation can never await its own mutation ticket.
    void Promise.resolve().then(async () => {
      if (!current()) return;
      let snapshot: T;
      try {
        snapshot = await configuration.read(scope.ownerId, ticket.targets);
      } catch {
        if (!current() || discardUnstable()) return;
        failCurrentAttempt();
        return;
      }
      if (!current() || discardUnstable()) return;
      // No await between final validation, requested replacements, and authority publication.
      try {
        this.configuration!.publish(snapshot);
      } catch {
        failCurrentAttempt();
        return;
      }
      this.authority.acceptReconciliation(ticket, this.now());
      this.configuration!.changed();
    }).catch(() => {
      // Unexpected observer/publication errors can only fail this live ticket;
      // never resurrect an accepted ticket or alter a superseding owner/read.
      failCurrentAttempt();
    }).finally(() => {
      if (this.running?.id !== id) return;
      this.running = null;
      // Failed concerns stay latched. Only explicit retry/new evidence can re-arm them.
      this.pump();
    });
  }
}
