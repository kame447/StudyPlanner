import type {
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  validateWeeklyPlanningSemanticValueV5 as validateLegacySemanticValueV5,
} from './weeklyPlanningSemanticValidatorLegacyV5';

/*
 * Semantic ownership boundary
 *
 * The legacy core retains the existing structural, range, date, reference, and
 * lifecycle checks. This wrapper changes only one schema-reference restriction:
 * an effort estimate may target a workload inside the same task, in addition to
 * the task or one of its components.
 *
 * The decision is mechanical. The AI has already selected targetLocalId; this
 * code only verifies that the exact ID exists in the containing task. It must
 * never choose a target from labels, sourceText, quantities, or fuzzy matching.
 *
 * Canonical rationale:
 * - docs/ai/tasks/20260803-weekly-planning-ai-semantic-ownership-reset.md
 * - docs/ai/design/20260803-weekly-planning-semantic-ownership-phase2-design.md
 */
export interface WeeklyPlanningSemanticValidationResultV5 {
  document: WeeklyPlanningSemanticDocumentV5 | null;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function workloadIdsInTask(task: Record<string, unknown>): Set<string> {
  const ids = new Set<string>();
  const registerWorkloads = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    for (const workload of value) {
      if (isRecord(workload) && typeof workload.localId === 'string' && workload.localId) {
        ids.add(workload.localId);
      }
    }
  };

  registerWorkloads(task.workloads);
  if (isRecord(task.study) && Array.isArray(task.study.components)) {
    for (const component of task.study.components) {
      if (isRecord(component)) registerWorkloads(component.workloads);
    }
  }
  return ids;
}

function isValidWorkloadEffortTargetError(
  error: string,
  value: Record<string, unknown>,
): boolean {
  const match = /^document\.tasks\[(\d+)]\.effortEstimates\[(\d+)]\.targetLocalId$/.exec(error);
  if (!match || !Array.isArray(value.tasks)) return false;

  const task = value.tasks[Number(match[1])];
  if (!isRecord(task) || !Array.isArray(task.effortEstimates)) return false;
  const estimate = task.effortEstimates[Number(match[2])];
  if (!isRecord(estimate) || typeof estimate.targetLocalId !== 'string') return false;

  return workloadIdsInTask(task).has(estimate.targetLocalId);
}

export function validateWeeklyPlanningSemanticValueV5(
  value: unknown,
): WeeklyPlanningSemanticValidationResultV5 {
  const legacy = validateLegacySemanticValueV5(value);
  if (legacy.errors.length === 0 || !isRecord(value)) return legacy;

  const errors = legacy.errors.filter(
    (error) => !isValidWorkloadEffortTargetError(error, value),
  );
  return {
    document: errors.length === 0
      ? value as unknown as WeeklyPlanningSemanticDocumentV5
      : null,
    errors,
  };
}

export function parseWeeklyPlanningSemanticDocumentV5(
  content: string,
): WeeklyPlanningSemanticValidationResultV5 {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return { document: null, errors: ['document:invalid-json'] };
  }
  return validateWeeklyPlanningSemanticValueV5(value);
}
