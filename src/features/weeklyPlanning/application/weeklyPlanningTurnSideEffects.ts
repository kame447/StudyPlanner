import {
  recordWeeklyPlanningStableV5TurnTrace,
} from '../trace/weeklyPlanningStableV5TraceRuntime';
import {
  WEEKLY_PLANNING_STABLE_V5_DEBUG_TRACE_SCHEMA_VERSION,
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

function stableV5TraceContext(
  conversationId: string,
  services: WeeklyPlanningTurnSideEffectServices,
) {
  const runtime = services.getRuntimeSession(conversationId);
  const graph = runtime?.graph;
  const activeFactIds = new Set(
    graph?.factLifecycles
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.factId) ?? [],
  );
  const planningWindow = graph?.planningWindows.find((fact) => activeFactIds.has(fact.id));
  return {
    graphRevision: graph?.revision ?? 0,
    graphSummary: {
      taskCount: graph?.tasks.length ?? 0,
      workloadCount: graph?.workloads.length ?? 0,
      availabilityCount: graph?.availabilityDeclarations.length ?? 0,
      activeFactCount: activeFactIds.size,
    },
    planningRangeStart: planningWindow?.start ?? undefined,
    planningRangeEnd: planningWindow?.end ?? undefined,
  };
}

function compatibilityStateWithDebugTrace(
  requestId: string,
  compatibilityState?: Record<string, unknown>,
  metadata?: Record<string, unknown>,
): unknown {
  const events = takeWeeklyPlanningStableV5DebugTrace(requestId);
  if (events.length === 0 && !metadata) return compatibilityState;
  return {
    ...(compatibilityState ?? {}),
    ...(metadata ?? {}),
    ...(events.length > 0
      ? {
          __stableV5DebugTrace: {
            schemaVersion: WEEKLY_PLANNING_STABLE_V5_DEBUG_TRACE_SCHEMA_VERSION,
            eventCount: events.length,
            events,
          },
        }
      : {}),
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
  const trace = stableV5TraceContext(params.pending.conversationId, services);
  const compatibilityState = compatibilityStateWithDebugTrace(
    params.pending.requestId,
    params.result.state as unknown as Record<string, unknown>,
  );
  return services.recordTurnTrace({
    userId: params.ownerId,
    conversationId: params.pending.conversationId,
    requestId: params.pending.requestId,
    userText: params.userText,
    assistantMessage: params.result.message,
    outcome: params.result.draftCandidates.length > 0
      ? 'preview_ready'
      : params.result.state.status,
    graphRevision: trace.graphRevision,
    graphSummary: trace.graphSummary,
    compatibilityState,
    previewCount: params.result.draftCandidates.length,
    planningRangeStart: trace.planningRangeStart,
    planningRangeEnd: trace.planningRangeEnd,
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
  const trace = stableV5TraceContext(params.pending.conversationId, services);
  const compatibilityState = compatibilityStateWithDebugTrace(
    params.pending.requestId,
    params.result.state as unknown as Record<string, unknown>,
    {
      __discardedExecution: {
        reason: params.reason,
        pending: params.pending,
        resultMessage: params.result.message,
        candidateCount: params.result.draftCandidates.length,
      },
    },
  );
  return services.recordTurnTrace({
    userId: params.ownerId,
    conversationId: params.pending.conversationId,
    requestId: params.pending.requestId,
    userText: params.userText,
    outcome: `discarded_${params.reason}`,
    graphRevision: trace.graphRevision,
    graphSummary: trace.graphSummary,
    compatibilityState,
    previewCount: 0,
    planningRangeStart: trace.planningRangeStart,
    planningRangeEnd: trace.planningRangeEnd,
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
  const trace = stableV5TraceContext(params.pending.conversationId, services);
  const compatibilityState = compatibilityStateWithDebugTrace(params.pending.requestId);
  return services.recordTurnTrace({
    userId: params.ownerId,
    conversationId: params.pending.conversationId,
    requestId: params.pending.requestId,
    userText: params.userText,
    assistantMessage: params.assistantMessage.content,
    outcome: 'failed',
    graphRevision: trace.graphRevision,
    graphSummary: trace.graphSummary,
    ...(compatibilityState ? { compatibilityState } : {}),
    previewCount: 0,
    planningRangeStart: trace.planningRangeStart,
    planningRangeEnd: trace.planningRangeEnd,
    errorCode: params.error instanceof Error ? params.error.name : 'unknown-error',
  });
}
