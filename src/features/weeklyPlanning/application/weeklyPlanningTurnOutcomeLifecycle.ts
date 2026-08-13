import { saveOwnedWeeklyPlanningState } from '../weeklyPlanningOwnedStorage';
import type {
  PlanningState,
  WeeklyPlanningMessage,
  WeeklyPlanningPendingTurn,
} from '../types';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutionTypes';
import {
  recordCommittedWeeklyPlanningApplicationTurn,
  recordDiscardedWeeklyPlanningApplicationTurn,
  recordFailedWeeklyPlanningApplicationTurn,
} from './weeklyPlanningTurnTraceSideEffects';

export interface WeeklyPlanningTurnOutcomeLifecycleServices {
  saveOwnedState: typeof saveOwnedWeeklyPlanningState;
  recordCommittedTurn: typeof recordCommittedWeeklyPlanningApplicationTurn;
  recordDiscardedTurn: typeof recordDiscardedWeeklyPlanningApplicationTurn;
  recordFailedTurn: typeof recordFailedWeeklyPlanningApplicationTurn;
}

const defaultServices: WeeklyPlanningTurnOutcomeLifecycleServices = {
  saveOwnedState: saveOwnedWeeklyPlanningState,
  recordCommittedTurn: recordCommittedWeeklyPlanningApplicationTurn,
  recordDiscardedTurn: recordDiscardedWeeklyPlanningApplicationTurn,
  recordFailedTurn: recordFailedWeeklyPlanningApplicationTurn,
};

export interface WeeklyPlanningTurnOutcomeLifecycle {
  committed(params: {
    ownerId: string;
    pending: WeeklyPlanningPendingTurn;
    userText: string;
    result: WeeklyPlanningTurnExecutionResult;
    committed: PlanningState;
  }): void;
  discarded(params: {
    ownerId: string;
    pending: WeeklyPlanningPendingTurn;
    userText: string;
    result: WeeklyPlanningTurnExecutionResult;
    reason: 'stale' | 'commit_rejected' | 'failed';
  }): void;
  failed(params: {
    ownerId: string;
    pending: WeeklyPlanningPendingTurn;
    userText: string;
    error: unknown;
    failedState: PlanningState;
    assistantMessage: WeeklyPlanningMessage;
  }): void;
}

export function createWeeklyPlanningTurnOutcomeLifecycle(
  services: WeeklyPlanningTurnOutcomeLifecycleServices = defaultServices,
): WeeklyPlanningTurnOutcomeLifecycle {
  return {
    committed(params) {
      services.saveOwnedState(params.ownerId, params.committed);
      const traceWrite = services.recordCommittedTurn({
        ownerId: params.ownerId,
        pending: params.pending,
        userText: params.userText,
        result: params.result,
      });
      if (traceWrite) void traceWrite;
    },
    discarded(params) {
      if (params.reason === 'failed') return;
      const traceWrite = services.recordDiscardedTurn({
        ownerId: params.ownerId,
        pending: params.pending,
        userText: params.userText,
        result: params.result,
        reason: params.reason,
      });
      if (traceWrite) void traceWrite;
    },
    failed(params) {
      services.saveOwnedState(params.ownerId, params.failedState);
      const traceWrite = services.recordFailedTurn({
        ownerId: params.ownerId,
        pending: params.pending,
        userText: params.userText,
        error: params.error,
        assistantMessage: params.assistantMessage,
      });
      if (traceWrite) void traceWrite;
    },
  };
}

export const weeklyPlanningTurnOutcomeLifecycle = createWeeklyPlanningTurnOutcomeLifecycle();
