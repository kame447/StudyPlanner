import { getFirestoreDb } from '../../../lib/firebaseClient';
import type { Plan, PlanDraft } from '../../../types/domain';
import type { WeeklyDraftApprovalOperation } from '../planning/weeklyPlanningApprovalTypes';
import {
  createFirestoreWeeklyPlanningApprovalPlanRepository,
} from './weeklyPlanningApprovalFirestoreRepository';
import {
  createPlannerBackedWeeklyPlanningApprovalPlanRepository,
} from './weeklyPlanningApprovalLocalRepository';

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
