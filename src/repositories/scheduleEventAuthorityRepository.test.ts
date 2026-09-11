import { describe, expect, it, vi } from 'vitest';
import type { MonthEvent, Plan } from '../types/domain';
import type { PlannerRepository } from './repositoryContracts';
import {
  ScheduleEventMigrationCapabilityUnavailableError,
  createScheduleEventBackedPlannerRepository,
  type ScheduleEventAuthorityRepository,
} from './scheduleEventAuthorityRepository';

const legacyPlan = {
  id: 'plan-1',
  userId: 'user-1',
  title: 'legacy',
} as Plan;
const canonicalPlan = {
  ...legacyPlan,
  title: 'canonical',
} as Plan;

function legacyRepository(): PlannerRepository {
  return {
    getPlans: vi.fn().mockResolvedValue([legacyPlan]),
    getMonthEvents: vi.fn().mockResolvedValue([]),
    upsertPlan: vi.fn(async (plan: Plan) => plan),
  } as unknown as PlannerRepository;
}

function authorityRepository(): ScheduleEventAuthorityRepository {
  return {
    ensureMigrated: vi.fn().mockResolvedValue(undefined),
    getPlans: vi.fn().mockResolvedValue([canonicalPlan]),
    getMonthEvents: vi.fn().mockResolvedValue([]),
    applyRecurringPlanMutation: vi.fn().mockResolvedValue(undefined),
    deletePlanWithDependents: vi.fn().mockResolvedValue(undefined),
    restorePlanWithDependents: vi.fn().mockResolvedValue(undefined),
    scheduleTodoPlan: vi.fn().mockResolvedValue(undefined),
    upsertPlan: vi.fn(async (plan: Plan) => plan),
    deletePlan: vi.fn().mockResolvedValue(undefined),
    upsertMonthEvent: vi.fn(async (event: MonthEvent) => event),
    deleteMonthEvent: vi.fn().mockResolvedValue(undefined),
  };
}

describe('ScheduleEvent-backed planner rollout compatibility', () => {
  it('uses the legacy authority only while the migration capability is unavailable', async () => {
    const legacy = legacyRepository();
    const authority = authorityRepository();
    vi.mocked(authority.ensureMigrated).mockRejectedValueOnce(
      new ScheduleEventMigrationCapabilityUnavailableError(),
    );
    const repository = createScheduleEventBackedPlannerRepository(legacy, authority);

    await expect(repository.getPlans('user-1')).resolves.toEqual([legacyPlan]);

    expect(legacy.getPlans).toHaveBeenCalledTimes(1);
    expect(authority.getPlans).not.toHaveBeenCalled();
  });

  it('retries migration after a rollout-compatibility fallback and switches to canonical authority', async () => {
    const legacy = legacyRepository();
    const authority = authorityRepository();
    vi.mocked(authority.ensureMigrated)
      .mockRejectedValueOnce(new ScheduleEventMigrationCapabilityUnavailableError())
      .mockResolvedValueOnce(undefined);
    const repository = createScheduleEventBackedPlannerRepository(legacy, authority);

    await expect(repository.getPlans('user-1')).resolves.toEqual([legacyPlan]);
    await expect(repository.getPlans('user-1')).resolves.toEqual([canonicalPlan]);

    expect(authority.ensureMigrated).toHaveBeenCalledTimes(2);
    expect(authority.getPlans).toHaveBeenCalledTimes(1);
  });

  it('routes a write to legacy storage during the rollout window without dual-writing', async () => {
    const legacy = legacyRepository();
    const authority = authorityRepository();
    vi.mocked(authority.ensureMigrated).mockRejectedValueOnce(
      new ScheduleEventMigrationCapabilityUnavailableError(),
    );
    const repository = createScheduleEventBackedPlannerRepository(legacy, authority);

    await repository.upsertPlan(legacyPlan);

    expect(legacy.upsertPlan).toHaveBeenCalledWith(legacyPlan);
    expect(authority.upsertPlan).not.toHaveBeenCalled();
  });

  it('does not hide a real migration failure behind legacy fallback', async () => {
    const legacy = legacyRepository();
    const authority = authorityRepository();
    vi.mocked(authority.ensureMigrated).mockRejectedValueOnce(
      new Error('canonical verification failed'),
    );
    const repository = createScheduleEventBackedPlannerRepository(legacy, authority);

    await expect(repository.getPlans('user-1')).rejects.toThrow(
      'canonical verification failed',
    );

    expect(legacy.getPlans).not.toHaveBeenCalled();
    expect(authority.getPlans).not.toHaveBeenCalled();
  });
});
