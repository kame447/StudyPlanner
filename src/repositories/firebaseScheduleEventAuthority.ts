import type { Firestore, WriteBatch } from 'firebase/firestore';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  SCHEDULE_EVENT_MIGRATION_VERSION,
  SCHEDULE_EVENT_SCHEMA_VERSION,
  createScheduleEventMigrationState,
  isCurrentScheduleEventMigration,
  migrateLegacyScheduleRecords,
  scheduleEventFromMonthEvent,
  scheduleEventFromPlan,
  scheduleEventIdForLegacy,
  scheduleEventToMonthEvent,
  scheduleEventToPlan,
  type ScheduleEvent,
  type ScheduleEventMigrationCandidate,
  type ScheduleEventMigrationState,
} from '../domain/scheduleEvent';
import type { Actual, Plan } from '../types/domain';
import type {
  LegacyScheduleSnapshot,
  ScheduleEventAuthorityRepository,
} from './scheduleEventAuthorityRepository';

const SCHEDULE_EVENTS_COLLECTION = 'schedule_events';
const SCHEDULE_EVENT_MIGRATIONS_COLLECTION = 'schedule_event_migrations';
const MIGRATION_REVISION = 1 as const;
const MIGRATION_BATCH_SIZE = 400;

type FirebaseLikeError = {
  code?: string | null;
  message?: string | null;
};

type OwnedRecord = { id: string; userId: string };

type MigrationLeaseDocument = {
  schemaVersion: typeof SCHEDULE_EVENT_SCHEMA_VERSION;
  migrationVersion: typeof SCHEDULE_EVENT_MIGRATION_VERSION;
  userId: string;
  status: 'migrating';
  operationId: string;
  revision: typeof MIGRATION_REVISION;
  startedAt: string;
  completedAt: null;
};

type CompletedMigrationDocument = ScheduleEventMigrationState & {
  operationId: string;
  revision: typeof MIGRATION_REVISION;
  startedAt: string;
};

type MigrationDocument = MigrationLeaseDocument | CompletedMigrationDocument;

type BatchOperation =
  | { kind: 'set'; collectionName: string; id: string; value: unknown }
  | { kind: 'delete'; collectionName: string; id: string };

function normalizeErrorMessage(
  fallback: string,
  error: FirebaseLikeError | null,
): string {
  const code = error?.code?.trim();
  const message = error?.message?.trim();
  if (code && message) return `${code}: ${message}`;
  return message || fallback;
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => stripUndefinedDeep(item)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([key, entryValue]) => [key, stripUndefinedDeep(entryValue)]),
    ) as T;
  }
  return value;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, stableValue(entryValue)]),
    );
  }
  return value;
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

function mapSnapshot<T>(snapshot: { id: string; data: () => unknown }): T {
  return {
    ...(snapshot.data() as Record<string, unknown>),
    id: snapshot.id,
  } as unknown as T;
}

async function listByUserId<T extends { userId: string }>(
  firestoreDb: Firestore,
  collectionName: string,
  userId: string,
): Promise<T[]> {
  const snapshot = await getDocs(
    query(collection(firestoreDb, collectionName), where('userId', '==', userId)),
  );
  return snapshot.docs.map((document) => mapSnapshot<T>(document));
}

async function listActualsByPlanId(
  firestoreDb: Firestore,
  userId: string,
  planId: string,
): Promise<Actual[]> {
  const snapshot = await getDocs(
    query(
      collection(firestoreDb, 'actuals'),
      where('userId', '==', userId),
      where('planId', '==', planId),
    ),
  );
  return snapshot.docs.map((document) => mapSnapshot<Actual>(document));
}

async function listActualsByPlanOccurrence(
  firestoreDb: Firestore,
  actual: Actual,
): Promise<Actual[]> {
  if (!actual.planId) return [];
  const snapshot = await getDocs(
    query(
      collection(firestoreDb, 'actuals'),
      where('userId', '==', actual.userId),
      where('planId', '==', actual.planId),
      where('occurrenceDate', '==', actual.occurrenceDate),
    ),
  );
  return snapshot.docs.map((document) => mapSnapshot<Actual>(document));
}

function migrationOperationId(userId: string): string {
  return `schedule-event-migration-v1:${userId}`;
}

function isCurrentMigrationLease(
  value: ScheduleEventMigrationCandidate & Partial<MigrationLeaseDocument>,
  userId: string,
): value is MigrationLeaseDocument {
  return (
    value.schemaVersion === SCHEDULE_EVENT_SCHEMA_VERSION &&
    value.migrationVersion === SCHEDULE_EVENT_MIGRATION_VERSION &&
    value.status === 'migrating' &&
    value.userId === userId &&
    value.operationId === migrationOperationId(userId) &&
    value.revision === MIGRATION_REVISION &&
    typeof value.startedAt === 'string' &&
    value.completedAt === null
  );
}

async function acquireMigrationDocument(
  firestoreDb: Firestore,
  userId: string,
): Promise<MigrationDocument> {
  const reference = doc(
    firestoreDb,
    SCHEDULE_EVENT_MIGRATIONS_COLLECTION,
    userId,
  );

  return runTransaction(firestoreDb, async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (snapshot.exists()) {
      const current = {
        ...snapshot.data(),
        userId,
      } as ScheduleEventMigrationCandidate & Partial<MigrationLeaseDocument>;
      if (isCurrentScheduleEventMigration(current)) {
        return current as CompletedMigrationDocument;
      }
      if (isCurrentMigrationLease(current, userId)) {
        return current;
      }
      throw new Error('Unsupported ScheduleEvent migration marker.');
    }

    const lease: MigrationLeaseDocument = {
      schemaVersion: SCHEDULE_EVENT_SCHEMA_VERSION,
      migrationVersion: SCHEDULE_EVENT_MIGRATION_VERSION,
      userId,
      status: 'migrating',
      operationId: migrationOperationId(userId),
      revision: MIGRATION_REVISION,
      startedAt: new Date().toISOString(),
      completedAt: null,
    };
    transaction.set(reference, lease, { merge: false });
    return lease;
  });
}

function applyBatchOperation(
  firestoreDb: Firestore,
  batch: WriteBatch,
  operation: BatchOperation,
): void {
  const reference = doc(firestoreDb, operation.collectionName, operation.id);
  if (operation.kind === 'delete') {
    batch.delete(reference);
    return;
  }
  batch.set(reference, stripUndefinedDeep(operation.value));
}

async function commitOperations(
  firestoreDb: Firestore,
  operations: readonly BatchOperation[],
): Promise<void> {
  for (let index = 0; index < operations.length; index += MIGRATION_BATCH_SIZE) {
    const batch = writeBatch(firestoreDb);
    operations
      .slice(index, index + MIGRATION_BATCH_SIZE)
      .forEach((operation) => applyBatchOperation(firestoreDb, batch, operation));
    await batch.commit();
  }
}

function stableEventSnapshot(events: readonly ScheduleEvent[]): string {
  return JSON.stringify(
    stableValue(
      [...events]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((event) => stripUndefinedDeep(event)),
    ),
  );
}

async function replaceCanonicalSnapshot(
  firestoreDb: Firestore,
  userId: string,
  desiredEvents: readonly ScheduleEvent[],
): Promise<void> {
  assertOwnedRecords(userId, desiredEvents, '予定移行');
  const currentEvents = await listByUserId<ScheduleEvent>(
    firestoreDb,
    SCHEDULE_EVENTS_COLLECTION,
    userId,
  );
  const desiredIds = new Set(desiredEvents.map((event) => event.id));
  const operations: BatchOperation[] = [
    ...desiredEvents.map((event): BatchOperation => ({
      kind: 'set',
      collectionName: SCHEDULE_EVENTS_COLLECTION,
      id: event.id,
      value: event,
    })),
    ...currentEvents
      .filter((event) => !desiredIds.has(event.id))
      .map((event): BatchOperation => ({
        kind: 'delete',
        collectionName: SCHEDULE_EVENTS_COLLECTION,
        id: event.id,
      })),
  ];
  await commitOperations(firestoreDb, operations);

  const persisted = await listByUserId<ScheduleEvent>(
    firestoreDb,
    SCHEDULE_EVENTS_COLLECTION,
    userId,
  );
  if (stableEventSnapshot(persisted) !== stableEventSnapshot(desiredEvents)) {
    throw new Error('ScheduleEvent migration verification failed.');
  }
}

function planEventDeleteOperation(planId: string): BatchOperation {
  return {
    kind: 'delete',
    collectionName: SCHEDULE_EVENTS_COLLECTION,
    id: scheduleEventIdForLegacy({ kind: 'plan', id: planId }),
  };
}

function planEventSetOperation(plan: Plan): BatchOperation {
  const event = scheduleEventFromPlan(plan);
  return {
    kind: 'set',
    collectionName: SCHEDULE_EVENTS_COLLECTION,
    id: event.id,
    value: event,
  };
}

function assertBatchLimit(operationCount: number, label: string): void {
  if (operationCount > 500) {
    throw new Error(`${label} exceeds the Firestore batch limit.`);
  }
}

export function createFirebaseScheduleEventAuthority(
  firestoreDb: Firestore,
): ScheduleEventAuthorityRepository {
  return {
    async ensureMigrated(
      userId: string,
      loadLegacy: () => Promise<LegacyScheduleSnapshot>,
    ) {
      try {
        const state = await acquireMigrationDocument(firestoreDb, userId);
        if (isCurrentScheduleEventMigration(state)) return;

        const legacy = await loadLegacy();
        assertOwnedRecords(userId, [...legacy.plans, ...legacy.monthEvents], '予定移行');
        const migration = migrateLegacyScheduleRecords(legacy);
        await replaceCanonicalSnapshot(firestoreDb, userId, migration.events);

        const completed = createScheduleEventMigrationState({
          userId,
          sourcePlanCount: migration.sourcePlanCount,
          sourceMonthEventCount: migration.sourceMonthEventCount,
          eventCount: migration.events.length,
          completedAt: new Date().toISOString(),
        });
        const completedDocument: CompletedMigrationDocument = {
          ...completed,
          operationId: migrationOperationId(userId),
          revision: MIGRATION_REVISION,
          startedAt: state.startedAt,
        };
        await setDoc(
          doc(firestoreDb, SCHEDULE_EVENT_MIGRATIONS_COLLECTION, userId),
          completedDocument,
        );
      } catch (error) {
        throw new Error(
          normalizeErrorMessage(
            '予定データのScheduleEvent移行に失敗しました。',
            error as FirebaseLikeError,
          ),
        );
      }
    },

    async getPlans(userId) {
      try {
        return (await listByUserId<ScheduleEvent>(
          firestoreDb,
          SCHEDULE_EVENTS_COLLECTION,
          userId,
        ))
          .map(scheduleEventToPlan)
          .filter((plan): plan is Plan => plan !== null);
      } catch (error) {
        throw new Error(
          normalizeErrorMessage('予定を取得できませんでした。', error as FirebaseLikeError),
        );
      }
    },

    async getMonthEvents(userId) {
      try {
        return (await listByUserId<ScheduleEvent>(
          firestoreDb,
          SCHEDULE_EVENTS_COLLECTION,
          userId,
        ))
          .map(scheduleEventToMonthEvent)
          .filter((event): event is NonNullable<typeof event> => event !== null);
      } catch (error) {
        throw new Error(
          normalizeErrorMessage('主要予定を取得できませんでした。', error as FirebaseLikeError),
        );
      }
    },

    async applyRecurringPlanMutation(userId, mutation) {
      try {
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
        const reboundIds = new Set(mutation.actualUpserts.map((actual) => actual.id));
        const [linkedActuals, duplicateOccurrenceActuals] = await Promise.all([
          Promise.all(
            mutation.planDeletes.map((plan) =>
              listActualsByPlanId(firestoreDb, userId, plan.id),
            ),
          ).then((groups) => groups.flat()),
          Promise.all(
            mutation.actualDeletes.map((actual) =>
              listActualsByPlanOccurrence(firestoreDb, actual),
            ),
          ).then((groups) => groups.flat()),
        ]);
        const actualDeletesById = new Map(
          [
            ...mutation.actualDeletes,
            ...duplicateOccurrenceActuals,
            ...linkedActuals,
          ]
            .filter((actual) => !reboundIds.has(actual.id))
            .map((actual) => [actual.id, actual]),
        );
        const operationCount =
          mutation.planUpserts.length +
          mutation.planDeletes.length +
          mutation.actualUpserts.length +
          actualDeletesById.size;
        assertBatchLimit(operationCount, 'Recurring schedule mutation');
        if (operationCount === 0) return;

        const batch = writeBatch(firestoreDb);
        mutation.planUpserts.forEach((plan) =>
          applyBatchOperation(firestoreDb, batch, planEventSetOperation(plan)),
        );
        mutation.planDeletes.forEach((plan) =>
          applyBatchOperation(firestoreDb, batch, planEventDeleteOperation(plan.id)),
        );
        mutation.actualUpserts.forEach((actual) => {
          batch.set(
            doc(firestoreDb, 'actuals', actual.id),
            stripUndefinedDeep(actual),
            { merge: true },
          );
        });
        actualDeletesById.forEach((actual) => {
          batch.delete(doc(firestoreDb, 'actuals', actual.id));
        });
        await batch.commit();
      } catch (error) {
        throw new Error(
          normalizeErrorMessage(
            '繰り返し予定を保存できませんでした。',
            error as FirebaseLikeError,
          ),
        );
      }
    },

    async deletePlanWithDependents(mutation) {
      try {
        assertOwnedRecords(
          mutation.userId,
          mutation.todo ? [mutation.plan, mutation.todo] : [mutation.plan],
          '予定削除',
        );
        const actuals = await listActualsByPlanId(
          firestoreDb,
          mutation.userId,
          mutation.plan.id,
        );
        assertBatchLimit(1 + actuals.length + (mutation.todo ? 1 : 0), 'Schedule delete');
        const batch = writeBatch(firestoreDb);
        applyBatchOperation(
          firestoreDb,
          batch,
          planEventDeleteOperation(mutation.plan.id),
        );
        actuals.forEach((actual) => {
          batch.delete(doc(firestoreDb, 'actuals', actual.id));
        });
        if (mutation.todo) {
          batch.set(
            doc(firestoreDb, 'todos', mutation.todo.id),
            stripUndefinedDeep(mutation.todo),
            { merge: true },
          );
        }
        await batch.commit();
      } catch (error) {
        throw new Error(
          normalizeErrorMessage('予定を削除できませんでした。', error as FirebaseLikeError),
        );
      }
    },

    async restorePlanWithDependents(mutation) {
      try {
        const userId = mutation.plan.userId;
        assertOwnedRecords(
          userId,
          [mutation.plan, ...mutation.actuals, ...(mutation.todo ? [mutation.todo] : [])],
          '予定復元',
        );
        assertBatchLimit(
          1 + mutation.actuals.length + (mutation.todo ? 1 : 0),
          'Schedule restore',
        );
        const batch = writeBatch(firestoreDb);
        applyBatchOperation(firestoreDb, batch, planEventSetOperation(mutation.plan));
        mutation.actuals.forEach((actual) => {
          batch.set(
            doc(firestoreDb, 'actuals', actual.id),
            stripUndefinedDeep(actual),
            { merge: true },
          );
        });
        if (mutation.todo) {
          batch.set(
            doc(firestoreDb, 'todos', mutation.todo.id),
            stripUndefinedDeep(mutation.todo),
            { merge: true },
          );
        }
        await batch.commit();
      } catch (error) {
        throw new Error(
          normalizeErrorMessage('予定を復元できませんでした。', error as FirebaseLikeError),
        );
      }
    },

    async scheduleTodoPlan(mutation) {
      try {
        assertOwnedRecords(
          mutation.plan.userId,
          [mutation.plan, mutation.todo],
          'Todo予定化',
        );
        const batch = writeBatch(firestoreDb);
        applyBatchOperation(firestoreDb, batch, planEventSetOperation(mutation.plan));
        batch.set(
          doc(firestoreDb, 'todos', mutation.todo.id),
          stripUndefinedDeep(mutation.todo),
          { merge: true },
        );
        await batch.commit();
      } catch (error) {
        throw new Error(
          normalizeErrorMessage('Todoを予定化できませんでした。', error as FirebaseLikeError),
        );
      }
    },

    async upsertPlan(plan) {
      try {
        assertOwnedRecords(plan.userId, [plan], '予定保存');
        const event = scheduleEventFromPlan(plan);
        await setDoc(
          doc(firestoreDb, SCHEDULE_EVENTS_COLLECTION, event.id),
          stripUndefinedDeep(event),
        );
        return plan;
      } catch (error) {
        throw new Error(
          normalizeErrorMessage('予定を保存できませんでした。', error as FirebaseLikeError),
        );
      }
    },

    async deletePlan(userId, planId) {
      try {
        const actuals = await listActualsByPlanId(firestoreDb, userId, planId);
        assertBatchLimit(1 + actuals.length, 'Schedule delete');
        const batch = writeBatch(firestoreDb);
        applyBatchOperation(firestoreDb, batch, planEventDeleteOperation(planId));
        actuals.forEach((actual) => {
          batch.delete(doc(firestoreDb, 'actuals', actual.id));
        });
        await batch.commit();
      } catch (error) {
        throw new Error(
          normalizeErrorMessage('予定を削除できませんでした。', error as FirebaseLikeError),
        );
      }
    },

    async upsertMonthEvent(monthEvent) {
      try {
        assertOwnedRecords(monthEvent.userId, [monthEvent], '主要予定保存');
        const event = scheduleEventFromMonthEvent(monthEvent);
        await setDoc(
          doc(firestoreDb, SCHEDULE_EVENTS_COLLECTION, event.id),
          stripUndefinedDeep(event),
        );
        return monthEvent;
      } catch (error) {
        throw new Error(
          normalizeErrorMessage('主要予定を保存できませんでした。', error as FirebaseLikeError),
        );
      }
    },

    async deleteMonthEvent(_userId, monthEventId) {
      try {
        await deleteDoc(
          doc(
            firestoreDb,
            SCHEDULE_EVENTS_COLLECTION,
            scheduleEventIdForLegacy({ kind: 'month-event', id: monthEventId }),
          ),
        );
      } catch (error) {
        throw new Error(
          normalizeErrorMessage('主要予定を削除できませんでした。', error as FirebaseLikeError),
        );
      }
    },
  };
}
