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

export const WEEKLY_PLANNING_PERCENTAGE_PROGRESS_PROJECTION_VERSION_V5 =
  'weekly-planning-percentage-progress-projection-v5' as const;

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function isPercentageWorkload(fact: WorkloadFactV5): boolean {
  return fact.unitCode === 'custom'
    && fact.unitLabel.trim() === '%'
    && Number.isFinite(fact.amount)
    && fact.amount >= 0
    && fact.amount <= 100;
}

function sameScope(left: WorkloadFactV5, right: WorkloadFactV5): boolean {
  return left.taskId === right.taskId && left.componentId === right.componentId;
}

function scopeKey(fact: WorkloadFactV5): string {
  return `${fact.taskId}|${fact.componentId ?? ''}`;
}

function activeFactIds(graph: WeeklyPlanningFactGraphV5): Set<string> {
  return new Set(
    graph.factLifecycles
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.factId),
  );
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

function appendDerivedRemaining(params: {
  graph: WeeklyPlanningFactGraphV5;
  completed: WorkloadFactV5;
  amount: number;
  operationKeyPrefix: string;
}): { graph: WeeklyPlanningFactGraphV5; fact: WorkloadFactV5 } {
  const nextRevision = params.graph.revision + 1;
  const id = `wpf_workload_percent_remaining_${stableHash([
    params.operationKeyPrefix,
    params.completed.id,
    params.amount,
  ].join('|'))}`;
  const fact: WorkloadFactV5 = {
    ...params.completed,
    id,
    quantityRole: 'remaining',
    amount: params.amount,
    rangeStart: null,
    rangeEnd: null,
    perOccurrence: false,
    periodExpression: null,
    source: {
      ...params.completed.source,
      semanticLocalId: `${params.completed.source.semanticLocalId}:derived-remaining-percent:${id}`,
    },
    createdRevision: nextRevision,
  };
  return {
    fact,
    graph: {
      ...params.graph,
      revision: nextRevision,
      workloads: [...params.graph.workloads, fact],
      factLifecycles: [
        ...params.graph.factLifecycles,
        {
          factId: id,
          status: 'active',
          createdRevision: nextRevision,
          terminalRevision: null,
          supersededByFactId: null,
        },
      ],
    },
  };
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

function supersedePriorPercentageSnapshots(params: {
  graph: WeeklyPlanningFactGraphV5;
  completed: WorkloadFactV5;
  operationKeyPrefix: string;
}): {
  status: 'applied' | 'rejected';
  graph: WeeklyPlanningFactGraphV5;
  superseded: WeeklyPlanningFactDiffEntryV5[];
  errors: string[];
} {
  let graph = params.graph;
  const superseded: WeeklyPlanningFactDiffEntryV5[] = [];
  const activeIds = activeFactIds(graph);
  const previous = graph.workloads.filter((fact) =>
    fact.id !== params.completed.id
    && activeIds.has(fact.id)
    && sameScope(fact, params.completed)
    && fact.quantityRole === 'completed'
    && isPercentageWorkload(fact));

  for (const fact of previous) {
    const lifecycle = applyWeeklyPlanningFactLifecycleOperationV5({
      graph,
      expectedRevision: graph.revision,
      operation: {
        operationKey: `${params.operationKeyPrefix}:percent-progress-snapshot:${fact.id}`,
        kind: 'supersede',
        targetFactId: fact.id,
        replacementFactId: params.completed.id,
      },
    });
    if (lifecycle.status === 'rejected') {
      return {
        status: 'rejected',
        graph: params.graph,
        superseded: [],
        errors: lifecycle.errors,
      };
    }
    graph = lifecycle.graph;
    superseded.push(...lifecycle.superseded);
  }

  return { status: 'applied', graph, superseded, errors: [] };
}

export function projectWeeklyPlanningPercentageProgressV5(params: {
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
  const newlyAddedIds = new Set(
    diff.added.filter((entry) => entry.kind === 'workload').map((entry) => entry.id),
  );
  const activeIds = activeFactIds(graph);
  const newCompletedPercentages = graph.workloads.filter((fact) =>
    newlyAddedIds.has(fact.id)
    && activeIds.has(fact.id)
    && fact.quantityRole === 'completed'
    && isPercentageWorkload(fact));

  const newByScope = new Map<string, WorkloadFactV5[]>();
  for (const completed of newCompletedPercentages) {
    const key = scopeKey(completed);
    newByScope.set(key, [...(newByScope.get(key) ?? []), completed]);
  }
  for (const [key, candidates] of newByScope) {
    if (candidates.length > 1) {
      return rejected({
        originalGraph: params.originalGraph,
        canonicalization: params.canonicalization,
        error: `percentage-progress-ambiguous-current-snapshot:${key}`,
      });
    }
  }

  for (const completed of newCompletedPercentages) {
    const key = scopeKey(completed);
    const snapshotUpdate = supersedePriorPercentageSnapshots({
      graph,
      completed,
      operationKeyPrefix: params.operationKeyPrefix,
    });
    if (snapshotUpdate.status === 'rejected') {
      return rejected({
        originalGraph: params.originalGraph,
        canonicalization: params.canonicalization,
        error: `percentage-progress-snapshot:${snapshotUpdate.errors.join(',')}`,
      });
    }
    graph = snapshotUpdate.graph;
    superseded.push(...snapshotUpdate.superseded);

    const activeNow = activeFactIds(graph);
    const hasBoundedSchedulableWork = graph.workloads.some((fact) =>
      activeNow.has(fact.id)
      && sameScope(fact, completed)
      && !isPercentageWorkload(fact)
      && (fact.quantityRole === 'target' || fact.quantityRole === 'remaining'));
    if (hasBoundedSchedulableWork) continue;

    const remainingCandidates = graph.workloads.filter((fact) =>
      activeNow.has(fact.id)
      && sameScope(fact, completed)
      && fact.quantityRole === 'remaining'
      && isPercentageWorkload(fact));
    if (remainingCandidates.length > 1) {
      return rejected({
        originalGraph: params.originalGraph,
        canonicalization: params.canonicalization,
        error: `percentage-progress-ambiguous-remaining:${key}`,
      });
    }

    const nextRemaining = 100 - completed.amount;
    const previousRemaining = remainingCandidates[0] ?? null;
    if (previousRemaining && previousRemaining.amount === nextRemaining) continue;

    if (nextRemaining === 0) {
      if (!previousRemaining) continue;
      const removal = applyWeeklyPlanningFactLifecycleOperationV5({
        graph,
        expectedRevision: graph.revision,
        operation: {
          operationKey: `${params.operationKeyPrefix}:percent-remove:${previousRemaining.id}`,
          kind: 'remove',
          targetFactId: previousRemaining.id,
        },
      });
      if (removal.status === 'rejected') {
        return rejected({
          originalGraph: params.originalGraph,
          canonicalization: params.canonicalization,
          error: `percentage-progress-remove:${removal.errors.join(',')}`,
        });
      }
      graph = removal.graph;
      removed.push(...removal.removed);
      continue;
    }

    const appended = appendDerivedRemaining({
      graph,
      completed,
      amount: nextRemaining,
      operationKeyPrefix: params.operationKeyPrefix,
    });
    graph = appended.graph;
    added.push({ kind: 'workload', id: appended.fact.id });

    if (previousRemaining) {
      const replacement = applyWeeklyPlanningFactLifecycleOperationV5({
        graph,
        expectedRevision: graph.revision,
        operation: {
          operationKey: `${params.operationKeyPrefix}:percent-rebase:${previousRemaining.id}`,
          kind: 'supersede',
          targetFactId: previousRemaining.id,
          replacementFactId: appended.fact.id,
        },
      });
      if (replacement.status === 'rejected') {
        return rejected({
          originalGraph: params.originalGraph,
          canonicalization: params.canonicalization,
          error: `percentage-progress-rebase:${replacement.errors.join(',')}`,
        });
      }
      graph = replacement.graph;
      superseded.push(...replacement.superseded);
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
