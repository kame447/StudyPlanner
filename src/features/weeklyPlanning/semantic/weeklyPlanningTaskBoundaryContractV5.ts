import type {
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

/*
 * Semantic ownership boundary
 *
 * Whether root components share one task context or represent independent tasks
 * is a semantic decision. Deterministic code must not rename a task or split it
 * by comparing titles and component labels.
 *
 * This compatibility normalizer is intentionally identity-only. Structural
 * reference errors remain the validator's responsibility; ambiguous task
 * meaning is repaired by the semantic AI or rejected.
 *
 * Canonical rationale:
 * - docs/ai/tasks/20260803-weekly-planning-ai-semantic-ownership-reset.md
 * - docs/ai/design/20260803-weekly-planning-semantic-ownership-phase2-design.md
 */
export const WEEKLY_PLANNING_TASK_BOUNDARY_CONTRACT_V5 =
  'weekly-planning-task-boundary-contract-v5' as const;

export interface TaskBoundaryNormalizationV5 {
  document: WeeklyPlanningSemanticDocumentV5;
  repairs: string[];
}

export function normalizeTaskBoundariesV5(
  document: WeeklyPlanningSemanticDocumentV5,
): TaskBoundaryNormalizationV5 {
  return { document, repairs: [] };
}

export function taskBoundaryConformanceErrorsV5(
  _document: WeeklyPlanningSemanticDocumentV5,
): string[] {
  return [];
}
