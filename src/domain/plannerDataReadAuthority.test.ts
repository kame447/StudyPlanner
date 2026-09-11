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
