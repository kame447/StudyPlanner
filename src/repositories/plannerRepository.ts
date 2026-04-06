import { localStorageStore } from './localStorageStore';
import type { Actual, DayNote, Plan } from '../types/domain';

export interface PlannerRepository {
  getPlans(userId: string): Promise<Plan[]>;
  getActuals(userId: string): Promise<Actual[]>;
  getDayNotes(userId: string): Promise<DayNote[]>;
  upsertPlan(plan: Plan): Promise<Plan>;
  deletePlan(userId: string, planId: string): Promise<void>;
  upsertActual(actual: Actual): Promise<Actual>;
  deleteActual(userId: string, actualId: string): Promise<void>;
  upsertDayNote(dayNote: DayNote): Promise<DayNote>;
}

export function createLocalPlannerRepository(): PlannerRepository {
  return {
    async getPlans(userId) {
      return localStorageStore.readPlans().filter(
        (plan) => plan.userId === userId,
      );
    },
    async getActuals(userId) {
      return localStorageStore.readActuals().filter(
        (actual) => actual.userId === userId,
      );
    },
    async getDayNotes(userId) {
      return localStorageStore.readDayNotes().filter(
        (dayNote) => dayNote.userId === userId,
      );
    },
    async upsertPlan(plan) {
      const plans = localStorageStore.readPlans();
      const nextPlans = plans.some((item) => item.id === plan.id)
        ? plans.map((item) => (item.id === plan.id ? plan : item))
        : [...plans, plan];

      localStorageStore.writePlans(nextPlans);
      return plan;
    },
    async deletePlan(userId, planId) {
      const plans = localStorageStore.readPlans().filter(
        (plan) => !(plan.userId === userId && plan.id === planId),
      );
      const actuals = localStorageStore.readActuals().filter(
        (actual) => !(actual.userId === userId && actual.planId === planId),
      );

      localStorageStore.writePlans(plans);
      localStorageStore.writeActuals(actuals);
    },
    async upsertActual(actual) {
      const actuals = localStorageStore.readActuals();
      const nextActuals = actuals
        .filter(
          (item) => !(item.userId === actual.userId && item.planId === actual.planId),
        )
        .concat(actual);

      localStorageStore.writeActuals(nextActuals);
      return actual;
    },
    async deleteActual(userId, actualId) {
      const actuals = localStorageStore.readActuals().filter(
        (actual) => !(actual.userId === userId && actual.id === actualId),
      );

      localStorageStore.writeActuals(actuals);
    },
    async upsertDayNote(dayNote) {
      const dayNotes = localStorageStore.readDayNotes();
      const nextDayNotes = dayNotes.some((item) => item.id === dayNote.id)
        ? dayNotes.map((item) => (item.id === dayNote.id ? dayNote : item))
        : [...dayNotes, dayNote];

      localStorageStore.writeDayNotes(nextDayNotes);
      return dayNote;
    },
  };
}
