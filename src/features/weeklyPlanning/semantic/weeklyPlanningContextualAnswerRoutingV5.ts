import type {
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import type {
  WeeklyPlanningPendingQuestionV5,
} from './weeklyPlanningPendingQuestionV5';

function hasDurationAnswer(document: WeeklyPlanningSemanticDocumentV5): boolean {
  return document.tasks.some((task) => task.effortEstimates.some((estimate) =>
    Number.isFinite(estimate.minutes) && estimate.minutes > 0));
}

function hasQuantityRoleAnswer(document: WeeklyPlanningSemanticDocumentV5): boolean {
  return document.tasks.some((task) => [
    ...task.workloads,
    ...(task.study?.components ?? []).flatMap((component) => component.workloads),
  ].some((workload) =>
    workload.quantityRole === 'target'
    || workload.quantityRole === 'remaining'
    || workload.quantityRole === 'completed'));
}

function hasIndependentSemanticDelta(
  document: WeeklyPlanningSemanticDocumentV5,
): boolean {
  if (
    document.planningWindow !== null
    || document.relations.length > 0
    || document.availabilityDeclarations.length > 0
    || document.constraintSourceRequests.length > 0
    || document.userContextFacts.length > 0
    || document.uncertainties.length > 0
    || document.corrections.length > 0
    || document.decisions.length > 0
  ) return true;

  return document.tasks.some((task) =>
    task.temporalConstraints.length > 0
    || task.recurrence.length > 0
    || (task.durableContextSignals?.length ?? 0) > 0
    || (task.study?.components.length ?? 0) > 0
    || task.workloads.some((workload) =>
      workload.quantityRole === 'remaining' || workload.quantityRole === 'completed'));
}

export function shouldAttemptWeeklyPlanningContextualAnswerV5(params: {
  document: WeeklyPlanningSemanticDocumentV5;
  pendingQuestion: WeeklyPlanningPendingQuestionV5;
}): boolean {
  if (params.pendingQuestion.questionCode === 'semantic_uncertainty') return true;

  if (params.pendingQuestion.questionCode === 'missing_effort_estimate') {
    if (hasDurationAnswer(params.document)) return true;
    return !hasIndependentSemanticDelta(params.document);
  }

  if (params.pendingQuestion.questionCode === 'quantity_role_unresolved') {
    if (hasQuantityRoleAnswer(params.document)) return true;
    return !hasIndependentSemanticDelta(params.document);
  }

  return true;
}
