import {
  createFirebasePlanningOutcomeTelemetryPort,
  type PlanningOutcomeTelemetryInput,
  type PlanningOutcomeTelemetryPort,
} from '../../productObservability/planningOutcomeTelemetry';
import type {
  PlanningState,
  WeeklyPlanningPendingApproval,
  WeeklyPlanningPendingTurn,
} from '../types';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutionTypes';

function turnIndex(pending: WeeklyPlanningPendingTurn): number | null {
  const match = pending.turnId.match(/:turn:(\d+)$/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function recordBestEffort(
  port: PlanningOutcomeTelemetryPort,
  input: PlanningOutcomeTelemetryInput,
): void {
  try {
    port.recordOutcome(input);
  } catch {
    // Observability must never become part of weekly-planning product success/failure.
  }
}

function portOrDefault(port?: PlanningOutcomeTelemetryPort): PlanningOutcomeTelemetryPort {
  return port ?? createFirebasePlanningOutcomeTelemetryPort();
}

function turnBase(params: {
  pending: WeeklyPlanningPendingTurn;
  stateRevision: number | null;
  occurredAt?: string;
}) {
  return {
    featureSessionId: params.pending.conversationId,
    requestId: params.pending.requestId,
    turnIndex: turnIndex(params.pending),
    stateRevision: params.stateRevision,
    occurredAt: params.occurredAt,
  };
}

export function recordWeeklyPlanningTurnStarted(params: {
  pending: WeeklyPlanningPendingTurn;
  port?: PlanningOutcomeTelemetryPort;
}): void {
  const index = turnIndex(params.pending);
  const port = portOrDefault(params.port);
  recordBestEffort(port, {
    outcomeType: 'turn_started',
    featureSessionId: params.pending.conversationId,
    dedupeKey: params.pending.requestId,
    requestId: params.pending.requestId,
    stateRevision: params.pending.baseRevision,
    turnIndex: index,
    occurredAt: params.pending.startedAt,
  });

  if (index !== 1) return;
  recordBestEffort(port, {
    outcomeType: 'session_started',
    featureSessionId: params.pending.conversationId,
    dedupeKey: params.pending.conversationId,
    requestId: params.pending.requestId,
    stateRevision: params.pending.baseRevision,
    turnIndex: index,
    occurredAt: params.pending.startedAt,
  });
}

export function recordWeeklyPlanningTurnCommitted(params: {
  pending: WeeklyPlanningPendingTurn;
  result: WeeklyPlanningTurnExecutionResult;
  committed: PlanningState;
  port?: PlanningOutcomeTelemetryPort;
}): void {
  const port = portOrDefault(params.port);
  const base = turnBase({
    pending: params.pending,
    stateRevision: params.committed.revision,
    occurredAt: params.committed.updatedAt,
  });
  const observability = params.result.observability;

  if ((observability?.previewCount ?? 0) > 0) {
    recordBestEffort(port, {
      ...base,
      outcomeType: 'preview_generated',
      dedupeKey: params.pending.requestId,
      previewCount: observability?.previewCount ?? null,
      unscheduledCount: observability?.unscheduledCount ?? null,
      repairUsed: observability?.repairUsed ?? null,
      schedulerVersion: observability?.schedulerVersion ?? null,
    });
  }

  if ((observability?.unscheduledCount ?? 0) > 0) {
    recordBestEffort(port, {
      ...base,
      outcomeType: 'unscheduled_observed',
      dedupeKey: params.pending.requestId,
      previewCount: observability?.previewCount ?? null,
      unscheduledCount: observability?.unscheduledCount ?? null,
      repairUsed: observability?.repairUsed ?? null,
      schedulerVersion: observability?.schedulerVersion ?? null,
    });
  }

  if (observability?.repairUsed === true) {
    recordBestEffort(port, {
      ...base,
      outcomeType: 'semantic_repair_used',
      dedupeKey: params.pending.requestId,
      previewCount: observability.previewCount,
      unscheduledCount: observability.unscheduledCount,
      repairUsed: true,
      schedulerVersion: observability.schedulerVersion,
    });
  }

  if (
    params.result.responseSource === 'deterministic_fallback'
    || params.result.responseSource === 'rules'
  ) {
    recordBestEffort(port, {
      ...base,
      outcomeType: 'fallback_used',
      dedupeKey: params.pending.requestId,
      previewCount: observability?.previewCount ?? null,
      unscheduledCount: observability?.unscheduledCount ?? null,
      fallbackUsed: true,
      repairUsed: observability?.repairUsed ?? null,
      schedulerVersion: observability?.schedulerVersion ?? null,
    });
  }
}

export function recordWeeklyPlanningTurnDiscarded(params: {
  pending: WeeklyPlanningPendingTurn;
  result: WeeklyPlanningTurnExecutionResult;
  reason: 'stale' | 'commit_rejected' | 'failed';
  port?: PlanningOutcomeTelemetryPort;
}): void {
  if (params.reason !== 'stale') return;
  const observability = params.result.observability;
  recordBestEffort(portOrDefault(params.port), {
    ...turnBase({
      pending: params.pending,
      stateRevision: params.pending.baseRevision,
    }),
    outcomeType: 'stale_observed',
    dedupeKey: params.pending.requestId,
    previewCount: observability?.previewCount ?? null,
    unscheduledCount: observability?.unscheduledCount ?? null,
    fallbackUsed: params.result.responseSource === 'deterministic_fallback'
      || params.result.responseSource === 'rules',
    repairUsed: observability?.repairUsed ?? null,
    staleObserved: true,
    schedulerVersion: observability?.schedulerVersion ?? null,
  });
}

export function recordWeeklyPlanningTurnFailed(params: {
  pending: WeeklyPlanningPendingTurn;
  failedState: PlanningState;
  result?: WeeklyPlanningTurnExecutionResult;
  port?: PlanningOutcomeTelemetryPort;
}): void {
  const port = portOrDefault(params.port);
  const observability = params.result?.observability;
  const base = turnBase({
    pending: params.pending,
    stateRevision: params.failedState.revision,
    occurredAt: params.failedState.updatedAt,
  });

  recordBestEffort(port, {
    ...base,
    outcomeType: 'failed',
    dedupeKey: params.pending.requestId,
    previewCount: observability?.previewCount ?? null,
    unscheduledCount: observability?.unscheduledCount ?? null,
    fallbackUsed: params.result?.responseSource === 'deterministic_fallback'
      || params.result?.responseSource === 'rules',
    repairUsed: observability?.repairUsed ?? null,
    schedulerVersion: observability?.schedulerVersion ?? null,
  });

  if (observability?.repairUsed === true) {
    recordBestEffort(port, {
      ...base,
      outcomeType: 'semantic_repair_used',
      dedupeKey: params.pending.requestId,
      previewCount: observability.previewCount,
      unscheduledCount: observability.unscheduledCount,
      repairUsed: true,
      schedulerVersion: observability.schedulerVersion,
    });
  }
}

export function recordWeeklyPlanningApprovalStarted(params: {
  featureSessionId: string;
  pending: WeeklyPlanningPendingApproval;
  previewCount: number;
  port?: PlanningOutcomeTelemetryPort;
}): void {
  recordBestEffort(portOrDefault(params.port), {
    outcomeType: 'approval_started',
    featureSessionId: params.featureSessionId,
    dedupeKey: params.pending.requestId,
    requestId: params.pending.requestId,
    stateRevision: params.pending.baseRevision,
    previewCount: params.previewCount,
    occurredAt: params.pending.startedAt,
  });
}

export function recordWeeklyPlanningApprovalCompleted(params: {
  featureSessionId: string;
  pending: WeeklyPlanningPendingApproval;
  completedState: PlanningState;
  previewCount: number;
  port?: PlanningOutcomeTelemetryPort;
}): void {
  const port = portOrDefault(params.port);
  const base = {
    featureSessionId: params.featureSessionId,
    dedupeKey: params.pending.requestId,
    requestId: params.pending.requestId,
    stateRevision: params.completedState.revision,
    previewCount: params.previewCount,
    occurredAt: params.completedState.updatedAt,
  };
  recordBestEffort(port, { ...base, outcomeType: 'approval_completed' });
  recordBestEffort(port, { ...base, outcomeType: 'save_completed' });
}

export function recordWeeklyPlanningApprovalFailure(params: {
  featureSessionId: string;
  pending: WeeklyPlanningPendingApproval;
  stateRevision: number;
  previewCount: number;
  port?: PlanningOutcomeTelemetryPort;
}): void {
  recordBestEffort(portOrDefault(params.port), {
    outcomeType: 'approval_failure_observed',
    featureSessionId: params.featureSessionId,
    dedupeKey: params.pending.requestId,
    requestId: params.pending.requestId,
    stateRevision: params.stateRevision,
    previewCount: params.previewCount,
    approvalFailureObserved: true,
  });
}
