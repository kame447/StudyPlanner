import {
  weeklyPlanningFactKindByIdV5,
} from './weeklyPlanningFactLifecycleV5';
import type {
  PlanningFactLifecycleEntryV5,
  WeeklyPlanningFactDiffEntryV5,
  WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';

export const WEEKLY_PLANNING_FACT_LIFECYCLE_ENGINE_VERSION_V5 =
  'weekly-planning-fact-lifecycle-engine-v5' as const;

export type WeeklyPlanningFactLifecycleOperationV5 =
  | {
      operationKey: string;
      kind: 'remove';
      targetFactId: string;
    }
  | {
      operationKey: string;
      kind: 'supersede';
      targetFactId: string;
      replacementFactId: string;
    };

export interface WeeklyPlanningFactLifecycleResultV5 {
  engineVersion: typeof WEEKLY_PLANNING_FACT_LIFECYCLE_ENGINE_VERSION_V5;
  status: 'applied' | 'duplicate' | 'rejected';
  graph: WeeklyPlanningFactGraphV5;
  superseded: WeeklyPlanningFactDiffEntryV5[];
  removed: WeeklyPlanningFactDiffEntryV5[];
  errors: string[];
}

function reject(
  graph: WeeklyPlanningFactGraphV5,
  errors: string[],
): WeeklyPlanningFactLifecycleResultV5 {
  return {
    engineVersion: WEEKLY_PLANNING_FACT_LIFECYCLE_ENGINE_VERSION_V5,
    status: 'rejected',
    graph,
    superseded: [],
    removed: [],
    errors,
  };
}

function lifecycleByFactId(
  graph: WeeklyPlanningFactGraphV5,
): Map<string, PlanningFactLifecycleEntryV5> {
  return new Map(graph.factLifecycles.map((entry) => [entry.factId, entry]));
}

function activeDependentFactIds(
  graph: WeeklyPlanningFactGraphV5,
  targetFactId: string,
): string[] {
  const activeIds = new Set(
    graph.factLifecycles
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.factId),
  );
  const dependentIds = new Set<string>();
  const addIfDependent = (factId: string, dependsOnTarget: boolean): void => {
    if (
      dependsOnTarget
      && factId !== targetFactId
      && activeIds.has(factId)
    ) dependentIds.add(factId);
  };

  graph.studyContexts.forEach((fact) =>
    addIfDependent(fact.id, fact.taskId === targetFactId));
  graph.components.forEach((fact) =>
    addIfDependent(
      fact.id,
      fact.taskId === targetFactId || fact.parentComponentId === targetFactId,
    ));
  graph.workloads.forEach((fact) =>
    addIfDependent(
      fact.id,
      fact.taskId === targetFactId || fact.componentId === targetFactId,
    ));
  graph.effortEstimates.forEach((fact) =>
    addIfDependent(
      fact.id,
      fact.taskId === targetFactId || fact.targetFactId === targetFactId,
    ));
  graph.temporalConstraints.forEach((fact) =>
    addIfDependent(
      fact.id,
      fact.taskId === targetFactId || fact.targetFactId === targetFactId,
    ));
  graph.taskDateRules.forEach((fact) =>
    addIfDependent(
      fact.id,
      fact.taskId === targetFactId || fact.targetFactId === targetFactId,
    ));
  graph.recurrences.forEach((fact) =>
    addIfDependent(
      fact.id,
      fact.taskId === targetFactId || fact.targetFactId === targetFactId,
    ));
  graph.relations.forEach((fact) =>
    addIfDependent(
      fact.id,
      fact.fromTaskId === targetFactId || fact.toTaskId === targetFactId,
    ));
  graph.uncertainties.forEach((fact) =>
    addIfDependent(fact.id, fact.targetFactId === targetFactId));

  return [...dependentIds].sort();
}

export function applyWeeklyPlanningFactLifecycleOperationV5(params: {
  graph: WeeklyPlanningFactGraphV5;
  expectedRevision: number;
  operation: WeeklyPlanningFactLifecycleOperationV5;
}): WeeklyPlanningFactLifecycleResultV5 {
  const { graph, operation } = params;
  if (!operation.operationKey.trim()) return reject(graph, ['operation-key-required']);
  if (graph.appliedLifecycleOperationKeys.includes(operation.operationKey)) {
    return {
      engineVersion: WEEKLY_PLANNING_FACT_LIFECYCLE_ENGINE_VERSION_V5,
      status: 'duplicate',
      graph,
      superseded: [],
      removed: [],
      errors: [],
    };
  }
  if (params.expectedRevision !== graph.revision) {
    return reject(graph, [
      `revision-mismatch:expected=${params.expectedRevision}:actual=${graph.revision}`,
    ]);
  }

  const kinds = weeklyPlanningFactKindByIdV5(graph);
  const targetKind = kinds.get(operation.targetFactId);
  if (!targetKind) return reject(graph, [`unknown-target-fact:${operation.targetFactId}`]);
  const lifecycleById = lifecycleByFactId(graph);
  const targetLifecycle = lifecycleById.get(operation.targetFactId);
  if (!targetLifecycle) {
    return reject(graph, [`missing-target-lifecycle:${operation.targetFactId}`]);
  }
  if (targetLifecycle.status !== 'active') {
    return reject(graph, [
      `target-fact-not-active:${operation.targetFactId}:${targetLifecycle.status}`,
    ]);
  }

  const activeDependents = activeDependentFactIds(graph, operation.targetFactId);
  if (activeDependents.length > 0) {
    return reject(graph, [
      `target-has-active-dependents:${operation.targetFactId}:${activeDependents.join(',')}`,
    ]);
  }

  let replacementFactId: string | null = null;
  if (operation.kind === 'supersede') {
    if (operation.replacementFactId === operation.targetFactId) {
      return reject(graph, ['replacement-must-differ-from-target']);
    }
    if (!kinds.has(operation.replacementFactId)) {
      return reject(graph, [`unknown-replacement-fact:${operation.replacementFactId}`]);
    }
    const replacementLifecycle = lifecycleById.get(operation.replacementFactId);
    if (!replacementLifecycle) {
      return reject(graph, [`missing-replacement-lifecycle:${operation.replacementFactId}`]);
    }
    if (replacementLifecycle.status !== 'active') {
      return reject(graph, [
        `replacement-fact-not-active:${operation.replacementFactId}:${replacementLifecycle.status}`,
      ]);
    }
    replacementFactId = operation.replacementFactId;
  }

  const nextRevision = graph.revision + 1;
  const nextLifecycles = graph.factLifecycles.map((entry) => {
    if (entry.factId !== operation.targetFactId) return entry;
    return {
      ...entry,
      status: operation.kind === 'remove' ? 'removed' as const : 'superseded' as const,
      terminalRevision: nextRevision,
      supersededByFactId: replacementFactId,
    };
  });
  const diffEntry = { kind: targetKind, id: operation.targetFactId };
  return {
    engineVersion: WEEKLY_PLANNING_FACT_LIFECYCLE_ENGINE_VERSION_V5,
    status: 'applied',
    graph: {
      ...graph,
      revision: nextRevision,
      appliedLifecycleOperationKeys: [
        ...graph.appliedLifecycleOperationKeys,
        operation.operationKey,
      ],
      factLifecycles: nextLifecycles,
    },
    superseded: operation.kind === 'supersede' ? [diffEntry] : [],
    removed: operation.kind === 'remove' ? [diffEntry] : [],
    errors: [],
  };
}

export function applyWeeklyPlanningCorrectionIntentV5(params: {
  graph: WeeklyPlanningFactGraphV5;
  expectedRevision: number;
  correctionIntentFactId: string;
  operationKey: string;
}): WeeklyPlanningFactLifecycleResultV5 {
  const correction = params.graph.correctionIntents.find(
    (fact) => fact.id === params.correctionIntentFactId,
  );
  if (!correction) {
    return reject(params.graph, [
      `unknown-correction-intent:${params.correctionIntentFactId}`,
    ]);
  }
  const correctionLifecycle = params.graph.factLifecycles.find(
    (entry) => entry.factId === correction.id,
  );
  if (!correctionLifecycle || correctionLifecycle.status !== 'active') {
    return reject(params.graph, [
      `correction-intent-not-active:${params.correctionIntentFactId}`,
    ]);
  }
  if (!correction.target.factId) {
    return reject(params.graph, ['correction-target-not-resolved']);
  }
  if (correction.operation === 'remove') {
    return applyWeeklyPlanningFactLifecycleOperationV5({
      graph: params.graph,
      expectedRevision: params.expectedRevision,
      operation: {
        operationKey: params.operationKey,
        kind: 'remove',
        targetFactId: correction.target.factId,
      },
    });
  }
  if (!correction.replacementFactId) {
    return reject(params.graph, ['correction-replacement-not-resolved']);
  }
  return applyWeeklyPlanningFactLifecycleOperationV5({
    graph: params.graph,
    expectedRevision: params.expectedRevision,
    operation: {
      operationKey: params.operationKey,
      kind: 'supersede',
      targetFactId: correction.target.factId,
      replacementFactId: correction.replacementFactId,
    },
  });
}
