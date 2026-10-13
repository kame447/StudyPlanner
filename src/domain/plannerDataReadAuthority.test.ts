import { describe, expect, it } from 'vitest';
import {
  PlannerDataReadAuthority,
  createInitialPlannerDataAvailability,
  isPlannerDataReadyForOwner,
} from './plannerDataReadAuthority';

describe('PlannerDataReadAuthority', () => {
  it('distinguishes authoritative empty readiness from first-load unavailability', () => {
    const authority = new PlannerDataReadAuthority();
    expect(authority.read()).toEqual(createInitialPlannerDataAvailability());

    const first = authority.begin('owner-a', '2026-08-31T09:00:00.000Z');
    expect(authority.fail(first.token, '2026-08-31T09:00:01.000Z')).toMatchObject({
      status: 'unavailable',
      ownerId: 'owner-a',
      lastSuccessfulAt: null,
    });
    expect(isPlannerDataReadyForOwner(authority.read(), 'owner-a')).toBe(false);

    const retry = authority.begin('owner-a', '2026-08-31T09:01:00.000Z');
    expect(authority.succeed(retry.token, '2026-08-31T09:01:01.000Z')).toMatchObject({
      status: 'ready',
      ownerId: 'owner-a',
      lastSuccessfulAt: '2026-08-31T09:01:01.000Z',
    });
    expect(isPlannerDataReadyForOwner(authority.read(), 'owner-a')).toBe(true);
  });

  it('marks a failed refresh stale after any same-owner successful load', () => {
    const authority = new PlannerDataReadAuthority();
    const first = authority.begin('owner-a', '2026-08-31T09:00:00.000Z');
    authority.succeed(first.token, '2026-08-31T09:00:01.000Z');

    const refresh = authority.begin('owner-a', '2026-08-31T09:05:00.000Z');
    expect(refresh.availability).toMatchObject({
      status: 'loading',
      lastSuccessfulAt: '2026-08-31T09:00:01.000Z',
    });
    expect(authority.fail(refresh.token, '2026-08-31T09:05:01.000Z')).toMatchObject({
      status: 'stale',
      ownerId: 'owner-a',
      lastSuccessfulAt: '2026-08-31T09:00:01.000Z',
    });
  });

  it('does not carry successful authority across owners', () => {
    const authority = new PlannerDataReadAuthority();
    const first = authority.begin('owner-a', '2026-08-31T09:00:00.000Z');
    authority.succeed(first.token, '2026-08-31T09:00:01.000Z');

    const nextOwner = authority.begin('owner-b', '2026-08-31T09:10:00.000Z');
    expect(nextOwner.ownerChanged).toBe(true);
    expect(nextOwner.availability).toMatchObject({
      status: 'loading',
      ownerId: 'owner-b',
      lastSuccessfulAt: null,
    });
    expect(authority.fail(nextOwner.token, '2026-08-31T09:10:01.000Z')).toMatchObject({
      status: 'unavailable',
      ownerId: 'owner-b',
      lastSuccessfulAt: null,
    });
  });

  it('rejects late completion from an older overlapping load', () => {
    const authority = new PlannerDataReadAuthority();
    const older = authority.begin('owner-a', '2026-08-31T09:00:00.000Z');
    const newer = authority.begin('owner-a', '2026-08-31T09:00:01.000Z');

    expect(authority.isCurrent(older.token)).toBe(false);
    expect(authority.succeed(older.token, '2026-08-31T09:00:02.000Z')).toBeNull();
    expect(authority.read().status).toBe('loading');

    expect(authority.succeed(newer.token, '2026-08-31T09:00:03.000Z')).toMatchObject({
      status: 'ready',
      ownerId: 'owner-a',
    });
  });

  it('invalidates an in-flight load on reset', () => {
    const authority = new PlannerDataReadAuthority();
    const inFlight = authority.begin('owner-a', '2026-08-31T09:00:00.000Z');

    expect(authority.reset()).toEqual(createInitialPlannerDataAvailability());
    expect(authority.isCurrent(inFlight.token)).toBe(false);
    expect(authority.fail(inFlight.token, '2026-08-31T09:00:01.000Z')).toBeNull();
    expect(authority.read()).toEqual(createInitialPlannerDataAvailability());
  });
});

it('admits local mutation only from an accepted current lease, including a clean in-flight refresh', () => {
  const authority = new PlannerDataReadAuthority();
  const load = authority.begin('owner', '2026-10-13T00:00:00Z');
  const unread = authority.captureProjectionLease()!;
  expect(authority.canAdmitMutationFromProjection(unread, ['plans-todos'])).toBe(false);
  authority.succeed(load.token, '2026-10-13T00:00:01Z');
  const accepted = authority.captureProjectionLease()!;
  expect(authority.canAdmitMutationFromProjection(unread, ['plans-todos'])).toBe(false);
  expect(authority.canAdmitMutationFromProjection(accepted, ['plans-todos'])).toBe(true);
  const refresh = authority.begin('owner', '2026-10-13T00:00:02Z');
  expect(authority.isProjectionUsable(accepted)).toBe(false);
  expect(authority.canAdmitMutationFromProjection(accepted, ['plans-todos'])).toBe(true);
  authority.fail(refresh.token, '2026-10-13T00:00:03Z');
  expect(authority.canAdmitMutationFromProjection(accepted, ['plans-todos'])).toBe(false);
  const retry = authority.begin('owner', '2026-10-13T00:00:04Z');
  expect(authority.canAdmitMutationFromProjection(accepted, ['plans-todos'])).toBe(false);
  authority.succeed(retry.token, '2026-10-13T00:00:05Z');
  expect(authority.canAdmitMutationFromProjection(accepted, ['plans-todos'])).toBe(false);
  const current = authority.captureProjectionLease()!;
  expect(authority.canAdmitMutationFromProjection(current, ['plans-todos'])).toBe(true);
  authority.begin('other-owner', '2026-10-13T00:00:06Z');
  expect(authority.canAdmitMutationFromProjection(current, ['plans-todos'])).toBe(false);
});

it.each(['pending', 'reading', 'failed'] as const)('blocks a known Todo repair in %s phase, including a later full read', phase => {
  const authority = new PlannerDataReadAuthority();
  const load = authority.begin('owner', '2026-10-13T00:00:00Z');
  authority.succeed(load.token, '2026-10-13T00:00:01Z');
  const lease = authority.captureProjectionLease()!;
  authority.requireReconciliation(lease, '2026-10-13T00:00:02Z', ['plans-todos']);
  if (phase !== 'pending') {
    const ticket = authority.beginReconciliation(lease, '2026-10-13T00:00:03Z')!;
    if (phase === 'failed') authority.failReconciliation(ticket, '2026-10-13T00:00:04Z');
  }
  expect(authority.canAdmitMutationFromProjection(lease, ['plans-todos'])).toBe(false);
  authority.begin('owner', '2026-10-13T00:00:05Z');
  expect(authority.canAdmitMutationFromProjection(lease, ['plans-todos'])).toBe(false);
});

it('keeps an unrelated repair separate from Todo mutation admission', () => {
  const authority = new PlannerDataReadAuthority();
  const load = authority.begin('owner', '2026-10-13T00:00:00Z');
  authority.succeed(load.token, '2026-10-13T00:00:01Z');
  const lease = authority.captureProjectionLease()!;
  authority.requireReconciliation(lease, '2026-10-13T00:00:02Z', ['day-notes']);
  expect(authority.canAdmitMutationFromProjection(lease, ['plans-todos'])).toBe(true);
  expect(authority.canAdmitMutationFromProjection(lease, ['day-notes'])).toBe(false);
  authority.requireReconciliation(lease, '2026-10-13T00:00:03Z', ['plans-todos']);
  expect(authority.canAdmitMutationFromProjection(lease, ['plans-todos'])).toBe(false);
});
