import { getFirestoreDb } from '../../../lib/firebaseClient';
import {
  createFirestoreWeeklyPlanningApprovalPlanRepository,
} from './weeklyPlanningApprovalFirestoreRepository';
import {
  createPlannerBackedWeeklyPlanningApprovalPlanRepository,
} from './weeklyPlanningApprovalLocalRepository';
import type {
  WeeklyPlanningApprovalPlanRepository,
} from './weeklyPlanningApprovalPlanRepositoryContract';

export type {
  WeeklyPlanningApprovalPlanRepository,
} from './weeklyPlanningApprovalPlanRepositoryContract';
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
