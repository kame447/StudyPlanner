import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';

export const WEEKLY_PLANNING_MAX_SAFE_NUMERIC_VALUE_V5 = Number.MAX_SAFE_INTEGER;

// A week contains at most 336 thirty-minute slices. Keep some headroom for
// custom policies while preventing malformed or legacy data from allocating
// unbounded session arrays.
export const WEEKLY_PLANNING_MAX_GENERATED_SESSION_CHUNKS_V5 = 512;

export function isWeeklyPlanningSafePositiveNumberV5(
  value: unknown,
): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value > 0
    && value <= WEEKLY_PLANNING_MAX_SAFE_NUMERIC_VALUE_V5;
}

export function safeWeeklyPlanningComputedPositiveNumberV5(
  value: number,
): number | null {
  return isWeeklyPlanningSafePositiveNumberV5(value) ? value : null;
}

export function validateWeeklyPlanningSemanticNumericSafetyV5(
  document: WeeklyPlanningSemanticDocumentV5,
): string[] {
  const errors: string[] = [];
  const validateWorkloads = (
    workloads: readonly { amount: number }[],
    path: string,
  ): void => {
    workloads.forEach((workload, index) => {
      if (!isWeeklyPlanningSafePositiveNumberV5(workload.amount)) {
        errors.push(`${path}[${index}].amount`);
      }
    });
  };

  document.tasks.forEach((task, taskIndex) => {
    const taskPath = `document.tasks[${taskIndex}]`;
    validateWorkloads(task.workloads, `${taskPath}.workloads`);
    task.study?.components.forEach((component, componentIndex) => {
      validateWorkloads(
        component.workloads,
        `${taskPath}.study.components[${componentIndex}].workloads`,
      );
    });
    task.effortEstimates.forEach((estimate, estimateIndex) => {
      if (!isWeeklyPlanningSafePositiveNumberV5(estimate.minutes)) {
        errors.push(`${taskPath}.effortEstimates[${estimateIndex}].minutes`);
      }
    });
    task.recurrence.forEach((recurrence, recurrenceIndex) => {
      if (
        recurrence.count !== null
        && !isWeeklyPlanningSafePositiveNumberV5(recurrence.count)
      ) {
        errors.push(`${taskPath}.recurrence[${recurrenceIndex}].count`);
      }
    });
  });

  return errors;
}
