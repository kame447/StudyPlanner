import {
  discardStagedUserPlanningContextV1,
  finalizeStagedUserPlanningContextV1,
  hasStagedUserPlanningContextV1,
  rollbackFinalizedUserPlanningContextV1,
} from '../../userPlanningContext/userPlanningContextSpace';
import type {
  WeeklyPlanningPendingTurn,
} from '../types';
import {
  discardWeeklyPlanningStableV5StagedGraph,
  finalizeWeeklyPlanningStableV5RuntimeGraph,
  hasWeeklyPlanningStableV5StagedGraphForTest,
} from './weeklyPlanningStableV5RuntimeSession';

export interface WeeklyPlanningTurnStagingLifecycleServices {
  hasStagedGraph: typeof hasWeeklyPlanningStableV5StagedGraphForTest;
  finalizeRuntimeGraph: typeof finalizeWeeklyPlanningStableV5RuntimeGraph;
  discardStagedGraph: typeof discardWeeklyPlanningStableV5StagedGraph;
}

const defaultServices: WeeklyPlanningTurnStagingLifecycleServices = {
  hasStagedGraph: hasWeeklyPlanningStableV5StagedGraphForTest,
  finalizeRuntimeGraph: finalizeWeeklyPlanningStableV5RuntimeGraph,
  discardStagedGraph: discardWeeklyPlanningStableV5StagedGraph,
};

function finalizeStaging(params: {
  ownerId: string;
  pending: WeeklyPlanningPendingTurn;
}, services: WeeklyPlanningTurnStagingLifecycleServices): void {
  const hasGraph = services.hasStagedGraph({
    conversationId: params.pending.conversationId,
    requestId: params.pending.requestId,
  });
  const hasContext = hasStagedUserPlanningContextV1({
    conversationId: params.pending.conversationId,
    requestId: params.pending.requestId,
  });
  if (!hasGraph && !hasContext) return;

  const contextReceipt = hasContext
    ? finalizeStagedUserPlanningContextV1({
        ownerId: params.ownerId,
        conversationId: params.pending.conversationId,
        requestId: params.pending.requestId,
      })
    : null;
  try {
    if (hasGraph) {
      services.finalizeRuntimeGraph({
        ownerId: params.ownerId,
        conversationId: params.pending.conversationId,
        requestId: params.pending.requestId,
      });
    }
  } catch (error) {
    rollbackFinalizedUserPlanningContextV1(contextReceipt);
    throw error;
  }
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
  finalize(params: {
    ownerId: string;
    pending: WeeklyPlanningPendingTurn;
  }): void;
  discard(pending: WeeklyPlanningPendingTurn): void;
}

export function createWeeklyPlanningTurnStagingLifecycle(
  services: WeeklyPlanningTurnStagingLifecycleServices = defaultServices,
): WeeklyPlanningTurnStagingLifecycle {
  return {
    finalize(params) {
      finalizeStaging(params, services);
    },
    discard(pending) {
      discardStaging(pending, services);
    },
  };
}

export const weeklyPlanningTurnStagingLifecycle = createWeeklyPlanningTurnStagingLifecycle();
