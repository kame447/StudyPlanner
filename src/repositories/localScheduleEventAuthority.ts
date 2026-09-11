import type { RecurringPlanMutation } from '../domain/recurringPlanMutation';
import {
  createScheduleEventMigrationState,
  isCurrentScheduleEventMigration,
  migrateLegacyScheduleRecords,
  scheduleEventFromMonthEvent,
  scheduleEventFromPlan,
  scheduleEventIdForLegacy,
  scheduleEventToMonthEvent,
  scheduleEventToPlan,
  type ScheduleEvent,
  type ScheduleEventMigrationState,
} from '../domain/scheduleEvent';
import type { Actual } from '../types/domain';
import type { PlannerStorageGateway } from './repositoryContracts';
import { replaceById, upsertActualRecord } from './repositoryUtils';
import type {
  LegacyScheduleSnapshot,
  ScheduleEventAuthorityRepository,
} from './scheduleEventAuthorityRepository';

const LOCAL_SCHEDULE_EVENTS_KEY = 'studyplanner.scheduleEvents.v1';
const LOCAL_SCHEDULE_EVENT_MIGRATIONS_KEY = 'studyplanner.scheduleEventMigrations.v1';

type OwnedRecord = { id: string; userId: string };

function readJson<T>(storage: Storage, key: string, fallback: T): T {
  const raw = storage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(storage: Storage, key: string, value: T): void {
  storage.setItem(key, JSON.stringify(value));
}

function readScheduleEvents(storage: Storage): ScheduleEvent[] {
  return readJson<ScheduleEvent[]>(storage, LOCAL_SCHEDULE_EVENTS_KEY, []);
}

function writeScheduleEvents(storage: Storage, events: readonly ScheduleEvent[]): void {
  writeJson(storage, LOCAL_SCHEDULE_EVENTS_KEY, events);
}

function readMigrationStates(storage: Storage): ScheduleEventMigrationState[] {
  return readJson<ScheduleEventMigrationState[]>(
    storage,
    LOCAL_SCHEDULE_EVENT_MIGRATIONS_KEY,
    [],
  );
}

function writeMigrationStates(
  storage: Storage,
  states: readonly ScheduleEventMigrationState[],
): void {
  writeJson(storage, LOCAL_SCHEDULE_EVENT_MIGRATIONS_KEY, states);
}

function assertOwnedRecords(
  userId: string,
  records: readonly OwnedRecord[],
  label: string,
): void {
  if (records.some((record) => record.userId !== userId)) {
    throw new Error(`${label} の所有者が一致しません。`);
  }
}

function recurringActualOccurrenceKey(actual: Actual): string | null {
  return actual.planId ? `${actual.planId}\u0000${actual.occurrenceDate}` : null;
}

function applyRecurringActualMutation(
  current: Actual[],
  userId: string,
  mutation: RecurringPlanMutation,
): Actual[] {
  const planDeleteIds = new Set(mutation.planDeletes.map((plan) => plan.id));
  const actualDeleteIds = new Set(mutation.actualDeletes.map((actual) => actual.id));
  const actualDeleteOccurrences = new Set(
    mutation.actualDeletes
      .map(recurringActualOccurrenceKey)
      .filter((key): key is string => key !== null),
  );
  const reboundIds = new Set(mutation.actualUpserts.map((actual) => actual.id));
  const remaining = current.filter((actual) => {
    if (actual.userId !== userId || reboundIds.has(actual.id)) return true;
    const occurrenceKey = recurringActualOccurrenceKey(actual);
    const matchesExplicitDelete =
      actualDeleteIds.has(actual.id) ||
      (occurrenceKey !== null && actualDeleteOccurrences.has(occurrenceKey));
    const matchesDeletedPlan = actual.planId !== null && planDeleteIds.has(actual.planId);
    return !matchesExplicitDelete && !matchesDeletedPlan;
  });

  return mutation.actualUpserts.reduce(
    (records, actual) => upsertActualRecord(records, actual),
    remaining,
  );
}

function replaceOwnedEvents(
  current: readonly ScheduleEvent[],
  userId: string,
  nextOwned: readonly ScheduleEvent[],
): ScheduleEvent[] {
  return [
    ...current.filter((event) => event.userId !== userId),
    ...nextOwned,
  ];
}

function applyPlanEventMutation(
  current: ScheduleEvent[],
  userId: string,
  mutation: RecurringPlanMutation,
): ScheduleEvent[] {
  const deleteIds = new Set(
    mutation.planDeletes.map((plan) =>
      scheduleEventIdForLegacy({ kind: 'plan', id: plan.id }),
    ),
  );
  let next = current.filter(
    (event) => !(event.userId === userId && deleteIds.has(event.id)),
  );
  for (const plan of mutation.planUpserts) {
    next = replaceById(next, scheduleEventFromPlan(plan));
  }
  return next;
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

export function createLocalScheduleEventAuthority(
  plannerStorageGateway: PlannerStorageGateway,
  storage: Storage = window.localStorage,
): ScheduleEventAuthorityRepository {
  return {
    async ensureMigrated(
      userId: string,
      loadLegacy: () => Promise<LegacyScheduleSnapshot>,
    ) {
      const currentState = readMigrationStates(storage).find(
        (state) => state.userId === userId,
      );
      if (isCurrentScheduleEventMigration(currentState)) return;

      const legacy = await loadLegacy();
      assertOwnedRecords(userId, [...legacy.plans, ...legacy.monthEvents], '予定移行');
      const migration = migrateLegacyScheduleRecords(legacy);
      const previousEvents = readScheduleEvents(storage);
      const previousStates = readMigrationStates(storage);
      const nextEvents = replaceOwnedEvents(previousEvents, userId, migration.events);
      const nextState = createScheduleEventMigrationState({
        userId,
        sourcePlanCount: migration.sourcePlanCount,
        sourceMonthEventCount: migration.sourceMonthEventCount,
        eventCount: migration.events.length,
        completedAt: new Date().toISOString(),
      });
      const nextStates = replaceById(
        previousStates.map((state) => ({ ...state, id: state.userId })),
        { ...nextState, id: userId },
      ).map(({ id: _id, ...state }) => state);

      try {
        writeScheduleEvents(storage, nextEvents);
        writeMigrationStates(storage, nextStates);
      } catch (error) {
        writeScheduleEvents(storage, previousEvents);
        writeMigrationStates(storage, previousStates);
        throw error;
      }
    },

    async getPlans(userId) {
      return readScheduleEvents(storage)
        .filter((event) => event.userId === userId)
        .map(scheduleEventToPlan)
        .filter((plan): plan is NonNullable<typeof plan> => plan !== null);
    },

    async getMonthEvents(userId) {
      return readScheduleEvents(storage)
        .filter((event) => event.userId === userId)
        .map(scheduleEventToMonthEvent)
        .filter((event): event is NonNullable<typeof event> => event !== null);
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

      const previousEvents = readScheduleEvents(storage);
      const previousActuals = await plannerStorageGateway.readActuals();
      const nextEvents = hasPlanChanges
        ? applyPlanEventMutation(previousEvents, userId, mutation)
        : previousEvents;
      const nextActuals = hasActualChanges
        ? applyRecurringActualMutation(previousActuals, userId, mutation)
        : previousActuals;

      await runRecoverableMutation(
        async () => {
          if (hasPlanChanges) writeScheduleEvents(storage, nextEvents);
          if (hasActualChanges) await plannerStorageGateway.writeActuals(nextActuals);
        },
        async () => {
          if (hasPlanChanges) writeScheduleEvents(storage, previousEvents);
          if (hasActualChanges) await plannerStorageGateway.writeActuals(previousActuals);
        },
        '繰り返し予定更新',
      );
    },

    async deletePlanWithDependents(mutation) {
      assertOwnedRecords(
        mutation.userId,
        mutation.todo ? [mutation.plan, mutation.todo] : [mutation.plan],
        '予定削除',
      );
      const previousEvents = readScheduleEvents(storage);
      const previousActuals = await plannerStorageGateway.readActuals();
      const previousTodos = mutation.todo
        ? await plannerStorageGateway.readTodos()
        : null;
      const eventId = scheduleEventIdForLegacy({ kind: 'plan', id: mutation.plan.id });
      const nextEvents = previousEvents.filter(
        (event) => !(event.userId === mutation.userId && event.id === eventId),
      );
      const nextActuals = previousActuals.filter(
        (actual) =>
          !(actual.userId === mutation.userId && actual.planId === mutation.plan.id),
      );
      const nextTodos = previousTodos && mutation.todo
        ? replaceById(previousTodos, mutation.todo)
        : null;

      await runRecoverableMutation(
        async () => {
          writeScheduleEvents(storage, nextEvents);
          await plannerStorageGateway.writeActuals(nextActuals);
          if (nextTodos) await plannerStorageGateway.writeTodos(nextTodos);
        },
        async () => {
          writeScheduleEvents(storage, previousEvents);
          await plannerStorageGateway.writeActuals(previousActuals);
          if (previousTodos) await plannerStorageGateway.writeTodos(previousTodos);
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
      const previousEvents = readScheduleEvents(storage);
      const previousActuals = await plannerStorageGateway.readActuals();
      const previousTodos = mutation.todo
        ? await plannerStorageGateway.readTodos()
        : null;
      const nextEvents = replaceById(previousEvents, scheduleEventFromPlan(mutation.plan));
      const nextActuals = mutation.actuals.reduce(
        (actuals, actual) => upsertActualRecord(actuals, actual),
        previousActuals,
      );
      const nextTodos = previousTodos && mutation.todo
        ? replaceById(previousTodos, mutation.todo)
        : null;

      await runRecoverableMutation(
        async () => {
          writeScheduleEvents(storage, nextEvents);
          await plannerStorageGateway.writeActuals(nextActuals);
          if (nextTodos) await plannerStorageGateway.writeTodos(nextTodos);
        },
        async () => {
          writeScheduleEvents(storage, previousEvents);
          await plannerStorageGateway.writeActuals(previousActuals);
          if (previousTodos) await plannerStorageGateway.writeTodos(previousTodos);
        },
        '予定復元',
      );
    },

    async scheduleTodoPlan(mutation) {
      const userId = mutation.plan.userId;
      assertOwnedRecords(userId, [mutation.plan, mutation.todo], 'Todo予定化');
      const previousEvents = readScheduleEvents(storage);
      const previousTodos = await plannerStorageGateway.readTodos();
      const nextEvents = replaceById(previousEvents, scheduleEventFromPlan(mutation.plan));
      const nextTodos = replaceById(previousTodos, mutation.todo);

      await runRecoverableMutation(
        async () => {
          writeScheduleEvents(storage, nextEvents);
          await plannerStorageGateway.writeTodos(nextTodos);
        },
        async () => {
          writeScheduleEvents(storage, previousEvents);
          await plannerStorageGateway.writeTodos(previousTodos);
        },
        'Todo予定化',
      );
    },

    async upsertPlan(plan) {
      assertOwnedRecords(plan.userId, [plan], '予定保存');
      const nextEvents = replaceById(readScheduleEvents(storage), scheduleEventFromPlan(plan));
      writeScheduleEvents(storage, nextEvents);
      return plan;
    },

    async deletePlan(userId, planId) {
      const previousEvents = readScheduleEvents(storage);
      const previousActuals = await plannerStorageGateway.readActuals();
      const eventId = scheduleEventIdForLegacy({ kind: 'plan', id: planId });
      const nextEvents = previousEvents.filter(
        (event) => !(event.userId === userId && event.id === eventId),
      );
      const nextActuals = previousActuals.filter(
        (actual) => !(actual.userId === userId && actual.planId === planId),
      );

      await runRecoverableMutation(
        async () => {
          writeScheduleEvents(storage, nextEvents);
          await plannerStorageGateway.writeActuals(nextActuals);
        },
        async () => {
          writeScheduleEvents(storage, previousEvents);
          await plannerStorageGateway.writeActuals(previousActuals);
        },
        '予定削除',
      );
    },

    async upsertMonthEvent(monthEvent) {
      assertOwnedRecords(monthEvent.userId, [monthEvent], '主要予定保存');
      const nextEvents = replaceById(
        readScheduleEvents(storage),
        scheduleEventFromMonthEvent(monthEvent),
      );
      writeScheduleEvents(storage, nextEvents);
      return monthEvent;
    },

    async deleteMonthEvent(userId, monthEventId) {
      const eventId = scheduleEventIdForLegacy({
        kind: 'month-event',
        id: monthEventId,
      });
      writeScheduleEvents(
        storage,
        readScheduleEvents(storage).filter(
          (event) => !(event.userId === userId && event.id === eventId),
        ),
      );
    },
  };
}
