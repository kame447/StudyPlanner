import type {
  PlannerRepository,
  PlannerStorageGateway,
} from './repositoryContracts';
import { filterByUserId, replaceById } from './repositoryUtils';

export function createPlannerRepository(
  storageGateway: PlannerStorageGateway,
): PlannerRepository {
  return {
    async getPlans(userId) {
      return filterByUserId(await storageGateway.readPlans(), userId);
    },
    async getActuals(userId) {
      return filterByUserId(await storageGateway.readActuals(), userId);
    },
    async getDayNotes(userId) {
      return filterByUserId(await storageGateway.readDayNotes(), userId);
    },
    async upsertPlan(plan) {
      const nextPlans = replaceById(await storageGateway.readPlans(), plan);
      await storageGateway.writePlans(nextPlans);
      return plan;
    },
    async deletePlan(userId, planId) {
      const plans = (await storageGateway.readPlans()).filter(
        (plan) => !(plan.userId === userId && plan.id === planId),
      );
      const actuals = (await storageGateway.readActuals()).filter(
        (actual) => !(actual.userId === userId && actual.planId === planId),
      );

      await Promise.all([
        storageGateway.writePlans(plans),
        storageGateway.writeActuals(actuals),
      ]);
    },
    async upsertActual(actual) {
      const nextActuals = (await storageGateway.readActuals())
        .filter(
          (item) => !(item.userId === actual.userId && item.planId === actual.planId),
        )
        .concat(actual);

      await storageGateway.writeActuals(nextActuals);
      return actual;
    },
    async deleteActual(userId, actualId) {
      const actuals = (await storageGateway.readActuals()).filter(
        (actual) => !(actual.userId === userId && actual.id === actualId),
      );

      await storageGateway.writeActuals(actuals);
    },
    async upsertDayNote(dayNote) {
      const nextDayNotes = replaceById(
        await storageGateway.readDayNotes(),
        dayNote,
      );

      await storageGateway.writeDayNotes(nextDayNotes);
      return dayNote;
    },
  };
}
