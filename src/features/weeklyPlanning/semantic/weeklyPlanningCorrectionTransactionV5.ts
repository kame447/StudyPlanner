import { prepareWeeklyPlanningWorkloadDependentsV5 } from './weeklyPlanningWorkloadDependentMigrationV5';
import {
  applyWeeklyPlanningCorrectionIntentV5,
  type WeeklyPlanningFactLifecycleResultV5,
} from './weeklyPlanningFactLifecycleEngineV5';
import type {
  WeeklyPlanningFactDiffEntryV5,
  WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';

const migratedDependents = new WeakMap<object, {
  superseded: readonly string[];
  invalidatedWorkloadTargets: ReadonlyMap<string, string>;
}>();

/**
 * Efforts this transaction's dependent migration superseded because their workload was replaced. A later correction of the
 * same turn that names one of them applies to the migrated fact (x9a); nothing else does. Kept off the result's shape:
 * the transaction output is frozen byte-for-byte by an existing test.
 */
export function migratedDependentFactIdsOfTransactionV5(result: object): readonly string[] {
  return migratedDependents.get(result)?.superseded ?? [];
}

/** Exact dependent/workload replacements retired by this transaction's policy.
 * This grants no authority to revive or follow previously removed history. */
export function invalidatedDependentTargetsOfTransactionV5(result: object): ReadonlyMap<string, string> {
  return migratedDependents.get(result)?.invalidatedWorkloadTargets ?? new Map();
}

export const WEEKLY_PLANNING_CORRECTION_TRANSACTION_VERSION_V5 =
  'weekly-planning-correction-transaction-v5' as const;

export interface WeeklyPlanningCorrectionTransactionResultV5
  extends WeeklyPlanningFactLifecycleResultV5 {
  transactionVersion: typeof WEEKLY_PLANNING_CORRECTION_TRANSACTION_VERSION_V5;
  added: WeeklyPlanningFactDiffEntryV5[];
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

function prepareWorkloadDependents(params: {
  graph: WeeklyPlanningFactGraphV5;
  correctionIntentFactId: string;
  operationKey: string;
}) {
  const correction = params.graph.correctionIntents.find(fact => fact.id === params.correctionIntentFactId);
  if (!correction || correction.operation === 'remove' || correction.target.kind !== 'workload'
    || !correction.target.factId || !correction.replacementFactId) return {
    status: 'not_applicable' as const, graph: params.graph,
    added: [], superseded: [], removed: [], errors: [],
  };
  return prepareWeeklyPlanningWorkloadDependentsV5({
    graph: params.graph, targetFactId: correction.target.factId,
    replacementFactId: correction.replacementFactId,
    migrationId: correction.id, operationKey: params.operationKey,
  });
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

  const prepared = prepareWorkloadDependents({
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
  const applied: WeeklyPlanningCorrectionTransactionResultV5 = {
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
  const replacementWorkloadId = params.graph.correctionIntents.find(
    fact => fact.id === params.correctionIntentFactId && fact.target.kind === 'workload',
  )?.replacementFactId;
  migratedDependents.set(applied, {
    superseded: prepared.superseded.map(entry => entry.id),
    invalidatedWorkloadTargets: new Map(replacementWorkloadId
      ? prepared.removed.map(entry => [entry.id, replacementWorkloadId])
      : []),
  });
  return applied;
}
