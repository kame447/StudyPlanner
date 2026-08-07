import {
  SEMANTIC_RECURRENCE_KINDS_V5,
  type SemanticRecurrenceKindV5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

export const WEEKLY_PLANNING_RECURRENCE_CONSISTENCY_VERSION_V5 =
  'weekly-planning-recurrence-consistency-v5' as const;

const RECURRENCE_KINDS = new Set<string>(SEMANTIC_RECURRENCE_KINDS_V5);

function expectedRecurrence(periodExpression: string | null): SemanticRecurrenceKindV5 | null {
  if (!periodExpression) return null;
  const normalized = periodExpression.normalize('NFKC').trim().toLowerCase();
  if (normalized.startsWith('custom:')) return 'custom';
  return RECURRENCE_KINDS.has(normalized)
    ? normalized as SemanticRecurrenceKindV5
    : null;
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
