import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import {
  ScheduleEventMigrationCapabilityUnavailableError,
  type LegacyScheduleSnapshot,
  type ScheduleEventAuthorityRepository,
} from './scheduleEventAuthorityRepository';

const mocks = vi.hoisted(() => ({
  doc: vi.fn((_db, collectionName, id) => ({ collectionName, id })),
  getDoc: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: mocks.doc,
  getDoc: mocks.getDoc,
}));

vi.mock('../lib/firebaseClient', () => ({
  getFirebaseAuth: vi.fn(),
  getFirestoreDb: vi.fn(),
}));

vi.mock('./firebaseScheduleEventAuthority', () => ({
  createFirebaseScheduleEventAuthority: vi.fn(),
}));

import { createRolloutCompatibleFirebaseScheduleEventAuthority } from './firebaseRepositories';

function authorityRepository(): ScheduleEventAuthorityRepository {
  return {
    ensureMigrated: vi.fn().mockResolvedValue(undefined),
    getPlans: vi.fn().mockResolvedValue([]),
    getMonthEvents: vi.fn().mockResolvedValue([]),
    applyRecurringPlanMutation: vi.fn().mockResolvedValue(undefined),
    deletePlanWithDependents: vi.fn().mockResolvedValue(undefined),
    restorePlanWithDependents: vi.fn().mockResolvedValue(undefined),
    scheduleTodoPlan: vi.fn().mockResolvedValue(undefined),
    upsertPlan: vi.fn(),
    deletePlan: vi.fn().mockResolvedValue(undefined),
    upsertMonthEvent: vi.fn(),
    deleteMonthEvent: vi.fn().mockResolvedValue(undefined),
  } as ScheduleEventAuthorityRepository;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Firebase ScheduleEvent rollout capability probe', () => {
  it('classifies an old-Rules migration-marker denial as rollout capability unavailable', async () => {
    mocks.getDoc.mockRejectedValueOnce({
      code: 'permission-denied',
      message: 'Missing or insufficient permissions.',
    });
    const authority = authorityRepository();
    const rolloutAuthority = createRolloutCompatibleFirebaseScheduleEventAuthority(
      {} as Firestore,
      authority,
    );
    const loadLegacy = vi.fn<() => Promise<LegacyScheduleSnapshot>>();

    await expect(
      rolloutAuthority.ensureMigrated('user-1', loadLegacy),
    ).rejects.toBeInstanceOf(ScheduleEventMigrationCapabilityUnavailableError);

    expect(mocks.doc).toHaveBeenCalledWith(
      expect.anything(),
      'schedule_event_migrations',
      'user-1',
    );
    expect(authority.ensureMigrated).not.toHaveBeenCalled();
  });

  it('delegates to the canonical migration only after the marker collection is readable', async () => {
    mocks.getDoc.mockResolvedValueOnce({ exists: () => false });
    const authority = authorityRepository();
    const rolloutAuthority = createRolloutCompatibleFirebaseScheduleEventAuthority(
      {} as Firestore,
      authority,
    );
    const loadLegacy = vi.fn().mockResolvedValue({ plans: [], monthEvents: [] });

    await rolloutAuthority.ensureMigrated('user-1', loadLegacy);

    expect(authority.ensureMigrated).toHaveBeenCalledWith('user-1', loadLegacy);
  });

  it('does not downgrade non-permission probe failures into legacy compatibility', async () => {
    mocks.getDoc.mockRejectedValueOnce(new Error('network unavailable'));
    const authority = authorityRepository();
    const rolloutAuthority = createRolloutCompatibleFirebaseScheduleEventAuthority(
      {} as Firestore,
      authority,
    );

    await expect(
      rolloutAuthority.ensureMigrated('user-1', vi.fn()),
    ).rejects.toThrow('network unavailable');

    expect(authority.ensureMigrated).not.toHaveBeenCalled();
  });
});
