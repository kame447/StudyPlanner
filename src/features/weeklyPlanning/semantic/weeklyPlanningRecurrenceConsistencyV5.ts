import type {
  SemanticRecurrenceKindV5,
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

export const WEEKLY_PLANNING_RECURRENCE_CONSISTENCY_VERSION_V5 =
  'weekly-planning-recurrence-consistency-v5' as const;

const EXPLICIT_RECURRENCE_PERIODS = new Map<string, SemanticRecurrenceKindV5>([
  ['daily', 'daily'],
  ['weekdays', 'weekdays'],
  ['weekends', 'weekends'],
]);

function expectedRecurrence(periodExpression: string | null): SemanticRecurrenceKindV5 | null {
  if (!periodExpression) return null;
  return EXPLICIT_RECURRENCE_PERIODS.get(
    periodExpression.normalize('NFKC').trim().toLowerCase(),
  ) ?? null;
}

export function validateWeeklyPlanningRecurrenceConsistencyV5(
  document: WeeklyPlanningSemanticDocumentV5,
): string[] {
  const errors: string[] = [];

  for (const [taskIndex, task] of document.tasks.entries()) {
    const checkWorkloads = (
      workloads: typeof task.workloads,
      targetLocalId: string,
      path: string,
    ): void => {
      workloads.forEach((workload, workloadIndex) => {
        if (!workload.perOccurrence) return;
        const expected = expectedRecurrence(workload.periodExpression);
        if (!expected) return;
        const matching = task.recurrence.some(
          (recurrence) => recurrence.targetLocalId === targetLocalId
            && recurrence.kind === expected,
        );
        if (!matching) {
          errors.push(
            `${path}[${workloadIndex}]:explicit-recurrence-missing:expected=${expected}:target=${targetLocalId}`,
          );
        }
      });
    };

    checkWorkloads(task.workloads, task.localId, `document.tasks[${taskIndex}].workloads`);
    for (const [componentIndex, component] of (task.study?.components ?? []).entries()) {
      checkWorkloads(
        component.workloads,
        component.localId,
        `document.tasks[${taskIndex}].study.components[${componentIndex}].workloads`,
      );
    }
  }

  return errors;
}
