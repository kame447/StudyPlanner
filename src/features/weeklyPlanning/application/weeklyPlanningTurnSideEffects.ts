import {
  recordWeeklyPlanningStableV5TurnTrace,
} from '../trace/weeklyPlanningStableV5TraceRuntime';
import {
  takeWeeklyPlanningStableV5DebugTrace,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import type {
  WeeklyPlanningMessage,
  WeeklyPlanningPendingTurn,
} from '../types';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutor';
import { isWeeklyPlanningStableV5RuntimeEnabled } from './weeklyPlanningRuntimeMode';
import {
  discardWeeklyPlanningStableV5StagedGraph,
  finalizeWeeklyPlanningStableV5RuntimeGraph,
  getWeeklyPlanningStableV5RuntimeSession,
  hasWeeklyPlanningStableV5StagedGraphForTest,
} from './weeklyPlanningStableV5RuntimeSession';

export interface WeeklyPlanningTurnSideEffectServices {
  isStableV5Enabled: typeof isWeeklyPlanningStableV5RuntimeEnabled;
  hasStagedGraph: typeof hasWeeklyPlanningStableV5StagedGraphForTest;
  finalizeRuntimeGraph: typeof finalizeWeeklyPlanningStableV5RuntimeGraph;
  discardStagedGraph: typeof discardWeeklyPlanningStableV5StagedGraph;
  getRuntimeSession: typeof getWeeklyPlanningStableV5RuntimeSession;
  recordTurnTrace: typeof recordWeeklyPlanningStableV5TurnTrace;
}

const defaultServices: WeeklyPlanningTurnSideEffectServices = {
  isStableV5Enabled: isWeeklyPlanningStableV5RuntimeEnabled,
  hasStagedGraph: hasWeeklyPlanningStableV5StagedGraphForTest,
  finalizeRuntimeGraph: finalizeWeeklyPlanningStableV5RuntimeGraph,
  discardStagedGraph: discardWeeklyPlanningStableV5StagedGraph,
  getRuntimeSession: getWeeklyPlanningStableV5RuntimeSession,
  recordTurnTrace: recordWeeklyPlanningStableV5TurnTrace,
};

function stableV5PlanningRange(
  conversationId: string,
  services: WeeklyPlanningTurnSideEffectServices,
) {
  const graph = services.getRuntimeSession(conversationId)?.graph;
  const activeFactIds = new Set(
    graph?.factLifecycles
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.factId) ?? [],
  );
  const planningWindow = graph?.planningWindows.find((fact) => activeFactIds.has(fact.id));
  return {
    planningRangeStart: planningWindow?.start ?? undefined,
    planningRangeEnd: planningWindow?.end ?? undefined,
  };
}

export function finalizeWeeklyPlanningApplicationTurn(params: {
  ownerId: string;
  pending: WeeklyPlanningPendingTurn;
}, services: WeeklyPlanningTurnSideEffectServices = defaultServices): void {
  if (!services.isStableV5Enabled()) return;
  if (!services.hasStagedGraph({
    conversationId: params.pending.conversationId,
    requestId: params.pending.requestId,
  })) {
    return;
  }
  services.finalizeRuntimeGraph({
    ownerId: params.ownerId,
    conversationId: params.pending.conversationId,
    requestId: params.pending.requestId,
  });
}

export function discardWeeklyPlanningApplicationTurn(
  pending: WeeklyPlanningPendingTurn,
  services: WeeklyPlanningTurnSideEffectServices = defaultServices,
): void {
  if (!services.isStableV5Enabled()) return;
  services.discardStagedGraph({
    conversationId: pending.conversationId,
    requestId: pending.requestId,
  });
}

export function recordCommittedWeeklyPlanningApplicationTurn(params: {
  ownerId: string;
  pending: WeeklyPlanningPendingTurn;
  userText: string;
  result: WeeklyPlanningTurnExecutionResult;
}, services: WeeklyPlanningTurnSideEffectServices = defaultServices): Promise<void> | null {
  if (!services.isStableV5Enabled()) return null;
  const range = stableV5PlanningRange(params.pending.conversationId, services);
  const debugTraceEvents = takeWeeklyPlanningStableV5DebugTrace(params.pending.requestId);
  return services.recordTurnTrace({
    userId: params.ownerId,
    conversationId: params.pending.conversationId,
    requestId: params.pending.requestId,
    userText: params.userText,
    assistantMessage: params.result.message,
    responseSource: params.result.responseSource,
    outcome: params.result.failure?.code
      ?? (params.result.draftCandidates.length > 0
        ? 'preview_ready'
        : params.result.state.status),
    debugTraceEvents,
    previewCount: params.result.draftCandidates.length,
    planningRangeStart: range.planningRangeStart,
    planningRangeEnd: range.planningRangeEnd,
    errorCode: params.result.failure?.traceCode,
  });
}

export function recordDiscardedWeeklyPlanningApplicationTurn(params: {
  ownerId: string;
  pending: WeeklyPlanningPendingTurn;
  userText: string;
  result: WeeklyPlanningTurnExecutionResult;
  reason: 'stale' | 'commit_rejected';
}, services: WeeklyPlanningTurnSideEffectServices = defaultServices): Promise<void> | null {
  if (!services.isStableV5Enabled()) return null;
  const range = stableV5PlanningRange(params.pending.conversationId, services);
  const debugTraceEvents = takeWeeklyPlanningStableV5DebugTrace(params.pending.requestId);
  return services.recordTurnTrace({
    userId: params.ownerId,
    conversationId: params.pending.conversationId,
    requestId: params.pending.requestId,
    userText: params.userText,
    outcome: `discarded_${params.reason}`,
    debugTraceEvents,
    previewCount: 0,
    planningRangeStart: range.planningRangeStart,
    planningRangeEnd: range.planningRangeEnd,
    errorCode: params.reason === 'stale'
      ? 'stale_async_result_discarded'
      : 'commit_rejected',
  });
}

export function recordFailedWeeklyPlanningApplicationTurn(params: {
  ownerId: string;
  pending: WeeklyPlanningPendingTurn;
  userText: string;
  error: unknown;
  assistantMessage: WeeklyPlanningMessage;
}, services: WeeklyPlanningTurnSideEffectServices = defaultServices): Promise<void> | null {
  if (!services.isStableV5Enabled()) return null;
  const range = stableV5PlanningRange(params.pending.conversationId, services);
  const debugTraceEvents = takeWeeklyPlanningStableV5DebugTrace(params.pending.requestId);
  return services.recordTurnTrace({
    userId: params.ownerId,
    conversationId: params.pending.conversationId,
    requestId: params.pending.requestId,
    userText: params.userText,
    assistantMessage: params.assistantMessage.content,
    responseSource: 'system',
    outcome: 'failed',
    debugTraceEvents,
    previewCount: 0,
    planningRangeStart: range.planningRangeStart,
    planningRangeEnd: range.planningRangeEnd,
    errorCode: params.error instanceof Error ? params.error.name : 'unknown-error',
  });
}
