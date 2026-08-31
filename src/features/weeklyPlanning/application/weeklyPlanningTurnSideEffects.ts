import {
  discardStagedUserPlanningContextV1,
  finalizeStagedUserPlanningContextV1,
  hasStagedUserPlanningContextV1,
  rollbackFinalizedUserPlanningContextV1,
} from '../../userPlanningContext/userPlanningContextSpace';
import { publishUserPlanningContextCommittedV1 } from '../../userPlanningContext/userPlanningContextSyncEvents';
import type {
  WeeklyPlanningPendingTurn,
} from '../types';
import {
  discardWeeklyPlanningStableV5StagedGraph,
  finalizeWeeklyPlanningStableV5RuntimeGraphWithReceipt,
  hasWeeklyPlanningStableV5StagedGraphForTest,
  rollbackWeeklyPlanningStableV5RuntimeGraphFinalize,
} from './weeklyPlanningStableV5RuntimeSession';

export interface WeeklyPlanningTurnStagingLifecycleServices {
  hasStagedGraph: typeof hasWeeklyPlanningStableV5StagedGraphForTest;
  finalizeRuntimeGraph: typeof finalizeWeeklyPlanningStableV5RuntimeGraphWithReceipt;
  rollbackRuntimeGraph: typeof rollbackWeeklyPlanningStableV5RuntimeGraphFinalize;
  discardStagedGraph: typeof discardWeeklyPlanningStableV5StagedGraph;
}

const defaultServices: WeeklyPlanningTurnStagingLifecycleServices = {
  hasStagedGraph: hasWeeklyPlanningStableV5StagedGraphForTest,
  finalizeRuntimeGraph: finalizeWeeklyPlanningStableV5RuntimeGraphWithReceipt,
  rollbackRuntimeGraph: rollbackWeeklyPlanningStableV5RuntimeGraphFinalize,
  discardStagedGraph: discardWeeklyPlanningStableV5StagedGraph,
};

export interface WeeklyPlanningTurnPreparedStagingCommit {
  rollback(): void;
  complete(): void;
}

function prepareStaging(params: {
  ownerId: string;
  pending: WeeklyPlanningPendingTurn;
}, services: WeeklyPlanningTurnStagingLifecycleServices): WeeklyPlanningTurnPreparedStagingCommit | undefined {
  const hasGraph = services.hasStagedGraph({
    conversationId: params.pending.conversationId,
    requestId: params.pending.requestId,
  });
  const hasContext = hasStagedUserPlanningContextV1({
    conversationId: params.pending.conversationId,
    requestId: params.pending.requestId,
  });
  if (!hasGraph && !hasContext) return undefined;

  const contextReceipt = hasContext
    ? finalizeStagedUserPlanningContextV1({
        ownerId: params.ownerId,
        conversationId: params.pending.conversationId,
        requestId: params.pending.requestId,
      })
    : null;
  let graphReceipt: ReturnType<
    typeof finalizeWeeklyPlanningStableV5RuntimeGraphWithReceipt
  >['receipt'] | null = null;
  try {
    if (hasGraph) {
      graphReceipt = services.finalizeRuntimeGraph({
        ownerId: params.ownerId,
        conversationId: params.pending.conversationId,
        requestId: params.pending.requestId,
      }).receipt;
    }
  } catch (error) {
    rollbackFinalizedUserPlanningContextV1(contextReceipt);
    throw error;
  }

  let settled = false;
  return {
    rollback() {
      if (settled) return;
      if (graphReceipt && !services.rollbackRuntimeGraph(graphReceipt)) {
        throw new Error('Stable V5 prepared graph commit could not be rolled back safely.');
      }
      rollbackFinalizedUserPlanningContextV1(contextReceipt);
      settled = true;
    },
    complete() {
      if (settled) return;
      settled = true;
      if (contextReceipt?.committedRecords.length) {
        publishUserPlanningContextCommittedV1({
          ownerId: contextReceipt.ownerId,
          records: contextReceipt.committedRecords,
        });
      }
    },
  };
}

function discardStaging(
  pending: WeeklyPlanningPendingTurn,
  services: WeeklyPlanningTurnStagingLifecycleServices,
): void {
  discardStagedUserPlanningContextV1({
    conversationId: pending.conversationId,
    requestId: pending.requestId,
  });
  services.discardStagedGraph({
    conversationId: pending.conversationId,
    requestId: pending.requestId,
  });
}

export interface WeeklyPlanningTurnStagingLifecycle {
  prepare(params: {
    ownerId: string;
    pending: WeeklyPlanningPendingTurn;
  }): WeeklyPlanningTurnPreparedStagingCommit | undefined;
  discard(pending: WeeklyPlanningPendingTurn): void;
}

export function createWeeklyPlanningTurnStagingLifecycle(
  services: WeeklyPlanningTurnStagingLifecycleServices = defaultServices,
): WeeklyPlanningTurnStagingLifecycle {
  return {
    prepare(params) {
      return prepareStaging(params, services);
    },
    discard(pending) {
      discardStaging(pending, services);
    },
  };
}

export const weeklyPlanningTurnStagingLifecycle = createWeeklyPlanningTurnStagingLifecycle();
