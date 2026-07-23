import {
  applyWeeklyPlanningFactLifecycleOperationV5,
  WEEKLY_PLANNING_FACT_LIFECYCLE_ENGINE_VERSION_V5,
  type WeeklyPlanningFactLifecycleResultV5,
} from './weeklyPlanningFactLifecycleEngineV5';
import type {
  WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';

export const WEEKLY_PLANNING_DECISION_TRANSACTION_VERSION_V5 =
  'weekly-planning-decision-transaction-v5' as const;

export interface WeeklyPlanningDecisionTransactionResultV5
  extends WeeklyPlanningFactLifecycleResultV5 {
  transactionVersion: typeof WEEKLY_PLANNING_DECISION_TRANSACTION_VERSION_V5;
}

function rejected(
  graph: WeeklyPlanningFactGraphV5,
  errors: string[],
): WeeklyPlanningDecisionTransactionResultV5 {
  return {
    transactionVersion: WEEKLY_PLANNING_DECISION_TRANSACTION_VERSION_V5,
    engineVersion: WEEKLY_PLANNING_FACT_LIFECYCLE_ENGINE_VERSION_V5,
    status: 'rejected',
    graph,
    superseded: [],
    removed: [],
    errors,
  };
}

function consumeDecisionIntent(params: {
  graph: WeeklyPlanningFactGraphV5;
  decisionIntentFactId: string;
  terminalRevision: number;
}): WeeklyPlanningFactGraphV5 {
  return {
    ...params.graph,
    factLifecycles: params.graph.factLifecycles.map((entry) =>
      entry.factId === params.decisionIntentFactId
        ? {
            ...entry,
            status: 'removed' as const,
            terminalRevision: params.terminalRevision,
            supersededByFactId: null,
          }
        : entry),
  };
}

export function applyWeeklyPlanningDecisionTransactionV5(params: {
  graph: WeeklyPlanningFactGraphV5;
  expectedRevision: number;
  decisionIntentFactId: string;
  operationKey: string;
}): WeeklyPlanningDecisionTransactionResultV5 {
  const decision = params.graph.decisionIntents.find(
    (fact) => fact.id === params.decisionIntentFactId,
  );
  if (!decision) {
    return rejected(params.graph, [
      `unknown-decision-intent:${params.decisionIntentFactId}`,
    ]);
  }
  const lifecycle = params.graph.factLifecycles.find(
    (entry) => entry.factId === decision.id,
  );
  if (!lifecycle || lifecycle.status !== 'active') {
    return rejected(params.graph, [
      `decision-intent-not-active:${params.decisionIntentFactId}`,
    ]);
  }
  if (!params.operationKey.trim()) return rejected(params.graph, ['operation-key-required']);
  if (params.graph.appliedLifecycleOperationKeys.includes(params.operationKey)) {
    return {
      transactionVersion: WEEKLY_PLANNING_DECISION_TRANSACTION_VERSION_V5,
      engineVersion: WEEKLY_PLANNING_FACT_LIFECYCLE_ENGINE_VERSION_V5,
      status: 'duplicate',
      graph: params.graph,
      superseded: [],
      removed: [],
      errors: [],
    };
  }
  if (params.expectedRevision !== params.graph.revision) {
    return rejected(params.graph, [
      `revision-mismatch:expected=${params.expectedRevision}:actual=${params.graph.revision}`,
    ]);
  }
  if (decision.target.kind === 'proposal' || !decision.target.factId) {
    return rejected(params.graph, ['decision-target-not-resolved-in-fact-graph']);
  }
  if (decision.decision === 'modify') {
    return rejected(params.graph, ['decision-modify-requires-correction-intent']);
  }

  if (decision.decision === 'reject') {
    const targetResult = applyWeeklyPlanningFactLifecycleOperationV5({
      graph: params.graph,
      expectedRevision: params.expectedRevision,
      operation: {
        operationKey: params.operationKey,
        kind: 'remove',
        targetFactId: decision.target.factId,
      },
    });
    if (targetResult.status !== 'applied') {
      return {
        ...targetResult,
        transactionVersion: WEEKLY_PLANNING_DECISION_TRANSACTION_VERSION_V5,
      };
    }
    const graph = consumeDecisionIntent({
      graph: targetResult.graph,
      decisionIntentFactId: decision.id,
      terminalRevision: targetResult.graph.revision,
    });
    return {
      ...targetResult,
      transactionVersion: WEEKLY_PLANNING_DECISION_TRANSACTION_VERSION_V5,
      graph,
      removed: [
        ...targetResult.removed,
        { kind: 'decision_intent', id: decision.id },
      ],
    };
  }

  const nextRevision = params.graph.revision + 1;
  const graph = consumeDecisionIntent({
    graph: {
      ...params.graph,
      revision: nextRevision,
      appliedLifecycleOperationKeys: [
        ...params.graph.appliedLifecycleOperationKeys,
        params.operationKey,
      ],
    },
    decisionIntentFactId: decision.id,
    terminalRevision: nextRevision,
  });
  return {
    transactionVersion: WEEKLY_PLANNING_DECISION_TRANSACTION_VERSION_V5,
    engineVersion: WEEKLY_PLANNING_FACT_LIFECYCLE_ENGINE_VERSION_V5,
    status: 'applied',
    graph,
    superseded: [],
    removed: [{ kind: 'decision_intent', id: decision.id }],
    errors: [],
  };
}
