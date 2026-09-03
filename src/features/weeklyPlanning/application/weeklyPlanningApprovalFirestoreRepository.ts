import {
  doc,
  getDoc,
  runTransaction,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from 'firebase/firestore';
import {
  isCurrentScheduleEventMigration,
  scheduleEventFromPlan,
  scheduleEventIdForLegacy,
  scheduleEventToPlan,
  type ScheduleEvent,
  type ScheduleEventMigrationCandidate,
} from '../../../domain/scheduleEvent';
import { normalizePlanRecord } from '../../../repositories/repositoryUtils';
import type { Plan } from '../../../types/domain';
import {
  identitiesForCompletedApprovalItems,
  malformedApprovalRecord,
  mapWeeklyPlanningApprovalPersistenceError,
  parseStoredApprovalItem,
  parseStoredApprovalOperation,
  refreshApprovalItemRetention,
  resolveApprovalCompletion,
  resolveApprovalDraftIdentity,
  resolveAtomicApprovalSave,
  validateApprovalItemOwnership,
  validateApprovalPlanIdentity,
  WeeklyPlanningApprovalPersistenceError,
  type ResolvedApprovalIdentity,
} from './weeklyPlanningApprovalPersistencePolicy';
import type {
  WeeklyPlanningApprovalPlanRepository,
} from './weeklyPlanningApprovalPlanRepositoryContract';

const OPERATION_COLLECTION = 'weekly_planning_approval_operations';
const ITEM_COLLECTION = 'weekly_planning_approval_items';
const SCHEDULE_EVENT_COLLECTION = 'schedule_events';
const SCHEDULE_EVENT_MIGRATION_COLLECTION = 'schedule_event_migrations';

type ScheduleWriteMode = 'legacy' | 'canonical';

function isPermissionDenied(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = String((error as { code?: unknown }).code ?? '');
  return code.includes('permission-denied');
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

async function hasScheduleMigrationCapability(
  migrationRef: ReturnType<typeof doc>,
): Promise<boolean> {
  try {
    await getDoc(migrationRef);
    return true;
  } catch (error) {
    if (isPermissionDenied(error)) return false;
    throw error;
  }
}

function resolveScheduleWriteMode(
  snapshot: DocumentSnapshot,
): ScheduleWriteMode {
  if (!snapshot.exists()) return 'legacy';

  const migration = snapshot.data() as ScheduleEventMigrationCandidate;
  if (isCurrentScheduleEventMigration(migration)) return 'canonical';

  throw new WeeklyPlanningApprovalPersistenceError(
    'transaction_failed',
    '予定データの移行完了後に週間計画を保存してください。',
    true,
  );
}

function planReference(
  firestore: Firestore,
  identity: ResolvedApprovalIdentity,
  mode: ScheduleWriteMode,
) {
  return mode === 'canonical'
    ? doc(
        firestore,
        SCHEDULE_EVENT_COLLECTION,
        scheduleEventIdForLegacy({ kind: 'plan', id: identity.planId }),
      )
    : doc(firestore, 'plans', identity.planId);
}

function parseStoredPlan(
  snapshot: DocumentSnapshot,
  mode: ScheduleWriteMode,
): Plan | null {
  if (!snapshot.exists()) return null;

  if (mode === 'legacy') {
    return normalizePlanRecord({
      ...snapshot.data(),
      id: snapshot.id,
    } as Plan);
  }

  const plan = scheduleEventToPlan({
    ...snapshot.data(),
    id: snapshot.id,
  } as ScheduleEvent);
  if (!plan) {
    throw malformedApprovalRecord(
      '保存済み週間計画に対応するScheduleEventの形式が不正です。',
    );
  }
  return normalizePlanRecord(plan);
}

function writeResolvedPlan(
  transaction: Transaction,
  reference: ReturnType<typeof doc>,
  plan: Plan,
  mode: ScheduleWriteMode,
): void {
  transaction.set(
    reference,
    mode === 'canonical'
      ? stripUndefinedDeep(scheduleEventFromPlan(plan))
      : stripUndefinedDeep(plan),
    { merge: false },
  );
}

export function createFirestoreWeeklyPlanningApprovalPlanRepository(
  firestore: Firestore,
): WeeklyPlanningApprovalPlanRepository {
  return {
    async saveApprovedPlan(draft) {
      const identity = resolveApprovalDraftIdentity(draft);
      const operationRef = doc(
        firestore,
        OPERATION_COLLECTION,
        identity.operationDocumentId,
      );
      const itemRef = doc(operationRef, ITEM_COLLECTION, identity.itemDocumentId);
      const migrationRef = doc(
        firestore,
        SCHEDULE_EVENT_MIGRATION_COLLECTION,
        identity.userId,
      );

      try {
        // Firestore Rules and the web client deploy independently. When the old
        // Rules version still denies the migration collection, preserve the old
        // approval transaction for this operation only. Once the capability is
        // available, migration state is read inside the same transaction that
        // writes the plan so cutover cannot split the authority.
        const migrationCapability = await hasScheduleMigrationCapability(migrationRef);
        return await runTransaction(firestore, async (transaction) => {
          const [operationSnapshot, itemSnapshot, migrationSnapshot] = await Promise.all([
            transaction.get(operationRef),
            transaction.get(itemRef),
            migrationCapability ? transaction.get(migrationRef) : Promise.resolve(null),
          ]);
          const mode = migrationSnapshot
            ? resolveScheduleWriteMode(migrationSnapshot)
            : 'legacy';
          const planRef = planReference(firestore, identity, mode);
          const planSnapshot = await transaction.get(planRef);
          const operation = operationSnapshot.exists()
            ? parseStoredApprovalOperation(operationSnapshot.data())
            : null;
          const item = itemSnapshot.exists()
            ? parseStoredApprovalItem(itemSnapshot.data())
            : null;
          if (operationSnapshot.exists() && !operation) {
            throw malformedApprovalRecord('承認操作の保存形式が不正です。');
          }
          if (itemSnapshot.exists() && !item) {
            throw malformedApprovalRecord('承認項目の保存形式が不正です。');
          }
          const plan = parseStoredPlan(planSnapshot, mode);
          const resolution = resolveAtomicApprovalSave({
            draft,
            identity,
            snapshot: { operation, item, plan },
            now: new Date(),
          });
          transaction.set(operationRef, resolution.operation, { merge: false });
          transaction.set(itemRef, resolution.item, { merge: false });
          if (resolution.writePlan) {
            writeResolvedPlan(transaction, planRef, resolution.plan, mode);
          }
          return resolution.plan;
        });
      } catch (error) {
        mapWeeklyPlanningApprovalPersistenceError(error);
      }
    },

    async completeOperation(operation) {
      const identities = identitiesForCompletedApprovalItems(operation);
      if (identities.length === 0) return;
      const operationRef = doc(
        firestore,
        OPERATION_COLLECTION,
        identities[0].operationDocumentId,
      );
      const itemRefs = identities.map((identity) =>
        doc(operationRef, ITEM_COLLECTION, identity.itemDocumentId),
      );
      const migrationRef = doc(
        firestore,
        SCHEDULE_EVENT_MIGRATION_COLLECTION,
        identities[0].userId,
      );

      try {
        const migrationCapability = await hasScheduleMigrationCapability(migrationRef);
        await runTransaction(firestore, async (transaction) => {
          const [operationSnapshot, migrationSnapshot, itemSnapshots] = await Promise.all([
            transaction.get(operationRef),
            migrationCapability ? transaction.get(migrationRef) : Promise.resolve(null),
            Promise.all(itemRefs.map((itemRef) => transaction.get(itemRef))),
          ]);
          const mode = migrationSnapshot
            ? resolveScheduleWriteMode(migrationSnapshot)
            : 'legacy';
          const planRefs = identities.map((identity) =>
            planReference(firestore, identity, mode),
          );
          const planSnapshots = await Promise.all(
            planRefs.map((planRef) => transaction.get(planRef)),
          );

          const storedItems = itemSnapshots.map((snapshot, index) => {
            if (!snapshot.exists()) {
              throw new WeeklyPlanningApprovalPersistenceError(
                'incomplete_operation',
                '未保存の承認項目が残っています。',
                true,
              );
            }
            const item = parseStoredApprovalItem(snapshot.data());
            if (!item) {
              throw malformedApprovalRecord('承認項目の保存形式が不正です。');
            }
            validateApprovalItemOwnership(item, identities[index]);
            return item;
          });
          planSnapshots.forEach((snapshot, index) => {
            const plan = parseStoredPlan(snapshot, mode);
            if (!plan) {
              throw new WeeklyPlanningApprovalPersistenceError(
                'saved_plan_missing',
                '保存済み承認項目に対応する予定が見つかりません。',
              );
            }
            validateApprovalPlanIdentity(plan, identities[index]);
            if (storedItems[index].savedPlanId !== plan.id) {
              throw new WeeklyPlanningApprovalPersistenceError(
                'source_conflict',
                '承認項目に別の予定が関連付けられています。',
              );
            }
          });

          const parsedOperation = operationSnapshot.exists()
            ? parseStoredApprovalOperation(operationSnapshot.data())
            : null;
          if (operationSnapshot.exists() && !parsedOperation) {
            throw malformedApprovalRecord('承認操作の保存形式が不正です。');
          }
          const completionTime = new Date();
          const completed = resolveApprovalCompletion({
            operation: parsedOperation,
            userId: identities[0].userId,
            approvalOperationId: identities[0].approvalOperationId,
            durableItemCount: storedItems.length,
            expectedItemCount: identities.length,
            now: completionTime,
          });
          transaction.set(operationRef, completed, { merge: false });
          storedItems.forEach((item, index) => {
            transaction.set(
              itemRefs[index],
              refreshApprovalItemRetention(item, completionTime),
              { merge: false },
            );
          });
        });
      } catch (error) {
        mapWeeklyPlanningApprovalPersistenceError(error);
      }
    },
  };
}
