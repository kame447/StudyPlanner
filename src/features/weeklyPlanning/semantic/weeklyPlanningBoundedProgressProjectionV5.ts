import {
  applyWeeklyPlanningFactLifecycleOperationV5,
} from './weeklyPlanningFactLifecycleEngineV5';
import type {
  WeeklyPlanningFactDiffEntryV5,
  WeeklyPlanningFactGraphV5,
  WorkloadFactV5,
} from './weeklyPlanningFactGraphV5';
import type {
  WeeklyPlanningSemanticCanonicalizationResultV5,
} from './weeklyPlanningSemanticCanonicalizerV5';

export const WEEKLY_PLANNING_BOUNDED_PROGRESS_PROJECTION_VERSION_V5 =
  'weekly-planning-bounded-progress-projection-v5' as const;

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function activeIds(graph: WeeklyPlanningFactGraphV5): Set<string> {
  return new Set(
    graph.factLifecycles
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.factId),
  );
}

function sameOwner(left: WorkloadFactV5, right: WorkloadFactV5): boolean {
  return left.taskId === right.taskId && left.componentId === right.componentId;
}

function sameBoundedBasis(left: WorkloadFactV5, right: WorkloadFactV5): boolean {
  return sameOwner(left, right)
    && left.unitCode === right.unitCode
    && left.unitLabel === right.unitLabel
    && left.rangeStart === right.rangeStart
    && left.rangeEnd === right.rangeEnd
    && left.perOccurrence === right.perOccurrence
    && left.periodExpression === right.periodExpression;
}

function isPercentage(fact: WorkloadFactV5): boolean {
  return fact.unitCode === 'custom' && fact.unitLabel.trim() === '%';
}

function isDerivedBoundedRemaining(fact: WorkloadFactV5): boolean {
  return fact.source.semanticLocalId.includes(':derived-bounded-remaining:');
}

function uniqueEntries(entries: WeeklyPlanningFactDiffEntryV5[]): WeeklyPlanningFactDiffEntryV5[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.kind}:${entry.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rejected(params: {
  originalGraph: WeeklyPlanningFactGraphV5;
  canonicalization: WeeklyPlanningSemanticCanonicalizationResultV5;
  error: string;
}): WeeklyPlanningSemanticCanonicalizationResultV5 {
  return {
    status: 'rejected',
    graph: params.originalGraph,
    diff: null,
    errors: [params.error],
    localToFactId: params.canonicalization.localToFactId,
  };
}

function removeFact(params: {
  graph: WeeklyPlanningFactGraphV5;
  factId: string;
  operationKey: string;
}) {
  return applyWeeklyPlanningFactLifecycleOperationV5({
    graph: params.graph,
    expectedRevision: params.graph.revision,
    operation: {
      operationKey: params.operationKey,
      kind: 'remove',
      targetFactId: params.factId,
    },
  });
}

function supersedeFact(params: {
  graph: WeeklyPlanningFactGraphV5;
  targetFactId: string;
  replacementFactId: string;
  operationKey: string;
}) {
  return applyWeeklyPlanningFactLifecycleOperationV5({
    graph: params.graph,
    expectedRevision: params.graph.revision,
    operation: {
      operationKey: params.operationKey,
      kind: 'supersede',
      targetFactId: params.targetFactId,
      replacementFactId: params.replacementFactId,
    },
  });
}

function appendRemaining(params: {
  graph: WeeklyPlanningFactGraphV5;
  total: WorkloadFactV5;
  completed: WorkloadFactV5;
  amount: number;
  operationKeyPrefix: string;
}): { graph: WeeklyPlanningFactGraphV5; fact: WorkloadFactV5 } {
  const revision = params.graph.revision + 1;
  const id = `wpf_workload_bounded_remaining_${stableHash([
    params.operationKeyPrefix,
    params.total.id,
    params.completed.id,
    params.amount,
  ].join('|'))}`;
  const fact: WorkloadFactV5 = {
    ...params.total,
    id,
    quantityRole: 'remaining',
    amount: params.amount,
    source: {
      ...params.completed.source,
      semanticLocalId: `${params.completed.source.semanticLocalId}:derived-bounded-remaining:${id}`,
    },
    createdRevision: revision,
  };
  return {
    fact,
    graph: {
      ...params.graph,
      revision,
      workloads: [...params.graph.workloads, fact],
      factLifecycles: [
        ...params.graph.factLifecycles,
        {
          factId: id,
          status: 'active',
          createdRevision: revision,
          terminalRevision: null,
          supersededByFactId: null,
        },
      ],
    },
  };
}

function retirePercentageRemainders(params: {
  graph: WeeklyPlanningFactGraphV5;
  owner: WorkloadFactV5;
  operationKeyPrefix: string;
}): {
  status: 'applied' | 'rejected';
  graph: WeeklyPlanningFactGraphV5;
  removed: WeeklyPlanningFactDiffEntryV5[];
  errors: string[];
} {
  let graph = params.graph;
  const removed: WeeklyPlanningFactDiffEntryV5[] = [];
  const ids = activeIds(graph);
  const percentRemainders = graph.workloads.filter((fact) =>
    ids.has(fact.id)
    && sameOwner(fact, params.owner)
    && fact.quantityRole === 'remaining'
    && isPercentage(fact));

  for (const remainder of percentRemainders) {
    const activeNow = activeIds(graph);
    const dependentEfforts = graph.effortEstimates.filter((effort) =>
      activeNow.has(effort.id) && effort.targetFactId === remainder.id);
    for (const effort of dependentEfforts) {
      const effortRemoval = removeFact({
        graph,
        factId: effort.id,
        operationKey: `${params.operationKeyPrefix}:retire-percent-effort:${effort.id}`,
      });
      if (effortRemoval.status === 'rejected') {
        return { status: 'rejected', graph: params.graph, removed: [], errors: effortRemoval.errors };
      }
      graph = effortRemoval.graph;
      removed.push(...effortRemoval.removed);
    }
    const remainderRemoval = removeFact({
      graph,
      factId: remainder.id,
      operationKey: `${params.operationKeyPrefix}:retire-percent-remaining:${remainder.id}`,
    });
    if (remainderRemoval.status === 'rejected') {
      return { status: 'rejected', graph: params.graph, removed: [], errors: remainderRemoval.errors };
    }
    graph = remainderRemoval.graph;
    removed.push(...remainderRemoval.removed);
  }
  return { status: 'applied', graph, removed, errors: [] };
}

export function projectWeeklyPlanningBoundedProgressV5(params: {
  originalGraph: WeeklyPlanningFactGraphV5;
  canonicalization: WeeklyPlanningSemanticCanonicalizationResultV5;
  operationKeyPrefix: string;
}): WeeklyPlanningSemanticCanonicalizationResultV5 {
  const diff = params.canonicalization.diff;
  if (params.canonicalization.status !== 'applied' || !diff) return params.canonicalization;

  let graph = params.canonicalization.graph;
  const added = [...diff.added];
  const superseded = [...diff.superseded];
  const removed = [...diff.removed];
  const newWorkloadIds = new Set(
    diff.added.filter((entry) => entry.kind === 'workload').map((entry) => entry.id),
  );

  const newTotals = graph.workloads.filter((fact) =>
    newWorkloadIds.has(fact.id) && fact.quantityRole === 'scope_total');
  for (const total of newTotals) {
    const retired = retirePercentageRemainders({
      graph,
      owner: total,
      operationKeyPrefix: params.operationKeyPrefix,
    });
    if (retired.status === 'rejected') {
      return rejected({
        originalGraph: params.originalGraph,
        canonicalization: params.canonicalization,
        error: `bounded-progress-percent-retirement:${retired.errors.join(',')}`,
      });
    }
    graph = retired.graph;
    removed.push(...retired.removed);
  }

  const idsAfterRetirement = activeIds(graph);
  const completedToProject = graph.workloads.filter((fact) =>
    idsAfterRetirement.has(fact.id)
    && fact.quantityRole === 'completed'
    && !isPercentage(fact)
    && (
      newWorkloadIds.has(fact.id)
      || newTotals.some((total) =>
        idsAfterRetirement.has(total.id) && sameBoundedBasis(total, fact))
    ));

  const grouped = new Map<string, WorkloadFactV5[]>();
  for (const completed of completedToProject) {
    const key = [
      completed.taskId,
      completed.componentId ?? '',
      completed.unitCode,
      completed.unitLabel,
      completed.rangeStart ?? '',
      completed.rangeEnd ?? '',
      String(completed.perOccurrence),
      completed.periodExpression ?? '',
    ].join('|');
    grouped.set(key, [...(grouped.get(key) ?? []), completed]);
  }
  for (const [key, candidates] of grouped) {
    if (candidates.length > 1) {
      return rejected({
        originalGraph: params.originalGraph,
        canonicalization: params.canonicalization,
        error: `bounded-progress-ambiguous-current-snapshot:${key}`,
      });
    }
  }

  for (const completed of completedToProject) {
    let activeNow = activeIds(graph);
    const totals = graph.workloads.filter((fact) =>
      activeNow.has(fact.id)
      && fact.quantityRole === 'scope_total'
      && sameBoundedBasis(fact, completed));
    if (totals.length === 0) continue;
    if (totals.length > 1) {
      return rejected({
        originalGraph: params.originalGraph,
        canonicalization: params.canonicalization,
        error: `bounded-progress-ambiguous-total:${completed.taskId}:${completed.unitCode}`,
      });
    }
    const total = totals[0];
    if (completed.amount > total.amount) {
      return rejected({
        originalGraph: params.originalGraph,
        canonicalization: params.canonicalization,
        error: `bounded-progress-completed-exceeds-total:${completed.id}:${completed.amount}:${total.amount}`,
      });
    }

    const oldCompleted = graph.workloads.filter((fact) =>
      activeNow.has(fact.id)
      && fact.id !== completed.id
      && fact.quantityRole === 'completed'
      && sameBoundedBasis(fact, completed));
    for (const old of oldCompleted) {
      const lifecycle = supersedeFact({
        graph,
        targetFactId: old.id,
        replacementFactId: completed.id,
        operationKey: `${params.operationKeyPrefix}:bounded-progress-snapshot:${old.id}`,
      });
      if (lifecycle.status === 'rejected') {
        return rejected({
          originalGraph: params.originalGraph,
          canonicalization: params.canonicalization,
          error: `bounded-progress-snapshot:${lifecycle.errors.join(',')}`,
        });
      }
      graph = lifecycle.graph;
      superseded.push(...lifecycle.superseded);
    }

    activeNow = activeIds(graph);
    const percentCompleted = graph.workloads.filter((fact) =>
      activeNow.has(fact.id)
      && fact.quantityRole === 'completed'
      && isPercentage(fact)
      && sameOwner(fact, completed));
    for (const old of percentCompleted) {
      const lifecycle = supersedeFact({
        graph,
        targetFactId: old.id,
        replacementFactId: completed.id,
        operationKey: `${params.operationKeyPrefix}:replace-percent-progress:${old.id}`,
      });
      if (lifecycle.status === 'rejected') {
        return rejected({
          originalGraph: params.originalGraph,
          canonicalization: params.canonicalization,
          error: `bounded-progress-percent-snapshot:${lifecycle.errors.join(',')}`,
        });
      }
      graph = lifecycle.graph;
      superseded.push(...lifecycle.superseded);
    }

    activeNow = activeIds(graph);
    const remainingCandidates = graph.workloads.filter((fact) =>
      activeNow.has(fact.id)
      && fact.quantityRole === 'remaining'
      && sameBoundedBasis(fact, completed));
    const explicitRemaining = remainingCandidates.filter((fact) => !isDerivedBoundedRemaining(fact));
    if (explicitRemaining.length > 0) continue;
    if (remainingCandidates.length > 1) {
      return rejected({
        originalGraph: params.originalGraph,
        canonicalization: params.canonicalization,
        error: `bounded-progress-ambiguous-derived-remaining:${completed.taskId}:${completed.unitCode}`,
      });
    }

    const nextRemaining = total.amount - completed.amount;
    const previousDerived = remainingCandidates[0] ?? null;
    if (previousDerived?.amount === nextRemaining) continue;

    if (nextRemaining === 0) {
      if (!previousDerived) continue;
      const lifecycle = removeFact({
        graph,
        factId: previousDerived.id,
        operationKey: `${params.operationKeyPrefix}:remove-bounded-remaining:${previousDerived.id}`,
      });
      if (lifecycle.status === 'rejected') {
        return rejected({
          originalGraph: params.originalGraph,
          canonicalization: params.canonicalization,
          error: `bounded-progress-remove-remaining:${lifecycle.errors.join(',')}`,
        });
      }
      graph = lifecycle.graph;
      removed.push(...lifecycle.removed);
      continue;
    }

    const appended = appendRemaining({
      graph,
      total,
      completed,
      amount: nextRemaining,
      operationKeyPrefix: params.operationKeyPrefix,
    });
    graph = appended.graph;
    added.push({ kind: 'workload', id: appended.fact.id });
    if (previousDerived) {
      const lifecycle = supersedeFact({
        graph,
        targetFactId: previousDerived.id,
        replacementFactId: appended.fact.id,
        operationKey: `${params.operationKeyPrefix}:rebase-bounded-remaining:${previousDerived.id}`,
      });
      if (lifecycle.status === 'rejected') {
        return rejected({
          originalGraph: params.originalGraph,
          canonicalization: params.canonicalization,
          error: `bounded-progress-rebase-remaining:${lifecycle.errors.join(',')}`,
        });
      }
      graph = lifecycle.graph;
      superseded.push(...lifecycle.superseded);
    }
  }

  if (graph === params.canonicalization.graph) return params.canonicalization;
  return {
    ...params.canonicalization,
    graph,
    diff: {
      ...diff,
      toRevision: graph.revision,
      added: uniqueEntries(added),
      superseded: uniqueEntries(superseded),
      removed: uniqueEntries(removed),
    },
  };
}
