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

export function createScheduleEventBackedPlannerRepository(
  legacyRepository: PlannerRepository,
  authorityRepository: ScheduleEventAuthorityRepository,
): PlannerRepository {
  const migrations = new Map<string, Promise<void>>();

  const ensureMigrated = (userId: string): Promise<void> => {
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
      .catch((error) => {
        migrations.delete(userId);
        throw error;
      });
    migrations.set(userId, migration);
    return migration;
  };

  return {
    ...legacyRepository,
    async getPlans(userId) {
      await ensureMigrated(userId);
      return authorityRepository.getPlans(userId);
    },
    async getMonthEvents(userId) {
      await ensureMigrated(userId);
      return authorityRepository.getMonthEvents(userId);
    },
    async applyRecurringPlanMutation(userId, mutation) {
      await ensureMigrated(userId);
      await authorityRepository.applyRecurringPlanMutation(userId, mutation);
    },
    async deletePlanWithDependents(mutation) {
      await ensureMigrated(mutation.userId);
      await authorityRepository.deletePlanWithDependents(mutation);
    },
    async restorePlanWithDependents(mutation) {
      await ensureMigrated(mutation.plan.userId);
      await authorityRepository.restorePlanWithDependents(mutation);
    },
    async scheduleTodoPlan(mutation) {
      await ensureMigrated(mutation.plan.userId);
      await authorityRepository.scheduleTodoPlan(mutation);
    },
    async upsertPlan(plan) {
      await ensureMigrated(plan.userId);
      return authorityRepository.upsertPlan(plan);
    },
    async deletePlan(userId, planId) {
      await ensureMigrated(userId);
      await authorityRepository.deletePlan(userId, planId);
    },
    async upsertMonthEvent(monthEvent) {
      await ensureMigrated(monthEvent.userId);
      return authorityRepository.upsertMonthEvent(monthEvent);
    },
    async deleteMonthEvent(userId, monthEventId) {
      await ensureMigrated(userId);
      await authorityRepository.deleteMonthEvent(userId, monthEventId);
    },
  };
}
