import type { RecurringPlanMutation } from '../domain/recurringPlanMutation';
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

type OwnedRecord = { id: string; userId: string };

function assertOwnedRecords(
  userId: string,
  records: readonly OwnedRecord[],
  label: string,
): void {
  if (records.some((record) => record.userId !== userId)) {
    throw new Error(`${label} の所有者が一致しません。`);
  }
}

function upsertMany<T extends { id: string }>(
  current: T[],
  records: readonly T[],
): T[] {
  return records.reduce(
    (items, record) => replaceById(items, record),
    current,
  );
}

function applyOwnedRecords<T extends OwnedRecord>(
  current: T[],
  userId: string,
  upserts: readonly T[],
  deletes: readonly T[],
): T[] {
  const deleteIds = new Set(deletes.map((record) => record.id));
  const remaining = current.filter(
    (record) => !(record.userId === userId && deleteIds.has(record.id)),
  );
  return upsertMany(remaining, upserts);
}

function recurringActualOccurrenceKey(
  actual: import('../types/domain').Actual,
): string | null {
  return actual.planId
    ? `${actual.planId}\u0000${actual.occurrenceDate}`
    : null;
}

function applyRecurringActualMutation(
  current: import('../types/domain').Actual[],
  userId: string,
  mutation: RecurringPlanMutation,
): import('../types/domain').Actual[] {
  const planDeleteIds = new Set(mutation.planDeletes.map((plan) => plan.id));
  const actualDeleteIds = new Set(mutation.actualDeletes.map((actual) => actual.id));
  const actualDeleteOccurrences = new Set(
    mutation.actualDeletes
      .map(recurringActualOccurrenceKey)
      .filter((key): key is string => key !== null),
  );
  const reboundIds = new Set(mutation.actualUpserts.map((actual) => actual.id));
  const remaining = current.filter((actual) => {
    if (actual.userId !== userId || reboundIds.has(actual.id)) {
      return true;
    }

    const occurrenceKey = recurringActualOccurrenceKey(actual);
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

async function runRecoverableMutation(
  apply: () => Promise<void>,
  rollback: () => Promise<void>,
  label: string,
): Promise<void> {
  try {
    await apply();
  } catch (error) {
    try {
      await rollback();
    } catch (rollbackError) {
      const detail = rollbackError instanceof Error
        ? rollbackError.message
        : String(rollbackError);
      throw new Error(`${label}に失敗し、ロールバックにも失敗しました: ${detail}`);
    }
    throw error;
  }
}

function resolveActualUpsert(
  actuals: import('../types/domain').Actual[],
  actual: import('../types/domain').Actual,
): {
  nextActuals: import('../types/domain').Actual[];
  savedActual: import('../types/domain').Actual;
} {
  const nextActuals = upsertActualRecord(actuals, actual);
  const savedActual = nextActuals.find(
    (item) =>
      item.userId === actual.userId &&
      (actual.planId
        ? item.planId === actual.planId &&
          item.occurrenceDate === actual.occurrenceDate
        : item.id === actual.id),
  ) ?? actual;
  return { nextActuals, savedActual };
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
    assertOwnedRecords(
      userId,
      [
        ...mutation.planUpserts,
        ...mutation.planDeletes,
        ...mutation.actualUpserts,
        ...mutation.actualDeletes,
      ],
      '繰り返し予定更新',
    );
    const hasPlanChanges =
      mutation.planUpserts.length > 0 || mutation.planDeletes.length > 0;
    const hasActualChanges =
      mutation.actualUpserts.length > 0 ||
      mutation.actualDeletes.length > 0 ||
      mutation.planDeletes.length > 0;
    if (!hasPlanChanges && !hasActualChanges) return;

    const previousPlans = await storageGateway.readPlans();
    const previousActuals = await storageGateway.readActuals();
    const nextPlans = hasPlanChanges
      ? applyOwnedRecords(
previousPlans,
userId,
mutation.planUpserts,
mutation.planDeletes,
        )
      : previousPlans;
    const nextActuals = hasActualChanges
      ? applyRecurringActualMutation(previousActuals, userId, mutation)
      : previousActuals;

    await runRecoverableMutation(
      async () => {
        if (hasPlanChanges) await storageGateway.writePlans(nextPlans);
        if (hasActualChanges) await storageGateway.writeActuals(nextActuals);
      },
      async () => {
        if (hasPlanChanges) await storageGateway.writePlans(previousPlans);
        if (hasActualChanges) await storageGateway.writeActuals(previousActuals);
      },
      '繰り返し予定更新',
    );
  },
    async deletePlanWithDependents(mutation) {
      const ownedRecords = mutation.todo
        ? [mutation.plan, mutation.todo]
        : [mutation.plan];
      assertOwnedRecords(mutation.userId, ownedRecords, '予定削除');

      const previousPlans = await storageGateway.readPlans();
      const previousActuals = await storageGateway.readActuals();
      const previousTodos = mutation.todo ? await storageGateway.readTodos() : null;
      const nextPlans = previousPlans.filter(
        (plan) => !(plan.userId === mutation.userId && plan.id === mutation.plan.id),
      );
      const nextActuals = previousActuals.filter(
        (actual) => !(actual.userId === mutation.userId && actual.planId === mutation.plan.id),
      );
      const nextTodos = previousTodos && mutation.todo
        ? replaceById(previousTodos, mutation.todo)
        : null;

      await runRecoverableMutation(
        async () => {
          await storageGateway.writePlans(nextPlans);
          await storageGateway.writeActuals(nextActuals);
          if (nextTodos) await storageGateway.writeTodos(nextTodos);
        },
        async () => {
          await storageGateway.writePlans(previousPlans);
          await storageGateway.writeActuals(previousActuals);
          if (previousTodos) await storageGateway.writeTodos(previousTodos);
        },
        '予定削除',
      );
    },
    async restorePlanWithDependents(mutation) {
      const userId = mutation.plan.userId;
      assertOwnedRecords(
        userId,
        [mutation.plan, ...mutation.actuals, ...(mutation.todo ? [mutation.todo] : [])],
        '予定復元',
      );
      const previousPlans = await storageGateway.readPlans();
      const previousActuals = await storageGateway.readActuals();
      const previousTodos = mutation.todo ? await storageGateway.readTodos() : null;
      const nextPlans = replaceById(previousPlans, mutation.plan);
      const nextActuals = upsertMany(previousActuals, mutation.actuals);
      const nextTodos = previousTodos && mutation.todo
        ? replaceById(previousTodos, mutation.todo)
        : null;

      await runRecoverableMutation(
        async () => {
          await storageGateway.writePlans(nextPlans);
          await storageGateway.writeActuals(nextActuals);
          if (nextTodos) await storageGateway.writeTodos(nextTodos);
        },
        async () => {
          await storageGateway.writePlans(previousPlans);
          await storageGateway.writeActuals(previousActuals);
          if (previousTodos) await storageGateway.writeTodos(previousTodos);
        },
        '予定復元',
      );
    },
    async scheduleTodoPlan(mutation) {
      const userId = mutation.plan.userId;
      assertOwnedRecords(userId, [mutation.plan, mutation.todo], 'Todo予定化');
      const previousPlans = await storageGateway.readPlans();
      const previousTodos = await storageGateway.readTodos();
      const nextPlans = replaceById(previousPlans, mutation.plan);
      const nextTodos = replaceById(previousTodos, mutation.todo);

      await runRecoverableMutation(
        async () => {
          await storageGateway.writePlans(nextPlans);
          await storageGateway.writeTodos(nextTodos);
        },
        async () => {
          await storageGateway.writePlans(previousPlans);
          await storageGateway.writeTodos(previousTodos);
        },
        'Todo予定化',
      );
    },
    async upsertActualWithMaterialProgress(mutation) {
      const userId = mutation.actual.userId;
      assertOwnedRecords(userId, [mutation.actual, ...mutation.materials], '記録保存');
      const previousActuals = await storageGateway.readActuals();
      const previousMaterials = mutation.materials.length > 0
        ? await storageGateway.readStudyMaterials()
        : null;
      const { nextActuals, savedActual } = resolveActualUpsert(
        previousActuals,
        mutation.actual,
      );
      const nextMaterials = previousMaterials
        ? upsertMany(previousMaterials, mutation.materials)
        : null;

      await runRecoverableMutation(
        async () => {
          await storageGateway.writeActuals(nextActuals);
          if (nextMaterials) await storageGateway.writeStudyMaterials(nextMaterials);
        },
        async () => {
          await storageGateway.writeActuals(previousActuals);
          if (previousMaterials) {
            await storageGateway.writeStudyMaterials(previousMaterials);
          }
        },
        '記録保存',
      );
      return savedActual;
    },
    async upsertStudySubjectWithMaterials(mutation) {
      const userId = mutation.subject.userId;
      assertOwnedRecords(
        userId,
        [mutation.subject, ...mutation.materials],
        '教科保存',
      );
      const previousSubjects = await storageGateway.readStudySubjects();
      const previousMaterials = mutation.materials.length > 0
        ? await storageGateway.readStudyMaterials()
        : null;
      const nextSubjects = replaceById(previousSubjects, mutation.subject);
      const nextMaterials = previousMaterials
        ? upsertMany(previousMaterials, mutation.materials)
        : null;

      await runRecoverableMutation(
        async () => {
          await storageGateway.writeStudySubjects(nextSubjects);
          if (nextMaterials) await storageGateway.writeStudyMaterials(nextMaterials);
        },
        async () => {
          await storageGateway.writeStudySubjects(previousSubjects);
          if (previousMaterials) {
            await storageGateway.writeStudyMaterials(previousMaterials);
          }
        },
        '教科保存',
      );
    },
    async applyTimetableMutation(mutation) {
      assertOwnedRecords(
        mutation.userId,
        [
          ...mutation.termUpserts,
          ...mutation.termDeletes,
          ...mutation.templateUpserts,
          ...mutation.templateDeletes,
          ...mutation.periodUpserts,
          ...mutation.periodDeletes,
        ],
        '時間割更新',
      );
      const hasTermChanges = mutation.termUpserts.length > 0 || mutation.termDeletes.length > 0;
      const hasTemplateChanges =
        mutation.templateUpserts.length > 0 || mutation.templateDeletes.length > 0;
      const hasPeriodChanges =
        mutation.periodUpserts.length > 0 || mutation.periodDeletes.length > 0;
      if (!hasTermChanges && !hasTemplateChanges && !hasPeriodChanges) return;

      const previousTerms = hasTermChanges ? await storageGateway.readTimetableTerms() : null;
      const previousTemplates = hasTemplateChanges
        ? await storageGateway.readScheduleTemplates()
        : null;
      const previousPeriods = hasPeriodChanges
        ? await storageGateway.readTimetablePeriods()
        : null;
      const nextTerms = previousTerms
        ? applyOwnedRecords(
            previousTerms,
            mutation.userId,
            mutation.termUpserts,
            mutation.termDeletes,
          )
        : null;
      const nextTemplates = previousTemplates
        ? applyOwnedRecords(
            previousTemplates,
            mutation.userId,
            mutation.templateUpserts,
            mutation.templateDeletes,
          )
        : null;
      const nextPeriods = previousPeriods
        ? applyOwnedRecords(
            previousPeriods,
            mutation.userId,
            mutation.periodUpserts,
            mutation.periodDeletes,
          )
        : null;

      await runRecoverableMutation(
        async () => {
          if (nextTerms) await storageGateway.writeTimetableTerms(nextTerms);
          if (nextTemplates) await storageGateway.writeScheduleTemplates(nextTemplates);
          if (nextPeriods) await storageGateway.writeTimetablePeriods(nextPeriods);
        },
        async () => {
          if (previousTerms) await storageGateway.writeTimetableTerms(previousTerms);
          if (previousTemplates) {
            await storageGateway.writeScheduleTemplates(previousTemplates);
          }
          if (previousPeriods) {
            await storageGateway.writeTimetablePeriods(previousPeriods);
          }
        },
        '時間割更新',
      );
    },
    async upsertPlan(plan) {
      const nextPlans = replaceById(await storageGateway.readPlans(), plan);
      await storageGateway.writePlans(nextPlans);
      return plan;
    },
    async deletePlan(userId, planId) {
      const previousPlans = await storageGateway.readPlans();
      const previousActuals = await storageGateway.readActuals();
      const plans = previousPlans.filter(
        (plan) => !(plan.userId === userId && plan.id === planId),
      );
      const actuals = previousActuals.filter(
        (actual) => !(actual.userId === userId && actual.planId === planId),
      );

      await runRecoverableMutation(
        async () => {
          await storageGateway.writePlans(plans);
          await storageGateway.writeActuals(actuals);
        },
        async () => {
          await storageGateway.writePlans(previousPlans);
          await storageGateway.writeActuals(previousActuals);
        },
        '予定削除',
      );
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
