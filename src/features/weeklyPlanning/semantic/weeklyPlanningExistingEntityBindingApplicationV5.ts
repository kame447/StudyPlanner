import type {
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import type {
  WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import type {
  WeeklyPlanningSemanticCanonicalizationResultV5,
} from './weeklyPlanningSemanticCanonicalizerV5';
import {
  resolveWeeklyPlanningExistingEntityGraphBindingsV5,
} from './weeklyPlanningExistingEntityBindingV5';

export const WEEKLY_PLANNING_EXISTING_ENTITY_BINDING_APPLICATION_VERSION_V5 =
  'weekly-planning-existing-entity-binding-application-v5' as const;

export interface WeeklyPlanningExistingEntityBindingApplicationResultV5 {
  version: typeof WEEKLY_PLANNING_EXISTING_ENTITY_BINDING_APPLICATION_VERSION_V5;
  status: 'not_applicable' | 'applied' | 'rejected';
  canonicalization: WeeklyPlanningSemanticCanonicalizationResultV5;
  errors: string[];
}

function rebaseId(
  id: string,
  taskMap: Map<string, string>,
  componentMap: Map<string, string>,
  workloadMap: Map<string, string>,
): string {
  return workloadMap.get(id) ?? componentMap.get(id) ?? taskMap.get(id) ?? id;
}

function nullableRebaseId(
  id: string | null,
  taskMap: Map<string, string>,
  componentMap: Map<string, string>,
  workloadMap: Map<string, string>,
): string | null {
  return id ? rebaseId(id, taskMap, componentMap, workloadMap) : null;
}

export function applyWeeklyPlanningExistingEntityBindingsV5(params: {
  originalGraph: WeeklyPlanningFactGraphV5;
  document: WeeklyPlanningSemanticDocumentV5;
  canonicalization: WeeklyPlanningSemanticCanonicalizationResultV5;
}): WeeklyPlanningExistingEntityBindingApplicationResultV5 {
  if (params.canonicalization.status !== 'applied' || !params.canonicalization.diff) {
    return {
      version: WEEKLY_PLANNING_EXISTING_ENTITY_BINDING_APPLICATION_VERSION_V5,
      status: 'not_applicable',
      canonicalization: params.canonicalization,
      errors: [],
    };
  }

  const bindings = resolveWeeklyPlanningExistingEntityGraphBindingsV5({
    document: params.document,
    graph: params.originalGraph,
  });
  if (bindings.errors.length > 0) {
    return {
      version: WEEKLY_PLANNING_EXISTING_ENTITY_BINDING_APPLICATION_VERSION_V5,
      status: 'rejected',
      canonicalization: {
        ...params.canonicalization,
        status: 'rejected',
        graph: params.originalGraph,
        diff: null,
        errors: bindings.errors,
      },
      errors: bindings.errors,
    };
  }

  const taskMap = new Map<string, string>();
  const componentMap = new Map<string, string>();
  const workloadMap = new Map<string, string>();
  const localToFactId = { ...params.canonicalization.localToFactId };
  for (const [localId, existingId] of Object.entries(bindings.taskFactIdByLocalId)) {
    const temporaryId = params.canonicalization.localToFactId[localId];
    if (!temporaryId) {
      const error = `missing-temporary-task-binding:${localId}`;
      return {
        version: WEEKLY_PLANNING_EXISTING_ENTITY_BINDING_APPLICATION_VERSION_V5,
        status: 'rejected',
        canonicalization: {
          ...params.canonicalization,
          status: 'rejected',
          graph: params.originalGraph,
          diff: null,
          errors: [error],
        },
        errors: [error],
      };
    }
    taskMap.set(temporaryId, existingId);
    localToFactId[localId] = existingId;
  }
  for (const [localId, existingId] of Object.entries(bindings.componentFactIdByLocalId)) {
    const temporaryId = params.canonicalization.localToFactId[localId];
    if (!temporaryId) {
      const error = `missing-temporary-component-binding:${localId}`;
      return {
        version: WEEKLY_PLANNING_EXISTING_ENTITY_BINDING_APPLICATION_VERSION_V5,
        status: 'rejected',
        canonicalization: {
          ...params.canonicalization,
          status: 'rejected',
          graph: params.originalGraph,
          diff: null,
          errors: [error],
        },
        errors: [error],
      };
    }
    componentMap.set(temporaryId, existingId);
    localToFactId[localId] = existingId;
  }
  for (const [localId, existingId] of Object.entries(bindings.workloadFactIdByLocalId)) {
    const temporaryId = params.canonicalization.localToFactId[localId];
    if (!temporaryId) {
      const error = `missing-temporary-workload-binding:${localId}`;
      return {
        version: WEEKLY_PLANNING_EXISTING_ENTITY_BINDING_APPLICATION_VERSION_V5,
        status: 'rejected',
        canonicalization: {
          ...params.canonicalization,
          status: 'rejected',
          graph: params.originalGraph,
          diff: null,
          errors: [error],
        },
        errors: [error],
      };
    }
    workloadMap.set(temporaryId, existingId);
    localToFactId[localId] = existingId;
  }

  if (taskMap.size === 0 && componentMap.size === 0 && workloadMap.size === 0) {
    return {
      version: WEEKLY_PLANNING_EXISTING_ENTITY_BINDING_APPLICATION_VERSION_V5,
      status: 'not_applicable',
      canonicalization: params.canonicalization,
      errors: [],
    };
  }

  const graph = params.canonicalization.graph;
  const transientEntityIds = new Set<string>([
    ...taskMap.keys(),
    ...componentMap.keys(),
    ...workloadMap.keys(),
  ]);
  for (const context of graph.studyContexts) {
    if (taskMap.has(context.taskId)) transientEntityIds.add(context.id);
  }
  const existingWorkloads = new Map(
    params.originalGraph.workloads.map((workload) => [workload.id, workload]),
  );

  const reboundGraph: WeeklyPlanningFactGraphV5 = {
    ...graph,
    factLifecycles: graph.factLifecycles.filter(
      (entry) => !transientEntityIds.has(entry.factId),
    ),
    tasks: graph.tasks.filter((task) => !taskMap.has(task.id)),
    studyContexts: graph.studyContexts.filter(
      (context) => !taskMap.has(context.taskId),
    ),
    components: graph.components
      .filter((component) => !componentMap.has(component.id))
      .map((component) => ({
        ...component,
        taskId: taskMap.get(component.taskId) ?? component.taskId,
        parentComponentId: nullableRebaseId(
          component.parentComponentId,
          taskMap,
          componentMap,
          workloadMap,
        ),
      })),
    workloads: graph.workloads
      .filter((workload) => !workloadMap.has(workload.id))
      .map((workload) => ({
        ...workload,
        taskId: taskMap.get(workload.taskId) ?? workload.taskId,
        componentId: nullableRebaseId(
          workload.componentId,
          taskMap,
          componentMap,
          workloadMap,
        ),
      })),
    effortEstimates: graph.effortEstimates.map((estimate) => {
      const reboundTarget = rebaseId(
        estimate.targetFactId,
        taskMap,
        componentMap,
        workloadMap,
      );
      const reboundWorkload = workloadMap.has(estimate.targetFactId)
        ? existingWorkloads.get(reboundTarget)
        : null;
      return {
        ...estimate,
        taskId: taskMap.get(estimate.taskId) ?? estimate.taskId,
        targetFactId: reboundTarget,
        unitCode: estimate.kind === 'duration_per_unit' && reboundWorkload
          ? reboundWorkload.unitCode
          : estimate.unitCode,
      };
    }),
    temporalConstraints: graph.temporalConstraints.map((constraint) => ({
      ...constraint,
      taskId: taskMap.get(constraint.taskId) ?? constraint.taskId,
      targetFactId: rebaseId(constraint.targetFactId, taskMap, componentMap, workloadMap),
    })),
    taskDateRules: graph.taskDateRules.map((rule) => ({
      ...rule,
      taskId: taskMap.get(rule.taskId) ?? rule.taskId,
      targetFactId: rebaseId(rule.targetFactId, taskMap, componentMap, workloadMap),
    })),
    recurrences: graph.recurrences.map((recurrence) => ({
      ...recurrence,
      taskId: taskMap.get(recurrence.taskId) ?? recurrence.taskId,
      targetFactId: rebaseId(recurrence.targetFactId, taskMap, componentMap, workloadMap),
    })),
    relations: graph.relations.map((relation) => ({
      ...relation,
      fromTaskId: taskMap.get(relation.fromTaskId) ?? relation.fromTaskId,
      toTaskId: taskMap.get(relation.toTaskId) ?? relation.toTaskId,
    })),
    uncertainties: graph.uncertainties.map((uncertainty) => ({
      ...uncertainty,
      targetFactId: nullableRebaseId(
        uncertainty.targetFactId,
        taskMap,
        componentMap,
        workloadMap,
      ),
    })),
    correctionIntents: graph.correctionIntents.map((correction) => ({
      ...correction,
      target: {
        ...correction.target,
        factId: nullableRebaseId(
          correction.target.factId,
          taskMap,
          componentMap,
          workloadMap,
        ),
      },
      replacementFactId: nullableRebaseId(
        correction.replacementFactId,
        taskMap,
        componentMap,
        workloadMap,
      ),
    })),
    decisionIntents: graph.decisionIntents.map((decision) => ({
      ...decision,
      target: {
        ...decision.target,
        factId: nullableRebaseId(
          decision.target.factId,
          taskMap,
          componentMap,
          workloadMap,
        ),
      },
    })),
  };

  const canonicalization: WeeklyPlanningSemanticCanonicalizationResultV5 = {
    ...params.canonicalization,
    graph: reboundGraph,
    localToFactId,
    diff: {
      ...params.canonicalization.diff,
      added: params.canonicalization.diff.added.filter(
        (entry) => !transientEntityIds.has(entry.id),
      ),
    },
  };
  return {
    version: WEEKLY_PLANNING_EXISTING_ENTITY_BINDING_APPLICATION_VERSION_V5,
    status: 'applied',
    canonicalization,
    errors: [],
  };
}
