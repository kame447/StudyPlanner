import { vi, type MockInstance } from 'vitest';
import type { PlannerRepository } from '../repositories/repositoryContracts';

// Test-owned inventory: intentionally independent of production repair routing.
export const plannerReadMethods = [
  'getScheduleSnapshot', 'getPlans', 'getActuals', 'getDayNotes', 'getMonthEvents', 'getTodos', 'getStudySubjects',
  'getStudyMaterials', 'getScheduleTemplates', 'getTimetableTerms', 'getTimetablePeriods',
] as const satisfies readonly (keyof PlannerRepository)[];

/** Observe the real facade without replacing its results or scheduling. */
export function spyPlannerReads(repository: PlannerRepository) {
  return {
    getScheduleSnapshot: vi.spyOn(repository, 'getScheduleSnapshot'),
    getPlans: vi.spyOn(repository, 'getPlans'),
    getActuals: vi.spyOn(repository, 'getActuals'),
    getDayNotes: vi.spyOn(repository, 'getDayNotes'),
    getMonthEvents: vi.spyOn(repository, 'getMonthEvents'),
    getTodos: vi.spyOn(repository, 'getTodos'),
    getStudySubjects: vi.spyOn(repository, 'getStudySubjects'),
    getStudyMaterials: vi.spyOn(repository, 'getStudyMaterials'),
    getScheduleTemplates: vi.spyOn(repository, 'getScheduleTemplates'),
    getTimetableTerms: vi.spyOn(repository, 'getTimetableTerms'),
    getTimetablePeriods: vi.spyOn(repository, 'getTimetablePeriods'),
  } satisfies {
    [Method in typeof plannerReadMethods[number]]: MockInstance<PlannerRepository[Method]>;
  };
}

// Full loads share the canonical schedule read; narrow repair getters remain separate.
export const plannerFullReadMethods = plannerReadMethods.filter(name => name !== 'getPlans' && name !== 'getMonthEvents');
