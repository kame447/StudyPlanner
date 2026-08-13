import {
  discardStagedUserPlanningContextV1,
  finalizeStagedUserPlanningContextV1,
  hasStagedUserPlanningContextV1,
  rollbackFinalizedUserPlanningContextV1,
} from '../../userPlanningContext/userPlanningContextSpace';
import {
  recordWeeklyPlanningStableV5TurnTrace,
} from '../trace/weeklyPlanningStableV5TraceRuntime';
import type {
  WeeklyPlanningPendingTurn,
} from '../types';
import {
  discardWeeklyPlanningStableV5StagedGraph,
  finalizeWeeklyPlanningStableV5RuntimeGraph,
  getWeeklyPlanningStableV5RuntimeSession,
  hasWeeklyPlanningStableV5StagedGraphForTest,
} from './weeklyPlanningStableV5RuntimeSession';
import type {
  WeeklyPlanningTurnTraceSideEffectServices,
} from './weeklyPlanningTurnTraceSideEffects';

export {
  recordCommittedWeeklyPlanningApplicationTurn,
  recordDiscardedWeeklyPlanningApplicationTurn,
  recordFailedWeeklyPlanningApplicationTurn,
} from './weeklyPlanningTurnTraceSideEffects';
export type {
  WeeklyPlanningTurnTraceSideEffectServices,
} from './weeklyPlanningTurnTraceSideEffects';

export interface WeeklyPlanningTurnSideEffectServices
  extends WeeklyPlanningTurnTraceSideEffectServices {
  hasStagedGraph: typeof hasWeeklyPlanningStableV5StagedGraphForTest;
  finalizeRuntimeGraph: typeof finalizeWeeklyPlanningStableV5RuntimeGraph;
  discardStagedGraph: typeof discardWeeklyPlanningStableV5StagedGraph;
}

const defaultServices: WeeklyPlanningTurnSideEffectServices = {
  hasStagedGraph: hasWeeklyPlanningStableV5StagedGraphForTest,
  finalizeRuntimeGraph: finalizeWeeklyPlanningStableV5RuntimeGraph,
  discardStagedGraph: discardWeeklyPlanningStableV5StagedGraph,
  getRuntimeSession: getWeeklyPlanningStableV5RuntimeSession,
  recordTurnTrace: recordWeeklyPlanningStableV5TurnTrace,
};

export function finalizeWeeklyPlanningApplicationTurn(params: {
  ownerId: string;
  pending: WeeklyPlanningPendingTurn;
}, services: WeeklyPlanningTurnSideEffectServices = defaultServices): void {
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

export function discardWeeklyPlanningApplicationTurn(
  pending: WeeklyPlanningPendingTurn,
  services: WeeklyPlanningTurnSideEffectServices = defaultServices,
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

export const weeklyPlanningTurnStagingLifecycle: WeeklyPlanningTurnStagingLifecycle = {
  finalize: finalizeWeeklyPlanningApplicationTurn,
  discard: discardWeeklyPlanningApplicationTurn,
};
