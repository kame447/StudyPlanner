import type { RecurringPlanMutation } from '../domain/recurringPlanMutation';
import type { MonthEvent, Plan } from '../types/domain';
import type {
  PlanDeleteWithDependentsMutation,
  PlanRestoreWithDependentsMutation,
  PlannerRepository,
  TodoPlanScheduleMutation,
} from './repositoryContracts';

export interface LegacyScheduleSnapshot {
  plans: Plan[];
  monthEvents: MonthEvent[];
}

export class ScheduleEventMigrationCapabilityUnavailableError extends Error {
  constructor(message = 'ScheduleEvent migration capability is unavailable.') {
    super(message);
    this.name = 'ScheduleEventMigrationCapabilityUnavailableError';
  }
}

export interface ScheduleEventAuthorityRepository {
  ensureMigrated(
    userId: string,
    loadLegacy: () => Promise<LegacyScheduleSnapshot>,
  ): Promise<void>;
  getPlans(userId: string): Promise<Plan[]>;
  getMonthEvents(userId: string): Promise<MonthEvent[]>;
  applyRecurringPlanMutation(
    userId: string,
    mutation: RecurringPlanMutation,
  ): Promise<void>;
  deletePlanWithDependents(
    mutation: PlanDeleteWithDependentsMutation,
  ): Promise<void>;
  restorePlanWithDependents(
    mutation: PlanRestoreWithDependentsMutation,
  ): Promise<void>;
  scheduleTodoPlan(mutation: TodoPlanScheduleMutation): Promise<void>;
  upsertPlan(plan: Plan): Promise<Plan>;
  deletePlan(userId: string, planId: string): Promise<void>;
  upsertMonthEvent(monthEvent: MonthEvent): Promise<MonthEvent>;
  deleteMonthEvent(userId: string, monthEventId: string): Promise<void>;
}

type SchedulePersistenceMode = 'canonical' | 'legacy-rollout-compatibility';

export function createScheduleEventBackedPlannerRepository(
  legacyRepository: PlannerRepository,
  authorityRepository: ScheduleEventAuthorityRepository,
): PlannerRepository {
  const migrations = new Map<string, Promise<SchedulePersistenceMode>>();

  const resolveSchedulePersistenceMode = (
    userId: string,
  ): Promise<SchedulePersistenceMode> => {
    const current = migrations.get(userId);
    if (current) return current;

    const migration = authorityRepository
      .ensureMigrated(userId, async () => {
        const [plans, monthEvents] = await Promise.all([
          legacyRepository.getPlans(userId),
          legacyRepository.getMonthEvents(userId),
        ]);
        return { plans, monthEvents };
      })
      .then(() => 'canonical' as const)
      .catch((error: unknown) => {
        migrations.delete(userId);
        if (error instanceof ScheduleEventMigrationCapabilityUnavailableError) {
          return 'legacy-rollout-compatibility' as const;
        }
        throw error;
      });
    migrations.set(userId, migration);
    return migration;
  };

  return {
    ...legacyRepository,
    async getPlans(userId) {
      const mode = await resolveSchedulePersistenceMode(userId);
      return mode === 'canonical'
        ? authorityRepository.getPlans(userId)
        : legacyRepository.getPlans(userId);
    },
    async getMonthEvents(userId) {
      const mode = await resolveSchedulePersistenceMode(userId);
      return mode === 'canonical'
        ? authorityRepository.getMonthEvents(userId)
        : legacyRepository.getMonthEvents(userId);
    },
    async applyRecurringPlanMutation(userId, mutation) {
      const mode = await resolveSchedulePersistenceMode(userId);
      if (mode === 'canonical') {
        await authorityRepository.applyRecurringPlanMutation(userId, mutation);
        return;
      }
      await legacyRepository.applyRecurringPlanMutation(userId, mutation);
    },
    async deletePlanWithDependents(mutation) {
      const mode = await resolveSchedulePersistenceMode(mutation.userId);
      if (mode === 'canonical') {
        await authorityRepository.deletePlanWithDependents(mutation);
        return;
      }
      await legacyRepository.deletePlanWithDependents(mutation);
    },
    async restorePlanWithDependents(mutation) {
      const mode = await resolveSchedulePersistenceMode(mutation.plan.userId);
      if (mode === 'canonical') {
        await authorityRepository.restorePlanWithDependents(mutation);
        return;
      }
      await legacyRepository.restorePlanWithDependents(mutation);
    },
    async scheduleTodoPlan(mutation) {
      const mode = await resolveSchedulePersistenceMode(mutation.plan.userId);
      if (mode === 'canonical') {
        await authorityRepository.scheduleTodoPlan(mutation);
        return;
      }
      await legacyRepository.scheduleTodoPlan(mutation);
    },
    async upsertPlan(plan) {
      const mode = await resolveSchedulePersistenceMode(plan.userId);
      return mode === 'canonical'
        ? authorityRepository.upsertPlan(plan)
        : legacyRepository.upsertPlan(plan);
    },
    async deletePlan(userId, planId) {
      const mode = await resolveSchedulePersistenceMode(userId);
      if (mode === 'canonical') {
        await authorityRepository.deletePlan(userId, planId);
        return;
      }
      await legacyRepository.deletePlan(userId, planId);
    },
    async upsertMonthEvent(monthEvent) {
      const mode = await resolveSchedulePersistenceMode(monthEvent.userId);
      return mode === 'canonical'
        ? authorityRepository.upsertMonthEvent(monthEvent)
        : legacyRepository.upsertMonthEvent(monthEvent);
    },
    async deleteMonthEvent(userId, monthEventId) {
      const mode = await resolveSchedulePersistenceMode(userId);
      if (mode === 'canonical') {
        await authorityRepository.deleteMonthEvent(userId, monthEventId);
        return;
      }
      await legacyRepository.deleteMonthEvent(userId, monthEventId);
    },
  };
}
