import type {
  SemanticEffortEstimateV5,
  SemanticQuantityRoleV5,
  SemanticWorkloadV5,
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import type {
  WeeklyPlanningPendingQuestionV5,
} from './weeklyPlanningPendingQuestionV5';

function effortEstimates(document: WeeklyPlanningSemanticDocumentV5): SemanticEffortEstimateV5[] {
  return document.tasks.flatMap((task) => task.effortEstimates)
    .filter((estimate) => Number.isFinite(estimate.minutes) && estimate.minutes > 0);
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

function progressEstimateTargetFactId(
  pendingQuestion: WeeklyPlanningPendingQuestionV5,
): string | null {
  if (pendingQuestion.questionBasis !== 'completed_workload_total') return null;
  const targetFactId = pendingQuestion.estimateForWorkloadFactId;
  return typeof targetFactId === 'string' && targetFactId.length > 0
    ? targetFactId
    : null;
}

function inheritedMachineWorkload(params: {
  workload: SemanticWorkloadV5;
  pendingQuestion: WeeklyPlanningPendingQuestionV5;
}): boolean {
  return params.workload.localId === params.pendingQuestion.targetFactId
    || params.workload.localId === progressEstimateTargetFactId(params.pendingQuestion);
}

function taskHasIndependentSemanticDelta(params: {
  task: WeeklyPlanningSemanticDocumentV5['tasks'][number];
  pendingQuestion: WeeklyPlanningPendingQuestionV5;
}): boolean {
  const { task, pendingQuestion } = params;
  if (
    task.temporalConstraints.length > 0
    || task.recurrence.length > 0
    || (task.durableContextSignals?.length ?? 0) > 0
  ) return true;

  const workloads = [
    ...task.workloads,
    ...(task.study?.components ?? []).flatMap((component) => component.workloads),
  ];
  if (workloads.some((workload) =>
    (workload.quantityRole === 'remaining' || workload.quantityRole === 'completed')
    && !inheritedMachineWorkload({ workload, pendingQuestion }))) {
    return true;
  }

  /*
   * A normalizer may represent a short answer with a temporary task shell that
   * has no existingPublicId. Task identity alone therefore cannot prove that
   * the user introduced independent work. A target workload without any effort
   * answer is independent; a task carrying an effort answer remains eligible
   * for the guarded contextual binder, which validates the exact pending fact.
   */
  if (
    task.effortEstimates.length === 0
    && workloads.some((workload) =>
      workload.quantityRole === 'target'
      && !inheritedMachineWorkload({ workload, pendingQuestion }))
  ) {
    return true;
  }

  return (task.study?.components ?? []).some((component) => !component.existingPublicId);
}

function hasIndependentSemanticDelta(params: {
  document: WeeklyPlanningSemanticDocumentV5;
  pendingQuestion: WeeklyPlanningPendingQuestionV5;
}): boolean {
  const { document, pendingQuestion } = params;
  if (
    document.planningWindow !== null
    || document.relations.length > 0
    || document.availabilityDeclarations.length > 0
    || document.constraintSourceRequests.length > 0
    || (document.userContextFacts?.length ?? 0) > 0
    || document.uncertainties.length > 0
    || document.corrections.length > 0
    || document.decisions.length > 0
  ) return true;

  if (
    document.tasks.length > 1
    && document.tasks.some((task) => !task.existingPublicId)
  ) {
    return true;
  }

  return document.tasks.some((task) => taskHasIndependentSemanticDelta({
    task,
    pendingQuestion,
  }));
}

function isExplicitAlternateMeasurement(params: {
  estimate: SemanticEffortEstimateV5;
  pendingMeasurement: WeeklyPlanningPendingQuestionV5['effortMeasurement'];
}): boolean {
  if (params.estimate.kind === params.pendingMeasurement) return false;

  return params.estimate.kind === 'duration_per_unit'
    && params.estimate.unitCode !== null;
}

function workloadRoleForLocalId(params: {
  document: WeeklyPlanningSemanticDocumentV5;
  localId: string;
}): SemanticQuantityRoleV5 | null {
  for (const task of params.document.tasks) {
    const taskWorkload = task.workloads.find((workload) => workload.localId === params.localId);
    if (taskWorkload) return taskWorkload.quantityRole;
    for (const component of task.study?.components ?? []) {
      const componentWorkload = component.workloads.find(
        (workload) => workload.localId === params.localId,
      );
      if (componentWorkload) return componentWorkload.quantityRole;
    }
  }
  return null;
}

export function contextualAnswerTargetFactIdV5(params: {
  document: WeeklyPlanningSemanticDocumentV5;
  pendingQuestion: WeeklyPlanningPendingQuestionV5;
}): string | null {
  const pendingTarget = params.pendingQuestion.targetFactId;
  if (!pendingTarget) return null;
  if (params.pendingQuestion.questionCode !== 'missing_effort_estimate') {
    return pendingTarget;
  }

  const estimateTarget = progressEstimateTargetFactId(params.pendingQuestion);
  if (!estimateTarget || estimateTarget === pendingTarget) return pendingTarget;

  const estimates = effortEstimates(params.document);
  if (estimates.length !== 1) return pendingTarget;
  const estimate = estimates[0];

  if (estimate.kind === 'duration_per_unit' && estimate.unitCode !== null) {
    return estimateTarget;
  }
  if (estimate.targetLocalId === estimateTarget) return estimateTarget;
  if (estimate.targetLocalId === pendingTarget) return pendingTarget;

  const semanticTargetRole = workloadRoleForLocalId({
    document: params.document,
    localId: estimate.targetLocalId,
  });
  if (semanticTargetRole === 'remaining') return estimateTarget;
  if (semanticTargetRole === 'completed') return pendingTarget;

  /*
   * A generic semantic fallback can preserve the effort value while losing
   * whether a total duration referred to completed evidence or schedulable
   * remaining work. Do not default that directional ambiguity to the question
   * target: doing so silently corrupts the Fact Graph. The focused typed route
   * is responsible for choosing one of the two workload targets.
   */
  return null;
}

export function shouldAttemptWeeklyPlanningContextualAnswerV5(params: {
  document: WeeklyPlanningSemanticDocumentV5;
  pendingQuestion: WeeklyPlanningPendingQuestionV5;
}): boolean {
  if (params.pendingQuestion.questionCode === 'semantic_uncertainty') return true;

  const independentDelta = hasIndependentSemanticDelta(params);

  if (params.pendingQuestion.questionCode === 'missing_effort_estimate') {
    const estimates = effortEstimates(params.document);
    if (estimates.length === 1) {
      if (independentDelta) return false;
      if (
        progressEstimateTargetFactId(params.pendingQuestion)
        && contextualAnswerTargetFactIdV5(params) === null
      ) {
        return false;
      }
      if (estimates[0].kind === params.pendingQuestion.effortMeasurement) return true;
      if (isExplicitAlternateMeasurement({
        estimate: estimates[0],
        pendingMeasurement: params.pendingQuestion.effortMeasurement,
      })) return true;
      return true;
    }
    if (estimates.length > 1) return false;
    return !independentDelta;
  }

  if (params.pendingQuestion.questionCode === 'quantity_role_unresolved') {
    if (independentDelta) return false;
    if (hasQuantityRoleAnswer(params.document)) return true;
    return true;
  }

  return true;
}
