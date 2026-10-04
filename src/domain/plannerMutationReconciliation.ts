import { PlannerDataReadAuthority, type PlannerDataOwnerScope, type PlannerDataReconciliationTicket } from './plannerDataReadAuthority';

export interface PlannerMutationActivity {
  readonly epoch: number;
  readonly started: number;
  readonly settled: number;
  readonly pending: number;
}
export interface PlannerMutationTicket { readonly epoch: number; readonly id: symbol }
interface Configuration<T> {
  isCurrent: (ownerId: string) => boolean;
  read: (ownerId: string) => Promise<T>;
  publish: (snapshot: T) => void;
  changed: () => void;
}

/** Tracks only local writer activity. Read health, owners and tickets belong to the authority. */
export class PlannerMutationReconciliation<T> {
  private ownerId: string | null = null;
  private epoch = 0;
  private started = 0;
  private settled = 0;
  private pending = new Set<symbol>();
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
    this.pending.clear();
    this.running = null;
  }

  beginMutation(): PlannerMutationTicket {
    const id = Symbol('planner mutation');
    this.started += 1;
    this.pending.add(id);
    return { epoch: this.epoch, id };
  }

  settleMutation(ticket: PlannerMutationTicket): void {
    if (ticket.epoch !== this.epoch || !this.pending.delete(ticket.id)) return;
    this.settled += 1;
    this.pump();
  }

  captureActivity(): PlannerMutationActivity {
    return { epoch: this.epoch, started: this.started, settled: this.settled, pending: this.pending.size };
  }

  isQuiescentSince(activity: PlannerMutationActivity): boolean {
    return activity.epoch === this.epoch && activity.started === this.started
      && activity.settled === this.settled && activity.pending === 0 && this.pending.size === 0;
  }

  request(scope: PlannerDataOwnerScope): void {
    if (!this.configuration?.isCurrent(scope.ownerId)) return;
    if (this.authority.requireActualMaterialReconciliation(scope, this.now())) {
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
    const id = Symbol('actual/material read');
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
        snapshot = await configuration.read(scope.ownerId);
      } catch {
        if (!current() || discardUnstable()) return;
        failCurrentAttempt();
        return;
      }
      if (!current() || discardUnstable()) return;
      // No await between final validation, both replacements, and authority publication.
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
