import {
  doc,
  runTransaction,
  type Firestore,
} from 'firebase/firestore';
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
} from './weeklyPlanningApprovalPersistencePolicy';
import type {
  WeeklyPlanningApprovalPlanRepository,
} from './weeklyPlanningApprovalPlanRepositoryContract';

const OPERATION_COLLECTION = 'weekly_planning_approval_operations';
const ITEM_COLLECTION = 'weekly_planning_approval_items';

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
      const planRef = doc(firestore, 'plans', identity.planId);

      try {
        return await runTransaction(firestore, async (transaction) => {
          const [operationSnapshot, itemSnapshot, planSnapshot] = await Promise.all([
            transaction.get(operationRef),
            transaction.get(itemRef),
            transaction.get(planRef),
          ]);
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
          const plan = planSnapshot.exists()
            ? normalizePlanRecord({
                ...planSnapshot.data(),
                id: planSnapshot.id,
              } as Plan)
            : null;
          const resolution = resolveAtomicApprovalSave({
            draft,
            identity,
            snapshot: { operation, item, plan },
            now: new Date(),
          });
          transaction.set(operationRef, resolution.operation, { merge: false });
          transaction.set(itemRef, resolution.item, { merge: false });
          if (resolution.writePlan) {
            transaction.set(planRef, resolution.plan, { merge: false });
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
      const planRefs = identities.map((identity) =>
        doc(firestore, 'plans', identity.planId),
      );

      try {
        await runTransaction(firestore, async (transaction) => {
          const operationSnapshot = await transaction.get(operationRef);
          const itemSnapshots = await Promise.all(
            itemRefs.map((itemRef) => transaction.get(itemRef)),
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
            if (!snapshot.exists()) {
              throw new WeeklyPlanningApprovalPersistenceError(
                'saved_plan_missing',
                '保存済み承認項目に対応する予定が見つかりません。',
              );
            }
            const plan = normalizePlanRecord({
              ...snapshot.data(),
              id: snapshot.id,
            } as Plan);
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
