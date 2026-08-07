import {
  discardStagedUserPlanningContextV1,
  finalizeStagedUserPlanningContextV1,
  hasStagedUserPlanningContextV1,
  rollbackFinalizedUserPlanningContextV1,
} from '../../userPlanningContext/userPlanningContextSpace';
import {
  recordWeeklyPlanningStableV5TurnTrace,
} from '../trace/weeklyPlanningStableV5TraceRuntime';
import {
  takeWeeklyPlanningStableV5DebugTrace,
  type WeeklyPlanningStableV5DebugTraceEvent,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import {
  boundWeeklyPlanningDialogueRendererTraceForTransport,
  type WeeklyPlanningDialogueRendererTrace,
} from '../trace/weeklyPlanningDialogueRendererTrace';
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

const DUPLICATED_RENDERER_DEBUG_STAGES = new Set([
  'dialogue_renderer_request',
  'dialogue_renderer_response',
  'dialogue_renderer_decision',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function withoutRendererTrace(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'dialogueRendererTrace'),
  );
}

function compactTraceEventForPersistence(
  event: WeeklyPlanningStableV5DebugTraceEvent,
  hasDedicatedRendererTrace: boolean,
): WeeklyPlanningStableV5DebugTraceEvent | null {
  if (!hasDedicatedRendererTrace) return event;
  if (DUPLICATED_RENDERER_DEBUG_STAGES.has(event.stage)) return null;
  if (event.stage !== 'turn_executor_result_projected' || !isRecord(event.data)) return event;
  const data = event.data;
  return {
    ...event,
    data: {
      ...data,
      ...(Object.prototype.hasOwnProperty.call(data, 'result')
        ? { result: withoutRendererTrace(data.result) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(data, 'projectedResult')
        ? { projectedResult: withoutRendererTrace(data.projectedResult) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(data, 'originalResult')
        ? { originalResult: withoutRendererTrace(data.originalResult) }
        : {}),
    },
  };
}

function debugTraceEventsForPersistence(
  requestId: string,
  hasDedicatedRendererTrace: boolean,
): WeeklyPlanningStableV5DebugTraceEvent[] {
  return takeWeeklyPlanningStableV5DebugTrace(requestId)
    .flatMap((event) => {
      const compacted = compactTraceEventForPersistence(event, hasDedicatedRendererTrace);
      return compacted ? [compacted] : [];
    });
}

function rendererTraceForPersistence(
  result: WeeklyPlanningTurnExecutionResult,
): WeeklyPlanningDialogueRendererTrace | undefined {
  return result.dialogueRendererTrace
    ? boundWeeklyPlanningDialogueRendererTraceForTransport(result.dialogueRendererTrace)
    : undefined;
}

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
  if (!services.isStableV5Enabled()) return;
  discardStagedUserPlanningContextV1({
    conversationId: pending.conversationId,
    requestId: pending.requestId,
  });
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
  const dialogueRendererTrace = rendererTraceForPersistence(params.result);
  const debugTraceEvents = debugTraceEventsForPersistence(
    params.pending.requestId,
    Boolean(dialogueRendererTrace),
  );
  return services.recordTurnTrace({
    userId: params.ownerId,
    conversationId: params.pending.conversationId,
    requestId: params.pending.requestId,
    userText: params.userText,
    assistantMessage: params.result.message,
    ...(params.result.responseSource
      ? { responseSource: params.result.responseSource }
      : {}),
    ...(dialogueRendererTrace ? { dialogueRendererTrace } : {}),
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
  const dialogueRendererTrace = rendererTraceForPersistence(params.result);
  const debugTraceEvents = debugTraceEventsForPersistence(
    params.pending.requestId,
    Boolean(dialogueRendererTrace),
  );
  return services.recordTurnTrace({
    userId: params.ownerId,
    conversationId: params.pending.conversationId,
    requestId: params.pending.requestId,
    userText: params.userText,
    responseSource: 'system',
    ...(dialogueRendererTrace ? { dialogueRendererTrace } : {}),
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
  const debugTraceEvents = debugTraceEventsForPersistence(params.pending.requestId, false);
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
