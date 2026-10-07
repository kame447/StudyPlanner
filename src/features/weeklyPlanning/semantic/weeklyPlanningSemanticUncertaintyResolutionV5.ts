import type { UncertaintyFactV5, WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { resolveWeeklyPlanningExistingEntityGraphBindingsV5 } from './weeklyPlanningExistingEntityBindingV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './weeklyPlanningActiveSchedulerGraphViewV5';
import { weeklyPlanningMaterialIdentityAnswersV5 } from './weeklyPlanningMaterialIdentityAnswerV5';

/**
 * A delta is not an answer to every open need. Match the validated payload's
 * dimension and exact bound target before implicitly retiring an uncertainty.
 * Free-form fields require a new structural contribution for the exact target;
 * neither prose, task shells, replayed facts nor effort-only details prove
 * resolution. Explicit corrections still pass through the normal commit.
 */
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
    && (current.targetLocalId === null || target === null || boundId(current.targetLocalId) === target))) return false;
  // These are plan-wide dimensions; document-level uncertainties have no
  // target fact. A matching window/source payload answers only that dimension.
  if (uncertainty.field === 'planningWindow' || uncertainty.field === 'planning_window') {
    return document.planningWindow !== null
      && (target === null || graph.planningWindows.some((window) => window.id === target));
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
    // This mirrors the stated-time-budget contract without constructing a
    // prospective graph: explicit clock-unit work, or one task-level total
    // while no workload of any role exists. Session/rate costs never qualify.
    return task.workloads.some((workload) => workload.quantityRole === 'target'
      && (workload.unitCode === 'minute' || workload.unitCode === 'hour')
      && Number.isFinite(workload.amount) && workload.amount > 0)
      || (existingWorkloads.length === 0 && workloads.length === 0 && currentTotals.length > 0);
  };

  for (const task of document.tasks) {
    const taskMatches = boundId(task.localId) === target;
    const components = task.study?.components ?? [];
    switch (uncertainty.field) {
      case 'work_breakdown':
        if (!taskMatches) break;
        if (components.some((component) => !component.existingPublicId)) return true;
        // The stated-time-budget contract permits atomic work without a
        // content quantity. A rate for already bounded content is its cost,
        // and cannot answer a still-open structure/material question (B).
        if (hasCurrentTaskTimeBudget(task)) return true;
        break;
      case 'material_identity':
        if (weeklyPlanningMaterialIdentityAnswersV5(graph, document).some((answer) => answer.targetId === target)) return true;
        if (taskMatches && components.some((component) =>
          component.role === 'material' && !component.existingPublicId)) return true;
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
          && (boundId(estimate.targetLocalId) === target || taskMatches))) return true;
        break;
      default: {
        // The schema deliberately leaves field names free-form (the live B
        // provider used "material"). Do not infer their meaning from that
        // string. A new constituent/content quantity is structural evidence;
        // known identity shells and cost/session/time-budget answers are not.
        if (taskMatches && components.some((component) =>
          !component.existingPublicId && !bindings.componentFactIdByLocalId[component.localId])) return true;
        const contentWorkIsNew = (workload: WeeklyPlanningSemanticDocumentV5['tasks'][number]['workloads'][number]) =>
          !bindings.workloadFactIdByLocalId[workload.localId]
          && !active.workloads.some((existing) => existing.id === workload.localId)
          && workload.unitCode !== 'minute' && workload.unitCode !== 'hour';
        if (taskMatches && task.workloads.some(contentWorkIsNew)) return true;
        if (components.some((component) =>
          (taskMatches || boundId(component.localId) === target)
          && component.workloads.some(contentWorkIsNew))) return true;
        break;
      }
    }
  }
  return false;
}
