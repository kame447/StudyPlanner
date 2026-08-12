import { createPlanFromDraft } from '../../../domain/planner';
import { getFirestoreDb } from '../../../lib/firebaseClient';
import type { Plan, PlanDraft } from '../../../types/domain';
import type { WeeklyDraftApprovalOperation } from '../planning/weeklyPlanningApprovalTypes';
import { WEEKLY_PLANNING_PLAN_SOURCE_TYPE } from '../planning/weeklyPlanningPlanProvenance';
import {
  createFirestoreWeeklyPlanningApprovalPlanRepository,
} from './weeklyPlanningApprovalFirestoreRepository';
import {
  identitiesForCompletedApprovalItems,
  refreshApprovalItemRetention,
  resolveApprovalCompletion,
  resolveApprovalDraftIdentity,
  resolveAtomicApprovalSave,
  validateApprovalItemOwnership,
  validateApprovalPlanIdentity,
  WeeklyPlanningApprovalPersistenceError,
  type StoredApprovalItem,
  type StoredApprovalOperation,
} from './weeklyPlanningApprovalPersistencePolicy';

export {
  createFirestoreWeeklyPlanningApprovalPlanRepository,
} from './weeklyPlanningApprovalFirestoreRepository';
export {
  WeeklyPlanningApprovalPersistenceError,
} from './weeklyPlanningApprovalPersistencePolicy';
export type {
  WeeklyPlanningApprovalPersistenceErrorCode,
} from './weeklyPlanningApprovalPersistencePolicy';

export interface WeeklyPlanningApprovalPlanRepository {
  saveApprovedPlan(draft: PlanDraft): Promise<Plan>;
  completeOperation(operation: WeeklyDraftApprovalOperation): Promise<void>;
}

export interface WeeklyPlanningApprovalMemoryState {
  readonly plans: Map<string, Plan>;
  readonly operations: Map<string, StoredApprovalOperation>;
  readonly items: Map<string, StoredApprovalItem>;
  readonly metrics: {
    planWrites: number;
    itemWrites: number;
    operationWrites: number;
  };
  runExclusive<T>(task: () => Promise<T> | T): Promise<T>;
}

export function createWeeklyPlanningApprovalMemoryState(): WeeklyPlanningApprovalMemoryState {
  const plans = new Map<string, Plan>();
  const operations = new Map<string, StoredApprovalOperation>();
  const items = new Map<string, StoredApprovalItem>();
  const metrics = { planWrites: 0, itemWrites: 0, operationWrites: 0 };
  let queue: Promise<void> = Promise.resolve();

  return {
    plans,
    operations,
    items,
    metrics,
    async runExclusive<T>(task: () => Promise<T> | T): Promise<T> {
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await task();
      } finally {
        release();
      }
    },
  };
}

export function createMemoryWeeklyPlanningApprovalPlanRepository(
  state: WeeklyPlanningApprovalMemoryState,
): WeeklyPlanningApprovalPlanRepository {
  return {
    async saveApprovedPlan(draft) {
      const identity = resolveApprovalDraftIdentity(draft);
      return state.runExclusive(() => {
        const resolution = resolveAtomicApprovalSave({
          draft,
          identity,
          snapshot: {
            operation: state.operations.get(identity.operationDocumentId) ?? null,
            item: state.items.get(identity.itemStorageKey) ?? null,
            plan: state.plans.get(identity.planId) ?? null,
          },
          now: new Date(),
        });
        state.operations.set(identity.operationDocumentId, resolution.operation);
        state.items.set(identity.itemStorageKey, resolution.item);
        state.metrics.operationWrites += 1;
        state.metrics.itemWrites += 1;
        if (resolution.writePlan) {
          state.plans.set(identity.planId, resolution.plan);
          state.metrics.planWrites += 1;
        }
        return resolution.plan;
      });
    },

    async completeOperation(operation) {
      const identities = identitiesForCompletedApprovalItems(operation);
      if (identities.length === 0) return;
      await state.runExclusive(() => {
        const storedItems = identities.map((identity) => {
          const item = state.items.get(identity.itemStorageKey);
          if (!item) {
            throw new WeeklyPlanningApprovalPersistenceError(
              'incomplete_operation',
              '未保存の承認項目が残っています。',
              true,
            );
          }
          validateApprovalItemOwnership(item, identity);
          return item;
        });
        identities.forEach((identity, index) => {
          const plan = state.plans.get(identity.planId);
          if (!plan) {
            throw new WeeklyPlanningApprovalPersistenceError(
              'saved_plan_missing',
              '保存済み承認項目に対応する予定が見つかりません。',
            );
          }
          validateApprovalPlanIdentity(plan, identity);
          if (storedItems[index].savedPlanId !== plan.id) {
            throw new WeeklyPlanningApprovalPersistenceError(
              'source_conflict',
              '承認項目に別の予定が関連付けられています。',
            );
          }
        });

        const operationDocumentId = identities[0].operationDocumentId;
        const completionTime = new Date();
        const completed = resolveApprovalCompletion({
          operation: state.operations.get(operationDocumentId) ?? null,
          userId: identities[0].userId,
          approvalOperationId: identities[0].approvalOperationId,
          durableItemCount: storedItems.length,
          expectedItemCount: identities.length,
          now: completionTime,
        });
        state.operations.set(operationDocumentId, completed);
        identities.forEach((identity, index) => {
          state.items.set(
            identity.itemStorageKey,
            refreshApprovalItemRetention(storedItems[index], completionTime),
          );
          state.metrics.itemWrites += 1;
        });
        state.metrics.operationWrites += 1;
      });
    },
  };
}

function createPlannerBackedWeeklyPlanningApprovalPlanRepository(): WeeklyPlanningApprovalPlanRepository {
  return {
    async saveApprovedPlan(draft) {
      const identity = resolveApprovalDraftIdentity(draft);
      const { plannerRepository } = await import('../../../repositories');
      const existing = (await plannerRepository.getPlans(identity.userId)).find(
        (plan) => plan.sourceType === WEEKLY_PLANNING_PLAN_SOURCE_TYPE
          && plan.sourceId === identity.sourceId,
      );
      if (existing) return existing;
      const plan = {
        ...createPlanFromDraft(draft),
        id: identity.planId,
        seriesId: identity.planId,
      };
      return plannerRepository.upsertPlan(plan);
    },
    async completeOperation() {
      // Local development storage has no distributed operation ledger.
    },
  };
}

let repository: WeeklyPlanningApprovalPlanRepository | null = null;

export function getWeeklyPlanningApprovalPlanRepository(): WeeklyPlanningApprovalPlanRepository {
  if (repository) return repository;
  const firestore = getFirestoreDb();
  repository = firestore
    ? createFirestoreWeeklyPlanningApprovalPlanRepository(firestore)
    : createPlannerBackedWeeklyPlanningApprovalPlanRepository();
  return repository;
}

export function setWeeklyPlanningApprovalPlanRepositoryForTests(
  next: WeeklyPlanningApprovalPlanRepository | null,
): void {
  repository = next;
}
