import type {
  SemanticWorkloadV5,
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

export const WEEKLY_PLANNING_SEMANTIC_EVIDENCE_VERSION_V5 =
  'weekly-planning-semantic-evidence-v5' as const;

function sameWorkloadBasis(left: SemanticWorkloadV5, right: SemanticWorkloadV5): boolean {
  return left.unitCode === right.unitCode
    && left.perOccurrence === right.perOccurrence
    && left.periodExpression === right.periodExpression
    && left.rangeStart === right.rangeStart
    && left.rangeEnd === right.rangeEnd;
}

function unresolvedProgressErrorsForWorkloads(
  workloads: SemanticWorkloadV5[],
  path: string,
): string[] {
  const errors: string[] = [];
  workloads.forEach((workload, index) => {
    if (workload.quantityRole !== 'declared') return;
    const hasCompletedPeer = workloads.some((candidate, candidateIndex) =>
      candidateIndex !== index
      && candidate.quantityRole === 'completed'
      && sameWorkloadBasis(workload, candidate));
    if (!hasCompletedPeer) return;
    errors.push(
      `${path}[${index}].quantityRole:declared-cannot-coexist-with-completed-same-target-unit;resolve-progress-to-remaining-difference-or-emit-uncertainty`,
    );
  });
  return errors;
}

function unresolvedProgressErrors(
  document: WeeklyPlanningSemanticDocumentV5,
): string[] {
  return document.tasks.flatMap((task, taskIndex) => [
    ...unresolvedProgressErrorsForWorkloads(
      task.workloads,
      `document.tasks[${taskIndex}].workloads`,
    ),
    ...(task.study?.components ?? []).flatMap((component, componentIndex) =>
      unresolvedProgressErrorsForWorkloads(
        component.workloads,
        `document.tasks[${taskIndex}].study.components[${componentIndex}].workloads`,
      )),
  ]);
}

export function validateWeeklyPlanningSemanticEvidenceV5(params: {
  document: WeeklyPlanningSemanticDocumentV5;
}): string[] {
  return [...new Set(unresolvedProgressErrors(params.document))];
}
