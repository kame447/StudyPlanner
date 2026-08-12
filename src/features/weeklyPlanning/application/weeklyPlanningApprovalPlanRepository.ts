import { createPlanFromDraft } from '../../../domain/planner';
import { getFirestoreDb } from '../../../lib/firebaseClient';
import type { Plan, PlanDraft } from '../../../types/domain';
import type { WeeklyDraftApprovalOperation } from '../planning/weeklyPlanningApprovalTypes';
import { WEEKLY_PLANNING_PLAN_SOURCE_TYPE } from '../planning/weeklyPlanningPlanProvenance';
import {
  createFirestoreWeeklyPlanningApprovalPlanRepository,
} from './weeklyPlanningApprovalFirestoreRepository';
import {
  resolveApprovalDraftIdentity,
} from './weeklyPlanningApprovalPersistencePolicy';

export {
  createFirestoreWeeklyPlanningApprovalPlanRepository,
} from './weeklyPlanningApprovalFirestoreRepository';
export {
  createMemoryWeeklyPlanningApprovalPlanRepository,
  createWeeklyPlanningApprovalMemoryState,
} from './weeklyPlanningApprovalMemoryRepository';
export type {
  WeeklyPlanningApprovalMemoryState,
} from './weeklyPlanningApprovalMemoryRepository';
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
