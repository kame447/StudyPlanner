import type { RecurringPlanMutation } from '../domain/recurringPlanMutation';
import type { Actual, Plan } from '../types/domain';
import type {
  PlannerRepository,
  PlannerStorageGateway,
} from './repositoryContracts';
import {
  dedupeLinkedActualRecords,
  filterByUserId,
  replaceById,
  upsertActualRecord,
} from './repositoryUtils';


function assertMutationOwner(userId: string, mutation: RecurringPlanMutation): void {
  const records = [
    ...mutation.planUpserts,
    ...mutation.planDeletes,
    ...mutation.actualUpserts,
    ...mutation.actualDeletes,
  ];

  if (records.some((record) => record.userId !== userId)) {
    throw new Error('Recurring plan mutation contains records owned by another user.');
  }
}

function applyPlanMutation(
  current: Plan[],
  userId: string,
  mutation: RecurringPlanMutation,
): Plan[] {
  const deleteIds = new Set(mutation.planDeletes.map((plan) => plan.id));
  return mutation.planUpserts.reduce(
    (records, plan) => replaceById(records, plan),
    current.filter(
      (plan) => !(plan.userId === userId && deleteIds.has(plan.id)),
    ),
  );
}

function actualOccurrenceKey(actual: Actual): string | null {
  return actual.planId
    ? `${actual.planId}\u0000${actual.occurrenceDate}`
    : null;
}

function applyActualMutation(
  current: Actual[],
  userId: string,
  mutation: RecurringPlanMutation,
): Actual[] {
  const planDeleteIds = new Set(mutation.planDeletes.map((plan) => plan.id));
  const actualDeleteIds = new Set(mutation.actualDeletes.map((actual) => actual.id));
  const actualDeleteOccurrences = new Set(
    mutation.actualDeletes
      .map(actualOccurrenceKey)
      .filter((key): key is string => key !== null),
  );
  const reboundIds = new Set(mutation.actualUpserts.map((actual) => actual.id));
  const remaining = current.filter((actual) => {
    if (actual.userId !== userId || reboundIds.has(actual.id)) {
      return true;
    }

    const occurrenceKey = actualOccurrenceKey(actual);
    const matchesExplicitDelete =
      actualDeleteIds.has(actual.id) ||
      (occurrenceKey !== null && actualDeleteOccurrences.has(occurrenceKey));
    const matchesDeletedPlan =
      actual.planId !== null && planDeleteIds.has(actual.planId);
    return !matchesExplicitDelete && !matchesDeletedPlan;
  });
  return mutation.actualUpserts.reduce(
    (records, actual) => upsertActualRecord(records, actual),
    remaining,
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createPlannerRepository(
  storageGateway: PlannerStorageGateway,
): PlannerRepository {
  return {
    async getPlans(userId) {
      return filterByUserId(await storageGateway.readPlans(), userId);
    },
    async getActuals(userId) {
      return dedupeLinkedActualRecords(
        filterByUserId(await storageGateway.readActuals(), userId),
      );
    },
    async getDayNotes(userId) {
      return filterByUserId(await storageGateway.readDayNotes(), userId);
    },
    async getMonthEvents(userId) {
      return filterByUserId(await storageGateway.readMonthEvents(), userId);
    },
    async getTodos(userId) {
      return filterByUserId(await storageGateway.readTodos(), userId);
    },
    async getStudySubjects(userId) {
      return filterByUserId(await storageGateway.readStudySubjects(), userId);
    },
    async getStudyMaterials(userId) {
      return filterByUserId(await storageGateway.readStudyMaterials(), userId);
    },
    async getScheduleTemplates(userId) {
      return filterByUserId(await storageGateway.readScheduleTemplates(), userId);
    },
    async getTimetableTerms(userId) {
      return filterByUserId(await storageGateway.readTimetableTerms(), userId);
    },
    async getTimetablePeriods(userId) {
      return filterByUserId(await storageGateway.readTimetablePeriods(), userId);
    },
    async applyRecurringPlanMutation(userId, mutation) {
      assertMutationOwner(userId, mutation);
      const hasPlanChanges =
        mutation.planUpserts.length > 0 || mutation.planDeletes.length > 0;
      const hasActualChanges =
        mutation.actualUpserts.length > 0 ||
        mutation.actualDeletes.length > 0 ||
        mutation.planDeletes.length > 0;

      if (!hasPlanChanges && !hasActualChanges) {
        return;
      }

      const previousPlans = await storageGateway.readPlans();
      const previousActuals = await storageGateway.readActuals();
      const nextPlans = applyPlanMutation(previousPlans, userId, mutation);
      const nextActuals = applyActualMutation(previousActuals, userId, mutation);
      let plansWritten = false;

      try {
        if (hasPlanChanges) {
          await storageGateway.writePlans(nextPlans);
          plansWritten = true;
        }
        if (hasActualChanges) {
          await storageGateway.writeActuals(nextActuals);
        }
      } catch (error) {
        if (plansWritten && hasActualChanges) {
          try {
            await storageGateway.writePlans(previousPlans);
          } catch (rollbackError) {
            throw new Error(
              `Recurring plan mutation failed (${errorText(error)}) and local rollback failed (${errorText(rollbackError)}).`,
            );
          }
        }
        throw error;
      }
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
      const actuals = await storageGateway.readActuals();
      const nextActuals = upsertActualRecord(actuals, actual);
      const nextActual = nextActuals.find(
        (item) =>
          item.userId === actual.userId &&
          (actual.planId
            ? item.planId === actual.planId &&
              item.occurrenceDate === actual.occurrenceDate
            : item.id === actual.id),
      ) ?? actual;

      await storageGateway.writeActuals(nextActuals);
      return nextActual;
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
    async upsertMonthEvent(monthEvent) {
      const nextMonthEvents = replaceById(
        await storageGateway.readMonthEvents(),
        monthEvent,
      );

      await storageGateway.writeMonthEvents(nextMonthEvents);
      return monthEvent;
    },
    async deleteMonthEvent(userId, monthEventId) {
      const monthEvents = (await storageGateway.readMonthEvents()).filter(
        (monthEvent) => !(monthEvent.userId === userId && monthEvent.id === monthEventId),
      );

      await storageGateway.writeMonthEvents(monthEvents);
    },
    async upsertTodo(todo) {
      const nextTodos = replaceById(await storageGateway.readTodos(), todo);

      await storageGateway.writeTodos(nextTodos);
      return todo;
    },
    async deleteTodo(userId, todoId) {
      const todos = (await storageGateway.readTodos()).filter(
        (todo) => !(todo.userId === userId && todo.id === todoId),
      );

      await storageGateway.writeTodos(todos);
    },
    async upsertStudySubject(item) {
      const nextItems = replaceById(
        await storageGateway.readStudySubjects(),
        item,
      );

      await storageGateway.writeStudySubjects(nextItems);
      return item;
    },
    async deleteStudySubject(userId, subjectId) {
      const items = (await storageGateway.readStudySubjects()).filter(
        (item) => !(item.userId === userId && item.id === subjectId),
      );

      await storageGateway.writeStudySubjects(items);
    },
    async upsertStudyMaterial(item) {
      const nextItems = replaceById(
        await storageGateway.readStudyMaterials(),
        item,
      );

      await storageGateway.writeStudyMaterials(nextItems);
      return item;
    },
    async updateStudyMaterialProgress(userId, materialId, nextCurrentUnit) {
      const materials = await storageGateway.readStudyMaterials();
      const targetMaterial = materials.find(
        (item) => item.userId === userId && item.id === materialId,
      );

      if (!targetMaterial) {
        return;
      }

      const updatedMaterial = {
        ...targetMaterial,
        currentUnit: Math.max(0, nextCurrentUnit),
        updatedAt: new Date().toISOString(),
      };

      await storageGateway.writeStudyMaterials(
        replaceById(materials, updatedMaterial),
      );
    },
    async deleteStudyMaterial(userId, materialId) {
      const items = (await storageGateway.readStudyMaterials()).filter(
        (item) => !(item.userId === userId && item.id === materialId),
      );

      await storageGateway.writeStudyMaterials(items);
    },
    async upsertScheduleTemplate(item) {
      const nextItems = replaceById(
        await storageGateway.readScheduleTemplates(),
        item,
      );

      await storageGateway.writeScheduleTemplates(nextItems);
      return item;
    },
    async deleteScheduleTemplate(userId, templateId) {
      const items = (await storageGateway.readScheduleTemplates()).filter(
        (item) => !(item.userId === userId && item.id === templateId),
      );

      await storageGateway.writeScheduleTemplates(items);
    },
    async upsertTimetableTerm(item) {
      const nextItems = replaceById(await storageGateway.readTimetableTerms(), item);

      await storageGateway.writeTimetableTerms(nextItems);
      return item;
    },
    async deleteTimetableTerm(userId, termId) {
      const items = (await storageGateway.readTimetableTerms()).filter(
        (item) => !(item.userId === userId && item.id === termId),
      );

      await storageGateway.writeTimetableTerms(items);
    },
    async upsertTimetablePeriod(item) {
      const nextItems = replaceById(await storageGateway.readTimetablePeriods(), item);

      await storageGateway.writeTimetablePeriods(nextItems);
      return item;
    },
    async deleteTimetablePeriod(userId, periodId) {
      const items = (await storageGateway.readTimetablePeriods()).filter(
        (item) => !(item.userId === userId && item.id === periodId),
      );

      await storageGateway.writeTimetablePeriods(items);
    },
  };
}
