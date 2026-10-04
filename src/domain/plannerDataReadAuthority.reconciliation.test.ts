import { describe, expect, it } from 'vitest';
import { PlannerDataReadAuthority } from './plannerDataReadAuthority';

const T = (n: number) => `2026-10-04T16:00:${String(n).padStart(2, '0')}.000Z`;
function ready() {
  const authority = new PlannerDataReadAuthority();
  const load = authority.begin('A', T(0));
  authority.succeed(load.token, T(1));
  return authority;
}
function requested() {
  const authority = ready();
  authority.requireActualMaterialReconciliation(authority.captureOwnerScope()!, T(2));
  return authority;
}
function reading() {
  const authority = requested();
  const ticket = authority.beginReconciliation(authority.captureOwnerScope()!, T(3))!;
  return { authority, ticket };
}

const obsoletingEvents: Array<[string, (authority: PlannerDataReadAuthority) => void]> = [
  ['owner change', a => { a.begin('B', T(4)); }],
  ['reset', a => { a.reset(); }],
  ['A-B-A', a => { a.begin('B', T(4)); a.begin('A', T(5)); }],
  ['new concern', a => { a.requireActualMaterialReconciliation(a.captureOwnerScope()!, T(4)); }],
  ['accepted full load', a => { a.succeed(a.begin('A', T(4)).token, T(5)); }],
  ['failed full load', a => { a.fail(a.begin('A', T(4)).token, T(5)); }],
];

describe('PlannerDataReadAuthority independent full health and Actual/material recovery', () => {
  for (const method of ['acceptReconciliation', 'failReconciliation'] as const) {
    it.each(obsoletingEvents)(`${method} ignores %s-obsoleted completions`, (_name, change) => {
      const { authority, ticket } = reading();
      change(authority);
      const before = authority.readSnapshot();
      expect(authority[method](ticket, T(6))).toBe(false);
      expect(authority.readSnapshot()).toEqual(before);
    });
  }

  it('does not manufacture first full success through a successful partial recovery', () => {
    const authority = new PlannerDataReadAuthority();
    expect(authority.read().status).toBe('idle');
    authority.fail(authority.begin('A', T(0)).token, T(1));
    authority.requireActualMaterialReconciliation(authority.captureOwnerScope()!, T(2));
    const ticket = authority.beginReconciliation(authority.captureOwnerScope()!, T(3))!;
    expect(authority.acceptReconciliation(ticket, T(4))).toBe(true);
    expect(authority.read()).toMatchObject({ status: 'unavailable', lastSuccessfulAt: null });
    expect(authority.readSnapshot().recovery).toMatchObject({ reason: 'full-read', canRetry: true });
  });

  it('blocks a retained ready lease while waiting, reading and after a successful repair', () => {
    const authority = ready();
    const retained = authority.captureProjectionLease()!;
    const captured = authority.read();
    authority.requireActualMaterialReconciliation(retained, T(2));
    expect(captured.status).toBe('ready');
    expect(authority.isProjectionUsable(retained)).toBe(false);
    expect(authority.readSnapshot().recovery).toEqual({ ownerId: 'A', reason: 'actual-material', phase: 'waiting', canRetry: false });
    const ticket = authority.beginReconciliation(retained, T(3))!;
    expect(authority.readSnapshot().recovery?.phase).toBe('refreshing');
    expect(authority.isProjectionUsable(retained)).toBe(false);
    expect(authority.acceptReconciliation(ticket, T(4))).toBe(true);
    expect(authority.read()).toMatchObject({ status: 'ready', lastSuccessfulAt: T(1) });
    expect(authority.readSnapshot().recovery).toBeNull();
    expect(authority.acceptReconciliation(ticket, T(5))).toBe(false);
    expect(authority.isProjectionUsable(retained)).toBe(false);
    expect(authority.isProjectionUsable(authority.captureProjectionLease()!)).toBe(true);
  });

  it('latches a stable target failure until one explicit retry, without changing full timestamp', () => {
    const { authority, ticket } = reading();
    const scope = authority.captureOwnerScope()!;
    const revision = authority.captureProjectionLease()!.acceptedRevision;
    expect(authority.failReconciliation(ticket, T(4))).toBe(true);
    expect(authority.beginReconciliation(scope, T(5))).toBeNull();
    expect(authority.readSnapshot().recovery).toEqual({ ownerId: 'A', reason: 'actual-material', phase: 'failed', canRetry: true });
    expect(authority.retryAction(scope)).toBe('projection');
    expect(authority.retryReconciliation(scope, T(6))).toBe(true);
    expect(authority.retryReconciliation(scope, T(6))).toBe(false);
    const retry = authority.beginReconciliation(scope, T(7))!;
    expect(retry.attemptId).not.toBe(ticket.attemptId);
    expect(authority.failReconciliation(ticket, T(8))).toBe(false);
    expect(authority.captureProjectionLease()!.acceptedRevision).toBe(revision);
    expect(authority.acceptReconciliation(retry, T(9))).toBe(true);
    expect(authority.captureProjectionLease()!.acceptedRevision).toBe(revision + 1);
    expect(authority.read()).toMatchObject({ status: 'ready', lastSuccessfulAt: T(1) });
  });

  it('keeps failed full health stale when a later targeted read succeeds', () => {
    const authority = requested();
    authority.fail(authority.begin('A', T(3)).token, T(4));
    const ticket = authority.beginReconciliation(authority.captureOwnerScope()!, T(5))!;
    authority.acceptReconciliation(ticket, T(6));
    expect(authority.read()).toMatchObject({ status: 'stale', lastSuccessfulAt: T(1) });
    expect(authority.readSnapshot().recovery).toEqual({ ownerId: 'A', reason: 'full-read', phase: 'failed', canRetry: true });
    expect(authority.retryAction(authority.captureOwnerScope()!)).toBe('full');
  });

  it('prioritizes failed full load when both concerns exist and deduplicates a full retry synchronously', () => {
    const { authority, ticket } = reading();
    authority.failReconciliation(ticket, T(4));
    authority.fail(authority.begin('A', T(5)).token, T(6));
    const scope = authority.captureOwnerScope()!;
    expect(authority.readSnapshot().recovery?.reason).toBe('full-read-and-actual-material');
    expect(authority.retryAction(scope)).toBe('full');
    authority.begin('A', T(7));
    expect(authority.retryAction(scope)).toBeNull();
    expect(authority.readSnapshot().recovery?.canRetry).toBe(false);
  });

  it('pauses an active target read on manual full start and stable full success retires all tickets', () => {
    const { authority, ticket } = reading();
    const full = authority.begin('A', T(4));
    expect(authority.isCurrentReconciliation(ticket)).toBe(false);
    expect(authority.beginReconciliation(authority.captureOwnerScope()!, T(5))).toBeNull();
    authority.succeed(full.token, T(6), true);
    expect(authority.read()).toMatchObject({ status: 'ready', lastSuccessfulAt: T(6) });
    expect(authority.readSnapshot().recovery).toBeNull();
    expect(authority.failReconciliation(ticket, T(7))).toBe(false);
  });

  it.each(['existing concern', 'no prior concern', 'new request during full'] as const)('creates a fresh concern after accepted overlapping full replacement: %s', scenario => {
    const authority = scenario === 'no prior concern' ? ready() : requested();
    const scope = authority.captureOwnerScope()!;
    const old = authority.beginReconciliation(scope, T(3));
    const full = authority.begin('A', T(4));
    if (scenario === 'new request during full') authority.requireActualMaterialReconciliation(scope, T(5));
    authority.succeed(full.token, T(6), scenario === 'new request during full');
    expect(authority.read()).toMatchObject({ status: 'stale', lastSuccessfulAt: T(6) });
    expect(authority.readSnapshot().recovery?.phase).toBe('waiting');
    const next = authority.beginReconciliation(scope, T(7))!;
    expect(next).not.toBeNull();
    if (old) { expect(next.requestId).not.toBe(old.requestId); expect(authority.acceptReconciliation(old, T(8))).toBe(false); }
  });

  it('discards read invalidated by activity back to pending without publishing failure', () => {
    const { authority, ticket } = reading();
    expect(authority.discardReconciliation(ticket, T(4))).toBe(true);
    expect(authority.readSnapshot().recovery?.phase).toBe('waiting');
    expect(authority.failReconciliation(ticket, T(5))).toBe(false);
    const next = authority.beginReconciliation(authority.captureOwnerScope()!, T(6))!;
    expect(next.attemptId).not.toBe(ticket.attemptId);
  });

  it.each(['reset', 'A-B-A'] as const)('expires owner requests, retry callbacks and ready leases across %s', scenario => {
    const authority = requested();
    const old = authority.captureProjectionLease()!;
    if (scenario === 'reset') authority.reset(); else authority.begin('B', T(4));
    const full = authority.begin('A', T(5));
    authority.succeed(full.token, T(6));
    const before = authority.readSnapshot();
    expect(authority.isProjectionUsable(old)).toBe(false);
    expect(authority.requireActualMaterialReconciliation(old, T(7))).toBe(false);
    expect(authority.retryReconciliation(old, T(7))).toBe(false);
    expect(authority.retryAction(old)).toBeNull();
    expect(authority.readSnapshot()).toEqual(before);
  });

  it('does not revoke acknowledgment through failed or superseded full loads', () => {
    const authority = ready();
    const lease = authority.captureProjectionLease()!;
    const older = authority.begin('A', T(2));
    const newer = authority.begin('A', T(3));
    expect(authority.succeed(older.token, T(4))).toBeNull();
    authority.fail(newer.token, T(5));
    expect(authority.hasAcceptedProjectionChanged(lease)).toBe(false);
    expect(authority.captureProjectionLease()!.acceptedRevision).toBe(lease.acceptedRevision);
  });
});
