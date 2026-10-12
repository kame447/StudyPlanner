import { activeWeeklyPlanningWorkloadDependentsV5, decideWeeklyPlanningWorkloadDependentMigrationV5 } from './weeklyPlanningCorrectionDependentMigrationPolicyV5';
import { applyWeeklyPlanningFactLifecycleOperationV5 } from './weeklyPlanningFactLifecycleEngineV5';
import type { EffortEstimateFactV5, WeeklyPlanningFactDiffEntryV5, WeeklyPlanningFactGraphV5, WorkloadFactV5 } from './weeklyPlanningFactGraphV5';

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

function equivalentCurrentReplacementEfforts(params: {
  graph: WeeklyPlanningFactGraphV5;
  effort: EffortEstimateFactV5;
  replacement: WorkloadFactV5;
}): EffortEstimateFactV5[] {
  const activeIds = activeFactIds(params.graph);
  const expectedUnitCode = params.replacement.unitCode;
  return params.graph.effortEstimates.filter((candidate) =>
    candidate.id !== params.effort.id
    && activeIds.has(candidate.id)
    && candidate.targetFactId === params.replacement.id
    && candidate.kind === params.effort.kind
    && candidate.minutes === params.effort.minutes
    && candidate.unitCode === expectedUnitCode
    && candidate.precision === params.effort.precision
    && candidate.createdRevision === params.replacement.createdRevision);
}

/** One existing typed migration policy and writer for explicit corrections and
 * contextual quantity-role replacement. It preserves historical effort evidence
 * and fails atomically before a target is retired. */
export function prepareWeeklyPlanningWorkloadDependentsV5(params: {
  graph: WeeklyPlanningFactGraphV5;
  targetFactId: string;
  replacementFactId: string;
  migrationId: string;
  operationKey: string;
}): {
  status: 'applied' | 'not_applicable' | 'rejected';
  graph: WeeklyPlanningFactGraphV5;
  added: WeeklyPlanningFactDiffEntryV5[];
  superseded: WeeklyPlanningFactDiffEntryV5[];
  removed: WeeklyPlanningFactDiffEntryV5[];
  errors: string[];
} {
  const target = params.graph.workloads.find(fact => fact.id === params.targetFactId);
  const replacement = params.graph.workloads.find(fact => fact.id === params.replacementFactId);
  if (!target || !replacement) return {
    status: 'rejected', graph: params.graph, added: [], superseded: [], removed: [],
    errors: [`workload-dependent-rebase-missing-target:${params.migrationId}`],
  };

  const dependents = activeWeeklyPlanningWorkloadDependentsV5({
    graph: params.graph,
    workloadFactId: target.id,
  });
  if (dependents.length === 0) {
    return {
      status: 'not_applicable',
      graph: params.graph,
      added: [],
      superseded: [],
      removed: [],
      errors: [],
    };
  }

  const migrations = dependents.map((dependent) => ({
    dependent,
    decision: decideWeeklyPlanningWorkloadDependentMigrationV5({
      graph: params.graph,
      dependent,
      target,
      replacement,
    }),
  }));
  const rejected = migrations.filter(({ decision }) => decision.action === 'reject');
  if (rejected.length > 0) {
    return {
      status: 'rejected',
      graph: params.graph,
      added: [],
      superseded: [],
      removed: [],
      errors: rejected.map(({ dependent, decision }) =>
        `workload-dependent-migration-rejected:${dependent.kind}:${dependent.factId}:${decision.reason}`),
    };
  }

  let graph = params.graph;
  const added: WeeklyPlanningFactDiffEntryV5[] = [];
  const superseded: WeeklyPlanningFactDiffEntryV5[] = [];
  const removed: WeeklyPlanningFactDiffEntryV5[] = [];

  for (const migration of migrations) {
    if (migration.dependent.kind !== 'effort_estimate') continue;
    const effort = graph.effortEstimates.find(
      (fact) => fact.id === migration.dependent.factId,
    );
    if (!effort) {
      return {
        status: 'rejected',
        graph: params.graph,
        added: [],
        superseded: [],
        removed: [],
        errors: [`workload-dependent-migration-missing-effort:${migration.dependent.factId}`],
      };
    }

    if (migration.decision.action === 'invalidate') {
      const invalidated = applyWeeklyPlanningFactLifecycleOperationV5({
        graph,
        expectedRevision: graph.revision,
        operation: {
          operationKey: `${params.operationKey}:invalidate-dependent:${effort.id}`,
          kind: 'remove',
          targetFactId: effort.id,
        },
      });
      if (invalidated.status === 'rejected') {
        return {
          status: 'rejected',
          graph: params.graph,
          added: [],
          superseded: [],
          removed: [],
          errors: invalidated.errors,
        };
      }
      graph = invalidated.graph;
      removed.push(...invalidated.removed);
      continue;
    }

    const equivalentReplacementEfforts = equivalentCurrentReplacementEfforts({
      graph,
      effort,
      replacement,
    });
    if (equivalentReplacementEfforts.length > 1) {
      return {
        status: 'rejected',
        graph: params.graph,
        added: [],
        superseded: [],
        removed: [],
        errors: [
          `workload-dependent-rebase-ambiguous-equivalent:${effort.id}:${equivalentReplacementEfforts.map((candidate) => candidate.id).join(',')}`,
        ],
      };
    }
    if (equivalentReplacementEfforts.length === 1) {
      const equivalent = equivalentReplacementEfforts[0];
      const reused = applyWeeklyPlanningFactLifecycleOperationV5({
        graph,
        expectedRevision: graph.revision,
        operation: {
          operationKey: `${params.operationKey}:reuse-dependent:${effort.id}`,
          kind: 'supersede',
          targetFactId: effort.id,
          replacementFactId: equivalent.id,
        },
      });
      if (reused.status === 'rejected') {
        return {
          status: 'rejected',
          graph: params.graph,
          added: [],
          superseded: [],
          removed: [],
          errors: reused.errors,
        };
      }
      graph = reused.graph;
      superseded.push(...reused.superseded);
      continue;
    }

    const carriedId = `wpf_effort_carry_${stableHash([
      params.migrationId,
      effort.id,
      replacement.id,
    ].join('|'))}`;
    if (graph.effortEstimates.some((fact) => fact.id === carriedId)) {
      return {
        status: 'rejected',
        graph: params.graph,
        added: [],
        superseded: [],
        removed: [],
        errors: [`workload-dependent-rebase-id-collision:${carriedId}`],
      };
    }
    const createdRevision = graph.revision;
    const carried: EffortEstimateFactV5 = {
      ...effort,
      id: carriedId,
      taskId: replacement.taskId,
      targetFactId: replacement.id,
      unitCode: replacement.unitCode,
      source: {
        ...effort.source,
        semanticLocalId: `${effort.source.semanticLocalId}:carry:${params.migrationId}`,
      },
      createdRevision,
    };
    graph = {
      ...graph,
      effortEstimates: [...graph.effortEstimates, carried],
      factLifecycles: [
        ...graph.factLifecycles,
        {
          factId: carried.id,
          status: 'active',
          createdRevision,
          terminalRevision: null,
          supersededByFactId: null,
        },
      ],
    };
    added.push({ kind: 'effort_estimate', id: carried.id });

    const rebased = applyWeeklyPlanningFactLifecycleOperationV5({
      graph,
      expectedRevision: graph.revision,
      operation: {
        operationKey: `${params.operationKey}:carry-dependent:${effort.id}`,
        kind: 'supersede',
        targetFactId: effort.id,
        replacementFactId: carried.id,
      },
    });
    if (rebased.status === 'rejected') {
      return {
        status: 'rejected',
        graph: params.graph,
        added: [],
        superseded: [],
        removed: [],
        errors: rebased.errors,
      };
    }
    graph = rebased.graph;
    superseded.push(...rebased.superseded);
  }

  return {
    status: 'applied',
    graph,
    added,
    superseded,
    removed,
    errors: [],
  };
}
