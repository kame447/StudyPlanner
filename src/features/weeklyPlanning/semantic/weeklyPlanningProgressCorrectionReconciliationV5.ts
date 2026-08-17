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

export const WEEKLY_PLANNING_PROGRESS_CORRECTION_RECONCILIATION_VERSION_V5 =
  'weekly-planning-progress-correction-reconciliation-v5' as const;

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function activeFactIds(graph: WeeklyPlanningFactGraphV5): Set<string> {
  return new Set(
    graph.factLifecycles
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.factId),
  );
}

function sameProgressBasis(left: WorkloadFactV5, right: WorkloadFactV5): boolean {
  return left.taskId === right.taskId
    && left.componentId === right.componentId
    && left.unitCode === right.unitCode
    && left.unitLabel === right.unitLabel
    && left.rangeStart === right.rangeStart
    && left.rangeEnd === right.rangeEnd
    && left.perOccurrence === right.perOccurrence
    && left.periodExpression === right.periodExpression;
}

function sameTargetBasis(left: WorkloadFactV5, right: WorkloadFactV5): boolean {
  return left.taskId === right.taskId
    && left.componentId === right.componentId
    && left.unitCode === right.unitCode
    && left.unitLabel === right.unitLabel
    && left.rangeStart === right.rangeStart
    && left.rangeEnd === right.rangeEnd
    && left.perOccurrence === right.perOccurrence;
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

function appendReplacement(params: {
  graph: WeeklyPlanningFactGraphV5;
  oldFact: WorkloadFactV5;
  amount: number;
  key: string;
}): { graph: WeeklyPlanningFactGraphV5; replacement: WorkloadFactV5 } {
  const id = `wpf_workload_progress_${stableHash([
    params.key,
    params.oldFact.id,
    params.amount,
  ].join('|'))}`;
  const replacement: WorkloadFactV5 = {
    ...params.oldFact,
    id,
    amount: params.amount,
    source: {
      ...params.oldFact.source,
      semanticLocalId: `${params.oldFact.source.semanticLocalId}:progress-rebase:${id}`,
    },
    createdRevision: params.graph.revision,
  };
  return {
    replacement,
    graph: {
      ...params.graph,
      workloads: [...params.graph.workloads, replacement],
      factLifecycles: [
        ...params.graph.factLifecycles,
        {
          factId: id,
          status: 'active',
          createdRevision: params.graph.revision,
          terminalRevision: null,
          supersededByFactId: null,
        },
      ],
    },
  };
}

function supersedeWorkload(params: {
  graph: WeeklyPlanningFactGraphV5;
  oldFact: WorkloadFactV5;
  amount: number;
  operationKey: string;
}): {
  status: 'applied' | 'rejected';
  graph: WeeklyPlanningFactGraphV5;
  added: WeeklyPlanningFactDiffEntryV5[];
  superseded: WeeklyPlanningFactDiffEntryV5[];
  removed: WeeklyPlanningFactDiffEntryV5[];
  errors: string[];
} {
  const appended = appendReplacement({
    graph: params.graph,
    oldFact: params.oldFact,
    amount: params.amount,
    key: params.operationKey,
  });
  const lifecycle = applyWeeklyPlanningFactLifecycleOperationV5({
    graph: appended.graph,
    expectedRevision: appended.graph.revision,
    operation: {
      operationKey: params.operationKey,
      kind: 'supersede',
      targetFactId: params.oldFact.id,
      replacementFactId: appended.replacement.id,
    },
  });
  if (lifecycle.status === 'rejected') {
    return {
      status: 'rejected',
      graph: params.graph,
      added: [],
      superseded: [],
      removed: [],
      errors: lifecycle.errors,
    };
  }
  return {
    status: 'applied',
    graph: lifecycle.graph,
    added: [{ kind: 'workload', id: appended.replacement.id }],
    superseded: lifecycle.superseded,
    removed: lifecycle.removed,
    errors: [],
  };
}

function removeWorkload(params: {
  graph: WeeklyPlanningFactGraphV5;
  fact: WorkloadFactV5;
  operationKey: string;
}) {
  return applyWeeklyPlanningFactLifecycleOperationV5({
    graph: params.graph,
    expectedRevision: params.graph.revision,
    operation: {
      operationKey: params.operationKey,
      kind: 'remove',
      targetFactId: params.fact.id,
    },
  });
}

export function reconcileWeeklyPlanningProgressCorrectionsV5(params: {
  originalGraph: WeeklyPlanningFactGraphV5;
  canonicalization: WeeklyPlanningSemanticCanonicalizationResultV5;
  operationKeyPrefix: string;
}): WeeklyPlanningSemanticCanonicalizationResultV5 {
  const diff = params.canonicalization.diff;
  if (params.canonicalization.status !== 'applied' || !diff) {
    return params.canonicalization;
  }

  let graph = params.canonicalization.graph;
  const added = [...diff.added];
  const superseded = [...diff.superseded];
  const removed = [...diff.removed];
  const originalActiveIds = activeFactIds(params.originalGraph);

  for (const entry of diff.superseded) {
    if (entry.kind !== 'workload') continue;
    const oldCompleted = params.originalGraph.workloads.find(
      (fact) => fact.id === entry.id && fact.quantityRole === 'completed',
    );
    if (!oldCompleted) continue;
    const lifecycle = graph.factLifecycles.find((item) => item.factId === oldCompleted.id);
    const replacementId = lifecycle?.supersededByFactId;
    if (!replacementId) continue;
    const newCompleted = graph.workloads.find((fact) => fact.id === replacementId);
    if (!newCompleted || newCompleted.quantityRole !== 'completed') continue;
    if (!sameProgressBasis(oldCompleted, newCompleted)) continue;

    const remainingCandidates = params.originalGraph.workloads.filter((fact) =>
      originalActiveIds.has(fact.id)
      && fact.quantityRole === 'remaining'
      && sameProgressBasis(oldCompleted, fact));
    if (remainingCandidates.length !== 1) continue;
    const oldRemaining = remainingCandidates[0];
    const impliedTotal = oldCompleted.amount + oldRemaining.amount;
    const nextRemaining = impliedTotal - newCompleted.amount;
    if (!Number.isFinite(nextRemaining) || nextRemaining < 0) {
      return rejected({
        originalGraph: params.originalGraph,
        canonicalization: params.canonicalization,
        error: `progress-correction-exceeds-implied-total:${oldCompleted.id}:${newCompleted.id}:${impliedTotal}`,
      });
    }
    if (nextRemaining === oldRemaining.amount) continue;

    const siblingRemainingCandidates = params.originalGraph.workloads.filter((fact) =>
      originalActiveIds.has(fact.id)
      && fact.id !== oldRemaining.id
      && fact.quantityRole === 'remaining'
      && fact.amount === oldRemaining.amount
      && sameTargetBasis(oldRemaining, fact));

    const targetCandidates = params.originalGraph.workloads.filter((fact) =>
      originalActiveIds.has(fact.id)
      && fact.quantityRole === 'target'
      && fact.amount === oldRemaining.amount
      && sameTargetBasis(oldRemaining, fact)
      && fact.source.turnId === oldRemaining.source.turnId
      && fact.source.sourceText === oldRemaining.source.sourceText);

    if (nextRemaining === 0) {
      const remainingRemoval = removeWorkload({
        graph,
        fact: oldRemaining,
        operationKey: `${params.operationKeyPrefix}:progress-remove:${oldRemaining.id}`,
      });
      if (remainingRemoval.status === 'rejected') {
        return rejected({
          originalGraph: params.originalGraph,
          canonicalization: params.canonicalization,
          error: `progress-reconciliation:${remainingRemoval.errors.join(',')}`,
        });
      }
      graph = remainingRemoval.graph;
      removed.push(...remainingRemoval.removed);
      for (const sibling of siblingRemainingCandidates) {
        if (!activeFactIds(graph).has(sibling.id)) continue;
        const siblingRemoval = removeWorkload({
          graph,
          fact: sibling,
          operationKey: `${params.operationKeyPrefix}:progress-remove-sibling:${sibling.id}`,
        });
        if (siblingRemoval.status === 'rejected') {
          return rejected({
            originalGraph: params.originalGraph,
            canonicalization: params.canonicalization,
            error: `progress-sibling-reconciliation:${siblingRemoval.errors.join(',')}`,
          });
        }
        graph = siblingRemoval.graph;
        removed.push(...siblingRemoval.removed);
      }
      for (const target of targetCandidates) {
        const targetRemoval = removeWorkload({
          graph,
          fact: target,
          operationKey: `${params.operationKeyPrefix}:progress-remove-target:${target.id}`,
        });
        if (targetRemoval.status === 'rejected') {
          return rejected({
            originalGraph: params.originalGraph,
            canonicalization: params.canonicalization,
            error: `progress-target-reconciliation:${targetRemoval.errors.join(',')}`,
          });
        }
        graph = targetRemoval.graph;
        removed.push(...targetRemoval.removed);
      }
      continue;
    }

    const remainingResult = supersedeWorkload({
      graph,
      oldFact: oldRemaining,
      amount: nextRemaining,
      operationKey: `${params.operationKeyPrefix}:progress-rebase:${oldRemaining.id}`,
    });
    if (remainingResult.status === 'rejected') {
      return rejected({
        originalGraph: params.originalGraph,
        canonicalization: params.canonicalization,
        error: `progress-reconciliation:${remainingResult.errors.join(',')}`,
      });
    }
    graph = remainingResult.graph;
    added.push(...remainingResult.added);
    superseded.push(...remainingResult.superseded);
    removed.push(...remainingResult.removed);

    // A bounded correction has one current remaining amount. A model may emit
    // the same old remaining amount twice with different temporal wording;
    // retire those duplicate stale variants instead of preserving conflicts.
    for (const sibling of siblingRemainingCandidates) {
      if (!activeFactIds(graph).has(sibling.id)) continue;
      const siblingRemoval = removeWorkload({
        graph,
        fact: sibling,
        operationKey: `${params.operationKeyPrefix}:progress-remove-sibling:${sibling.id}`,
      });
      if (siblingRemoval.status === 'rejected') {
        return rejected({
          originalGraph: params.originalGraph,
          canonicalization: params.canonicalization,
          error: `progress-sibling-reconciliation:${siblingRemoval.errors.join(',')}`,
        });
      }
      graph = siblingRemoval.graph;
      removed.push(...siblingRemoval.removed);
    }

    // A target is rebased only when provenance shows it was emitted from the
    // exact same semantic clause as the old remaining fact. This preserves an
    // independently stated target even if its numeric amount happens to match.
    for (const target of targetCandidates) {
      const targetResult = supersedeWorkload({
        graph,
        oldFact: target,
        amount: nextRemaining,
        operationKey: `${params.operationKeyPrefix}:progress-rebase-target:${target.id}`,
      });
      if (targetResult.status === 'rejected') {
        return rejected({
          originalGraph: params.originalGraph,
          canonicalization: params.canonicalization,
          error: `progress-target-reconciliation:${targetResult.errors.join(',')}`,
        });
      }
      graph = targetResult.graph;
      added.push(...targetResult.added);
      superseded.push(...targetResult.superseded);
      removed.push(...targetResult.removed);
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
