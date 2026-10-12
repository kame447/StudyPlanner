import type { UncertaintyFactV5, WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { resolveWeeklyPlanningExistingEntityGraphBindingsV5 } from './weeklyPlanningExistingEntityBindingV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './weeklyPlanningActiveSchedulerGraphViewV5';

/** A valid detail need not answer an open question. Implicit retirement requires
 * compatible typed evidence for the exact bound target; explicit corrections
 * retain their own canonical transaction and authorization boundary. */
export function hasWeeklyPlanningSemanticUncertaintyResolutionV5(params: {
  graph: WeeklyPlanningFactGraphV5;
  document: WeeklyPlanningSemanticDocumentV5;
  uncertainty: UncertaintyFactV5;
}): boolean {
  const { graph, document, uncertainty } = params;
  const target = uncertainty.targetFactId;
  const bindings = resolveWeeklyPlanningExistingEntityGraphBindingsV5({ graph, document });
  if (bindings.errors.length > 0) return false;
  const boundId = (localId: string) => bindings.taskFactIdByLocalId[localId]
    ?? bindings.componentFactIdByLocalId[localId]
    ?? bindings.workloadFactIdByLocalId[localId]
    ?? localId;
  if (document.uncertainties.some((current) => current.field === uncertainty.field
    && (current.targetLocalId === null || current.targetLocalId === 'document'
      || target === null || boundId(current.targetLocalId) === target))) return false;
  if (graph.planningWindows.some((window) => window.id === target)) {
    // Only an exact formal replacement can use the established contextual
    // removal-before-correction path. A bare window or unrelated detail cannot.
    return (uncertainty.field === 'planningWindow' || uncertainty.field === 'planning_window')
      && createWeeklyPlanningActiveSchedulerGraphViewV5(graph).planningWindows.some((window) => window.id === target)
      && document.planningWindow !== null
      && !document.uncertainties.some((current) => current.field === uncertainty.field
        && current.targetLocalId === document.planningWindow!.localId)
      && document.corrections.some((correction) => correction.target.kind === 'planning_window'
        && correction.target.publicId === target && correction.target.localId === null
        && (correction.operation === 'replace' || correction.operation === 'modify')
        && correction.replacementLocalId === document.planningWindow!.localId);
  }
  if (uncertainty.field === 'planningWindow' || uncertainty.field === 'planning_window') {
    return target === null && document.planningWindow !== null;
  }
  if (uncertainty.field === 'constraintSource') {
    return target === null && document.constraintSourceRequests.length > 0;
  }
  if (!target) return false;
  const active = createWeeklyPlanningActiveSchedulerGraphViewV5(graph);

  const hasCurrentTaskTimeBudget = (task: WeeklyPlanningSemanticDocumentV5['tasks'][number]) => {
    const workloads = [...task.workloads, ...(task.study?.components ?? []).flatMap((component) => component.workloads)];
    const existingWorkloads = active.workloads.filter((workload) => workload.taskId === target);
    if ([...existingWorkloads, ...workloads].some((workload) =>
      workload.unitCode !== 'minute' && workload.unitCode !== 'hour')) return false;
    if ([...active.temporalConstraints.filter((constraint) => constraint.taskId === target), ...task.temporalConstraints]
      .some((constraint) => constraint.kind === 'fixed_interval' && constraint.constraintLevel === 'hard')) return false;
    const currentTotals = task.effortEstimates.filter((estimate) =>
      estimate.kind === 'total_duration' && boundId(estimate.targetLocalId) === target);
    const totals = [
      ...active.effortEstimates.filter((estimate) => estimate.targetFactId === target && estimate.kind === 'total_duration'),
      ...currentTotals,
    ];
    if (totals.some((estimate) => !Number.isFinite(estimate.minutes) || estimate.minutes <= 0)
      || new Set(totals.map((estimate) => estimate.minutes)).size > 1) return false;
    // Existing stated-time-budget contract: explicit clock-unit work, or one
    // task total with no workload. Rate/session costs do not establish structure.
    return task.workloads.some((workload) => workload.quantityRole === 'target'
      && (workload.unitCode === 'minute' || workload.unitCode === 'hour')
      && Number.isFinite(workload.amount) && workload.amount > 0)
      || (existingWorkloads.length === 0 && workloads.length === 0 && currentTotals.length > 0);
  };

  const contentWorkIsNew = (workload: WeeklyPlanningSemanticDocumentV5['tasks'][number]['workloads'][number]) =>
    !bindings.workloadFactIdByLocalId[workload.localId]
    && !active.workloads.some((existing) => existing.id === workload.localId)
    && workload.unitCode !== 'minute' && workload.unitCode !== 'hour';
  const componentIsNew = (component: NonNullable<WeeklyPlanningSemanticDocumentV5['tasks'][number]['study']>['components'][number]) =>
    !component.existingPublicId && !bindings.componentFactIdByLocalId[component.localId];
  const hasNewStructure = (task: WeeklyPlanningSemanticDocumentV5['tasks'][number], taskMatches: boolean): boolean => {
    const components = task.study?.components ?? [];
    if (taskMatches && components.some(componentIsNew)) return true;
    if (taskMatches && task.workloads.some(contentWorkIsNew)) return true;
    return components.some((component) =>
      (taskMatches || boundId(component.localId) === target) && component.workloads.some(contentWorkIsNew));
  };

  for (const task of document.tasks) {
    const taskMatches = boundId(task.localId) === target;
    const components = task.study?.components ?? [];
    switch (uncertainty.field) {
      case 'work_breakdown':
        if (taskMatches && (hasNewStructure(task, true) || hasCurrentTaskTimeBudget(task))) return true;
        break;
      case 'material_identity':
        if (taskMatches && components.some((component) => component.role === 'material' && componentIsNew(component))) return true;
        break;
      case 'quantityRole':
      case 'amount': {
        const workloads = [...task.workloads, ...components.flatMap((component) => component.workloads)];
        if (workloads.some((workload) => boundId(workload.localId) === target
          && (uncertainty.field !== 'quantityRole'
            || workload.quantityRole === 'target' || workload.quantityRole === 'remaining'
            || workload.quantityRole === 'completed'))) return true;
        break;
      }
      case 'total_duration':
      case 'duration_per_unit':
      case 'session_duration':
        if (task.effortEstimates.some((estimate) => estimate.kind === uncertainty.field
          && boundId(estimate.targetLocalId) === target)) return true;
        break;
      default:
        // Free-form names are not parsed. Only a new bound structural
        // contribution can resolve them; shells, replays and costs cannot.
        if (hasNewStructure(task, taskMatches)) return true;
    }
  }
  return false;
}
