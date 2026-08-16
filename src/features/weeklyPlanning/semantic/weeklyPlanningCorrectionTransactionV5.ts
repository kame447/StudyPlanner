import {
  applyWeeklyPlanningCorrectionIntentV5,
  applyWeeklyPlanningFactLifecycleOperationV5,
  type WeeklyPlanningFactLifecycleResultV5,
} from './weeklyPlanningFactLifecycleEngineV5';
import type {
  EffortEstimateFactV5,
  WeeklyPlanningFactDiffEntryV5,
  WeeklyPlanningFactGraphV5,
  WorkloadFactV5,
} from './weeklyPlanningFactGraphV5';

export const WEEKLY_PLANNING_CORRECTION_TRANSACTION_VERSION_V5 =
  'weekly-planning-correction-transaction-v5' as const;

export interface WeeklyPlanningCorrectionTransactionResultV5
  extends WeeklyPlanningFactLifecycleResultV5 {
  transactionVersion: typeof WEEKLY_PLANNING_CORRECTION_TRANSACTION_VERSION_V5;
  added: WeeklyPlanningFactDiffEntryV5[];
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function rejectedTransaction(
  graph: WeeklyPlanningFactGraphV5,
  errors: string[],
): WeeklyPlanningCorrectionTransactionResultV5 {
  return {
    transactionVersion: WEEKLY_PLANNING_CORRECTION_TRANSACTION_VERSION_V5,
    engineVersion: 'weekly-planning-fact-lifecycle-engine-v5',
    status: 'rejected',
    graph,
    added: [],
    superseded: [],
    removed: [],
    errors,
  };
}

function activeFactIds(graph: WeeklyPlanningFactGraphV5): Set<string> {
  return new Set(
    graph.factLifecycles
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.factId),
  );
}

function canCarryEffortToReplacement(params: {
  effort: EffortEstimateFactV5;
  target: WorkloadFactV5;
  replacement: WorkloadFactV5;
}): boolean {
  if (params.effort.kind === 'session_duration') return true;
  return params.effort.kind === 'duration_per_unit'
    && params.target.unitCode === params.replacement.unitCode;
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

function prepareWorkloadEffortDependents(params: {
  graph: WeeklyPlanningFactGraphV5;
  correctionIntentFactId: string;
  operationKey: string;
}): {
  status: 'applied' | 'not_applicable' | 'rejected';
  graph: WeeklyPlanningFactGraphV5;
  added: WeeklyPlanningFactDiffEntryV5[];
  superseded: WeeklyPlanningFactDiffEntryV5[];
  removed: WeeklyPlanningFactDiffEntryV5[];
  errors: string[];
} {
  const correction = params.graph.correctionIntents.find(
    (fact) => fact.id === params.correctionIntentFactId,
  );
  if (
    !correction
    || correction.operation === 'remove'
    || correction.target.kind !== 'workload'
    || !correction.target.factId
    || !correction.replacementFactId
  ) {
    return {
      status: 'not_applicable',
      graph: params.graph,
      added: [],
      superseded: [],
      removed: [],
      errors: [],
    };
  }

  const target = params.graph.workloads.find(
    (fact) => fact.id === correction.target.factId,
  );
  const replacement = params.graph.workloads.find(
    (fact) => fact.id === correction.replacementFactId,
  );
  if (!target || !replacement) {
    return {
      status: 'rejected',
      graph: params.graph,
      added: [],
      superseded: [],
      removed: [],
      errors: [`workload-dependent-rebase-missing-target:${correction.id}`],
    };
  }

  const activeIds = activeFactIds(params.graph);
  const dependentEfforts = params.graph.effortEstimates.filter(
    (effort) => activeIds.has(effort.id) && effort.targetFactId === target.id,
  );
  if (dependentEfforts.length === 0) {
    return {
      status: 'not_applicable',
      graph: params.graph,
      added: [],
      superseded: [],
      removed: [],
      errors: [],
    };
  }

  let graph = params.graph;
  const added: WeeklyPlanningFactDiffEntryV5[] = [];
  const superseded: WeeklyPlanningFactDiffEntryV5[] = [];
  const removed: WeeklyPlanningFactDiffEntryV5[] = [];

  for (const effort of dependentEfforts) {
    if (!canCarryEffortToReplacement({ effort, target, replacement })) {
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
      correction.id,
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
        semanticLocalId: `${effort.source.semanticLocalId}:carry:${correction.id}`,
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

export function applyWeeklyPlanningCorrectionTransactionV5(params: {
  graph: WeeklyPlanningFactGraphV5;
  expectedRevision: number;
  correctionIntentFactId: string;
  operationKey: string;
}): WeeklyPlanningCorrectionTransactionResultV5 {
  if (params.expectedRevision !== params.graph.revision) {
    return rejectedTransaction(params.graph, [
      `revision-mismatch:expected=${params.expectedRevision}:actual=${params.graph.revision}`,
    ]);
  }

  const prepared = prepareWorkloadEffortDependents({
    graph: params.graph,
    correctionIntentFactId: params.correctionIntentFactId,
    operationKey: params.operationKey,
  });
  if (prepared.status === 'rejected') {
    return rejectedTransaction(params.graph, prepared.errors);
  }

  const result = applyWeeklyPlanningCorrectionIntentV5({
    ...params,
    graph: prepared.graph,
    expectedRevision: prepared.graph.revision,
  });
  if (result.status !== 'applied') {
    return {
      ...result,
      graph: result.status === 'rejected' ? params.graph : result.graph,
      transactionVersion: WEEKLY_PLANNING_CORRECTION_TRANSACTION_VERSION_V5,
      added: [],
      superseded: result.status === 'rejected'
        ? []
        : [...prepared.superseded, ...result.superseded],
      removed: result.status === 'rejected'
        ? []
        : [...prepared.removed, ...result.removed],
    };
  }

  const consumedRevision = result.graph.revision;
  const nextLifecycles = result.graph.factLifecycles.map((entry) => {
    if (entry.factId !== params.correctionIntentFactId) return entry;
    return {
      ...entry,
      status: 'removed' as const,
      terminalRevision: consumedRevision,
      supersededByFactId: null,
    };
  });
  return {
    ...result,
    transactionVersion: WEEKLY_PLANNING_CORRECTION_TRANSACTION_VERSION_V5,
    graph: {
      ...result.graph,
      factLifecycles: nextLifecycles,
    },
    added: prepared.added,
    superseded: [
      ...prepared.superseded,
      ...result.superseded,
    ],
    removed: [
      ...prepared.removed,
      ...result.removed,
      { kind: 'correction_intent', id: params.correctionIntentFactId },
    ],
  };
}
