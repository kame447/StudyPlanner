import { prepareActualProgressSource } from '../domain/actualProgressSource';
import { assertRecurringMonthEventWrite } from './plannerWritePreparation';
import type { StartupSessionCapability } from '../lib/startupSessionScope';
import type { RecurringPlanMutation } from '../domain/recurringPlanMutation';
import type { MonthEvent, Plan } from '../types/domain';
import type {
  PlanDeleteWithDependentsMutation,
  PlanRestoreWithDependentsMutation,
  PlannerRepository,
  PlannerScheduleSnapshot,
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
  observeStartupScheduleMarker?(expectedOwner: string, scope: StartupSessionCapability): () => void;
  ensureMigrated(
    userId: string,
    loadLegacy: () => Promise<LegacyScheduleSnapshot>,
  ): Promise<void>;
  getScheduleSnapshot(userId: string): Promise<PlannerScheduleSnapshot>;
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
  applyRecurringMonthEventMutation(userId: string, monthEvents: MonthEvent[]): Promise<void>;
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

  async function prepareActual(actual: import('../types/domain').Actual) {
    const actuals = await legacyRepository.getActuals(actual.userId);
    const previous = actuals.find(item => item.id === actual.id && item.userId === actual.userId);
    // Independent study saves do not need schedule migration or a schedule read.
    if (!actual.planId && !previous?.planId) {
      return prepareActualProgressSource(actual, { plans: [], monthEvents: [] }, previous);
    }
    const mode = await resolveSchedulePersistenceMode(actual.userId);
    const sources = mode === 'canonical' ? await authorityRepository.getScheduleSnapshot(actual.userId)
      : await legacyRepository.getScheduleSnapshot(actual.userId);
    const prepared = prepareActualProgressSource(actual, sources, previous);
    if (actual.planId && !prepared.progressSource
      && (!previous || previous.planId !== actual.planId)) {
      throw new Error('紐づけ先の予定が変更または削除されました。再読み込みしてから記録を保存してください。');
    }
    return prepared;
  }

  return {
    ...legacyRepository,
    async upsertActual(actual) {
      return legacyRepository.upsertActual(await prepareActual(actual));
    },
    async upsertActualWithMaterialProgress(mutation) {
      return legacyRepository.upsertActualWithMaterialProgress({
        ...mutation, actual: await prepareActual(mutation.actual),
      });
    },
    observeStartupScheduleMarker: authorityRepository.observeStartupScheduleMarker
      ? (owner, scope) => authorityRepository.observeStartupScheduleMarker!(owner, scope)
      : undefined,
    async getScheduleSnapshot(userId) {
      const mode = await resolveSchedulePersistenceMode(userId);
      return mode === 'canonical'
        ? authorityRepository.getScheduleSnapshot(userId)
        : legacyRepository.getScheduleSnapshot(userId);
    },
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
    async applyRecurringMonthEventMutation(userId, monthEvents) {
      assertRecurringMonthEventWrite(userId, monthEvents);
      const mode = await resolveSchedulePersistenceMode(userId);
      if (mode === 'canonical') {
        await authorityRepository.applyRecurringMonthEventMutation(userId, monthEvents);
        return;
      }
      await legacyRepository.applyRecurringMonthEventMutation(userId, monthEvents);
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
