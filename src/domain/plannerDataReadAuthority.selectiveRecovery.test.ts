import { describe, expect, it } from 'vitest';
import {
  PlannerDataReadAuthority,
  type PlannerRepairTarget,
} from './plannerDataReadAuthority';

const BOTH: readonly PlannerRepairTarget[] = ['actual-material', 'month-events'];
const orders: [PlannerRepairTarget, PlannerRepairTarget][] = [
  ['actual-material', 'month-events'],
  ['month-events', 'actual-material'],
];
const sorted = (targets: readonly PlannerRepairTarget[]) => [...targets].sort();
function ready() {
  const authority = new PlannerDataReadAuthority();
  authority.succeed(authority.begin('owner', 'initial start').token, 'initial success');
  return authority;
}

// Target ordering is deliberately not contractual. Every check below compares
// sets, while requiring each ticket to retain its own readonly target snapshot.
describe('selective repair authority target-batch contract', () => {
  for (const phase of ['pending', 'reading', 'failed'] as const) {
    it.each(orders)(`retains %s when %s is requested from ${phase}`, (first, second) => {
      const authority = ready();
      const scope = authority.captureOwnerScope()!;
      authority.requireReconciliation(scope, 'first request', [first]);
      const old = phase === 'pending' ? null : authority.beginReconciliation(scope, 'first read')!;
      if (phase === 'failed') authority.failReconciliation(old!, 'first failure');
      authority.requireReconciliation(scope, 'second request', [second]);
      const next = authority.beginReconciliation(scope, 'union read')!;
      expect(sorted(next.targets)).toEqual(sorted(BOTH));
      if (old) {
        expect(old.targets).toEqual([first]);
        expect(authority.acceptReconciliation(old, 'obsolete accept')).toBe(false);
        expect(authority.failReconciliation(old, 'obsolete failure')).toBe(false);
      }
      expect(authority.read().status).toBe('stale');
      expect(authority.acceptReconciliation(next, 'union success')).toBe(true);
      expect(authority.read()).toMatchObject({ status: 'ready', lastSuccessfulAt: 'initial success' });
    });
  }

  it('copies caller input and never mutates a previously issued ticket target snapshot', () => {
    const authority = ready();
    const scope = authority.captureOwnerScope()!;
    const requested: PlannerRepairTarget[] = ['month-events'];
    authority.requireReconciliation(scope, 'requested', requested);
    requested.push('actual-material');
    const old = authority.beginReconciliation(scope, 'read')!;
    expect(old.targets).toEqual(['month-events']);
    authority.requireReconciliation(scope, 'new evidence', ['actual-material']);
    const next = authority.beginReconciliation(scope, 'new read')!;
    expect(old.targets).toEqual(['month-events']);
    expect(sorted(next.targets)).toEqual(sorted(BOTH));
    expect(next.targets).not.toBe(old.targets);
  });

  it.each([
    ['actual/material', ['actual-material']],
    ['month', ['month-events']],
    ['both', BOTH],
  ] as const)('failure and explicit retry preserve the complete %s target batch', (_name, targets) => {
    const authority = ready();
    const scope = authority.captureOwnerScope()!;
    const revision = authority.captureProjectionLease()!.acceptedRevision;
    authority.requireReconciliation(scope, 'request', targets);
    const first = authority.beginReconciliation(scope, 'read')!;
    expect(authority.failReconciliation(first, 'failed')).toBe(true);
    expect(authority.beginReconciliation(scope, 'ordinary pump')).toBeNull();
    expect(authority.readSnapshot().recovery).toMatchObject({ phase: 'failed', canRetry: true });
    expect(authority.captureProjectionLease()!.acceptedRevision).toBe(revision);
    expect(authority.retryAction(scope)).toBe('projection');
    expect(authority.retryReconciliation(scope, 'retry')).toBe(true);
    expect(authority.retryReconciliation(scope, 'duplicate retry')).toBe(false);
    const retry = authority.beginReconciliation(scope, 'retry read')!;
    expect(sorted(retry.targets)).toEqual(sorted(targets));
    expect(retry.attemptId).not.toBe(first.attemptId);
    expect(authority.acceptReconciliation(first, 'late accept')).toBe(false);
    expect(authority.acceptReconciliation(retry, 'success')).toBe(true);
    expect(authority.read()).toMatchObject({ status: 'ready', lastSuccessfulAt: 'initial success' });
  });

  it('discarding an activity-invalidated attempt retains the entire union for the next attempt', () => {
    const authority = ready();
    const scope = authority.captureOwnerScope()!;
    authority.requireReconciliation(scope, 'request', BOTH);
    const old = authority.beginReconciliation(scope, 'read')!;
    expect(authority.discardReconciliation(old, 'writer crossed')).toBe(true);
    const next = authority.beginReconciliation(scope, 'quiescent read')!;
    expect(sorted(next.targets)).toEqual(sorted(BOTH));
    expect(next.attemptId).not.toBe(old.attemptId);
    expect(authority.failReconciliation(old, 'late failure')).toBe(false);
  });

  it('full-load start retires a union ticket without losing its targets if that full read fails', () => {
    const authority = ready();
    const scope = authority.captureOwnerScope()!;
    authority.requireReconciliation(scope, 'request', BOTH);
    const old = authority.beginReconciliation(scope, 'target read')!;
    const full = authority.begin('owner', 'full start');
    expect(authority.isCurrentReconciliation(old)).toBe(false);
    expect(authority.beginReconciliation(scope, 'while full')).toBeNull();
    authority.fail(full.token, 'full failure');
    const next = authority.beginReconciliation(scope, 'after full failure')!;
    expect(sorted(next.targets)).toEqual(sorted(BOTH));
    expect(authority.acceptReconciliation(next, 'target success')).toBe(true);
    expect(authority.read()).toMatchObject({ status: 'stale', lastSuccessfulAt: 'initial success' });
    expect(authority.retryAction(scope)).toBe('full');
    expect(authority.failReconciliation(old, 'late old failure')).toBe(false);
  });

  it.each(['pending', 'reading', 'failed'] as const)('stable full success discharges the older covered %s union', phase => {
    const authority = ready();
    const scope = authority.captureOwnerScope()!;
    authority.requireReconciliation(scope, 'older request', BOTH);
    const old = phase === 'pending' ? null : authority.beginReconciliation(scope, 'older read')!;
    if (phase === 'failed') authority.failReconciliation(old!, 'older failure');
    const full = authority.begin('owner', 'covering full');
    authority.succeed(full.token, 'covering full success', true, []);
    expect(authority.read()).toMatchObject({ status: 'ready', lastSuccessfulAt: 'covering full success' });
    expect(authority.readSnapshot().recovery).toBeNull();
    expect(authority.beginReconciliation(scope, 'no pending target')).toBeNull();
    if (old) expect(authority.acceptReconciliation(old, 'late result')).toBe(false);
  });

  it.each(orders)('full acceptance retains older %s unioned with newer %s requests', (older, newer) => {
    const authority = ready();
    const scope = authority.captureOwnerScope()!;
    authority.requireReconciliation(scope, 'older request', [older]);
    const old = authority.beginReconciliation(scope, 'old target read')!;
    const full = authority.begin('owner', 'full start');
    authority.requireReconciliation(scope, 'during full', [newer]);
    authority.succeed(full.token, 'full success', true, []);
    expect(authority.read().status).toBe('stale');
    const next = authority.beginReconciliation(scope, 'retained read')!;
    expect(sorted(next.targets)).toEqual(sorted(BOTH));
    expect(authority.acceptReconciliation(old, 'old target result')).toBe(false);
  });

  it('successful MonthEvent evidence alone requests only MonthEvents from an otherwise stable full acceptance', () => {
    const authority = ready();
    const full = authority.begin('owner', 'full start');
    authority.succeed(full.token, 'full success', true, ['month-events']);
    const ticket = authority.beginReconciliation(authority.captureOwnerScope()!, 'read')!;
    expect(ticket.targets).toEqual(['month-events']);
  });

  it('combines crossed successful groups with the conservative global activity requirement', () => {
    const authority = ready();
    const full = authority.begin('owner', 'full start');
    authority.succeed(full.token, 'full success', false, ['month-events', 'month-events']);
    const ticket = authority.beginReconciliation(authority.captureOwnerScope()!, 'read')!;
    expect(sorted(ticket.targets)).toEqual(sorted(BOTH));
  });

  it.each([false, true])('MonthEvent-only target success cannot repair failed full health: priorSuccess=%s', priorSuccess => {
    const authority = priorSuccess ? ready() : new PlannerDataReadAuthority();
    authority.fail(authority.begin('owner', 'full start').token, 'full failure');
    const scope = authority.captureOwnerScope()!;
    authority.requireReconciliation(scope, 'month request', ['month-events']);
    const ticket = authority.beginReconciliation(scope, 'month read')!;
    expect(authority.acceptReconciliation(ticket, 'month success')).toBe(true);
    expect(authority.read()).toMatchObject({
      status: priorSuccess ? 'stale' : 'unavailable',
      lastSuccessfulAt: priorSuccess ? 'initial success' : null,
    });
    expect(authority.readSnapshot().recovery).toMatchObject({ reason: 'full-read', phase: 'failed', canRetry: true });
    expect(authority.retryAction(scope)).toBe('full');
  });

  it.each(['reset', 'A-B-A'] as const)('old MonthEvent requests cannot contaminate a current same-name owner after %s', scenario => {
    const authority = ready();
    const old = authority.captureOwnerScope()!;
    if (scenario === 'reset') authority.reset();
    else authority.begin('other', 'other owner');
    authority.succeed(authority.begin('owner', 'new owner full').token, 'new owner success');
    const before = authority.readSnapshot();
    expect(authority.requireReconciliation(old, 'old month request', ['month-events'])).toBe(false);
    expect(authority.readSnapshot()).toEqual(before);
  });
});
