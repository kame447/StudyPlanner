import { vi } from 'vitest';
import type { PlannerRepository } from '../repositories/repositoryContracts';

// Test-owned inventory: intentionally independent of production repair routing.
export const plannerReadMethods = [
  'getScheduleSnapshot', 'getPlans', 'getActuals', 'getDayNotes', 'getMonthEvents', 'getTodos', 'getStudySubjects',
  'getStudyMaterials', 'getScheduleTemplates', 'getTimetableTerms', 'getTimetablePeriods',
] as const satisfies readonly (keyof PlannerRepository)[];

/** Observe the real facade without replacing its results or scheduling. */
export function spyPlannerReads(repository: PlannerRepository) {
  return Object.fromEntries(plannerReadMethods.map(name => [name, vi.spyOn(repository, name)]));
}

// Full loads share the canonical schedule read; narrow repair getters remain separate.
export const plannerFullReadMethods = plannerReadMethods.filter(name => name !== 'getPlans' && name !== 'getMonthEvents');
