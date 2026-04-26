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
    async getMonthEvents(userId) {
      return filterByUserId(await storageGateway.readMonthEvents(), userId);
    },
    async getTodos(userId) {
      return filterByUserId(await storageGateway.readTodos(), userId);
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
          (item) =>
            !(
              item.userId === actual.userId &&
              item.planId === actual.planId &&
              item.occurrenceDate === actual.occurrenceDate
            ),
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
