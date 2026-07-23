import {
  applyWeeklyPlanningCorrectionIntentV5,
  type WeeklyPlanningFactLifecycleResultV5,
} from './weeklyPlanningFactLifecycleEngineV5';
import type {
  WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';

export const WEEKLY_PLANNING_CORRECTION_TRANSACTION_VERSION_V5 =
  'weekly-planning-correction-transaction-v5' as const;

export interface WeeklyPlanningCorrectionTransactionResultV5
  extends WeeklyPlanningFactLifecycleResultV5 {
  transactionVersion: typeof WEEKLY_PLANNING_CORRECTION_TRANSACTION_VERSION_V5;
}

export function applyWeeklyPlanningCorrectionTransactionV5(params: {
  graph: WeeklyPlanningFactGraphV5;
  expectedRevision: number;
  correctionIntentFactId: string;
  operationKey: string;
}): WeeklyPlanningCorrectionTransactionResultV5 {
  const result = applyWeeklyPlanningCorrectionIntentV5(params);
  if (result.status !== 'applied') {
    return {
      ...result,
      transactionVersion: WEEKLY_PLANNING_CORRECTION_TRANSACTION_VERSION_V5,
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
    removed: [
      ...result.removed,
      { kind: 'correction_intent', id: params.correctionIntentFactId },
    ],
  };
}
