import { describe, expect, it, vi } from 'vitest';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import type { PlanningOutcomeTelemetryInput, PlanningOutcomeTelemetryPort } from '../../productObservability/planningOutcomeTelemetry';
import type { WeeklyPlanningPendingApproval, WeeklyPlanningPendingTurn } from '../types';
import { createInitialPlanningState } from '../weeklyPlanningReducer';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutionTypes';
import {
  recordWeeklyPlanningApprovalCompleted,
  recordWeeklyPlanningApprovalFailure,
  recordWeeklyPlanningApprovalStarted,
  recordWeeklyPlanningTurnCommitted,
  recordWeeklyPlanningTurnDiscarded,
  recordWeeklyPlanningTurnFailed,
  recordWeeklyPlanningTurnStarted,
} from './weeklyPlanningOutcomeObservability';

function turnPending(turn = 1): WeeklyPlanningPendingTurn {
  return {
    conversationId: 'weekly-conversation-1',
    turnId: `weekly-conversation-1:turn:${turn}`,
    requestId: `weekly-request-${turn}`,
    weekStartDate: '2026-08-24',
    baseRevision: (turn - 1) * 2,
    startedAt: '2026-08-28T01:00:00.000Z',
  };
}

function approvalPending(): WeeklyPlanningPendingApproval {
  return {
    requestId: 'weekly-approval-12345678',
    weekStartDate: '2026-08-24',
    baseRevision: 4,
    blockIds: ['block-1', 'block-2'],
    startedAt: '2026-08-28T01:05:00.000Z',
  };
}

function result(overrides: Partial<WeeklyPlanningTurnExecutionResult> = {}): WeeklyPlanningTurnExecutionResult {
  return {
    state: createInitialPlanningIntakeState(),
    message: '確認しました。',
    draftCandidates: [],
    observability: {
      repairUsed: false,
      schedulerVersion: null,
      previewCount: null,
      unscheduledCount: null,
    },
    ...overrides,
  };
}

function recordingPort() {
  const events: PlanningOutcomeTelemetryInput[] = [];
  const port: PlanningOutcomeTelemetryPort = {
    recordOutcome(input) {
      events.push(input);
    },
  };
  return { port, events };
}

describe('weekly planning typed outcome observability', () => {
  it('emits session_started only for the first accepted turn', () => {
    const { port, events } = recordingPort();

    recordWeeklyPlanningTurnStarted({ pending: turnPending(1), port });
    recordWeeklyPlanningTurnStarted({ pending: turnPending(2), port });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      outcomeType: 'session_started',
      featureSessionId: 'weekly-conversation-1',
      turnIndex: 1,
    });
  });

  it('projects preview, unscheduled and semantic-repair outcomes from typed runtime diagnostics', () => {
    const { port, events } = recordingPort();
    const committed = {
      ...createInitialPlanningState('2026-08-24'),
      revision: 4,
      updatedAt: '2026-08-28T01:02:00.000Z',
    };

    recordWeeklyPlanningTurnCommitted({
      pending: turnPending(2),
      committed,
      result: result({
        observability: {
          repairUsed: true,
          schedulerVersion: 'weekly-planning-stable-v5-preview-scheduler-v1',
          previewCount: 3,
          unscheduledCount: 1,
        },
      }),
      port,
    });

    expect(events.map((event) => event.outcomeType)).toEqual([
      'preview_generated',
      'unscheduled_observed',
      'semantic_repair_used',
    ]);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        outcomeType: 'preview_generated',
        previewCount: 3,
        unscheduledCount: 1,
        repairUsed: true,
        schedulerVersion: 'weekly-planning-stable-v5-preview-scheduler-v1',
      }),
    ]));
  });

  it('does not invent preview or unscheduled outcomes when the runtime values are unknown', () => {
    const { port, events } = recordingPort();
    const committed = createInitialPlanningState('2026-08-24');

    recordWeeklyPlanningTurnCommitted({
      pending: turnPending(1),
      committed,
      result: result(),
      port,
    });

    expect(events).toEqual([]);
  });

  it('records fallback only from an explicit typed response source', () => {
    const { port, events } = recordingPort();
    recordWeeklyPlanningTurnCommitted({
      pending: turnPending(1),
      committed: createInitialPlanningState('2026-08-24'),
      result: result({ responseSource: 'deterministic_fallback' }),
      port,
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      outcomeType: 'fallback_used',
      fallbackUsed: true,
    });
  });

  it('records stale only for the explicit stale discard reason', () => {
    const { port, events } = recordingPort();
    const executionResult = result();

    recordWeeklyPlanningTurnDiscarded({
      pending: turnPending(1),
      result: executionResult,
      reason: 'commit_rejected',
      port,
    });
    recordWeeklyPlanningTurnDiscarded({
      pending: turnPending(1),
      result: executionResult,
      reason: 'stale',
      port,
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      outcomeType: 'stale_observed',
      staleObserved: true,
    });
  });

  it('records failed and repair-used from a typed failed result', () => {
    const { port, events } = recordingPort();
    recordWeeklyPlanningTurnFailed({
      pending: turnPending(1),
      failedState: createInitialPlanningState('2026-08-24'),
      result: result({
        observability: {
          repairUsed: true,
          schedulerVersion: null,
          previewCount: null,
          unscheduledCount: null,
        },
      }),
      port,
    });

    expect(events.map((event) => event.outcomeType)).toEqual([
      'failed',
      'semantic_repair_used',
    ]);
  });

  it('projects approval start, successful save, and approval failure from typed approval transitions', () => {
    const { port, events } = recordingPort();
    const pending = approvalPending();
    const completedState = {
      ...createInitialPlanningState('2026-08-24'),
      revision: 6,
      updatedAt: '2026-08-28T01:06:00.000Z',
    };

    recordWeeklyPlanningApprovalStarted({
      featureSessionId: 'weekly-conversation-1',
      pending,
      previewCount: 2,
      port,
    });
    recordWeeklyPlanningApprovalCompleted({
      featureSessionId: 'weekly-conversation-1',
      pending,
      completedState,
      previewCount: 2,
      port,
    });
    recordWeeklyPlanningApprovalFailure({
      featureSessionId: 'weekly-conversation-1',
      pending,
      stateRevision: 7,
      previewCount: 2,
      port,
    });

    expect(events.map((event) => event.outcomeType)).toEqual([
      'approval_started',
      'approval_completed',
      'save_completed',
      'approval_failure_observed',
    ]);
  });

  it('swallows a synchronous telemetry adapter failure', () => {
    const port: PlanningOutcomeTelemetryPort = {
      recordOutcome: vi.fn(() => {
        throw new Error('telemetry unavailable');
      }),
    };

    expect(() => recordWeeklyPlanningTurnStarted({
      pending: turnPending(1),
      port,
    })).not.toThrow();
  });
});
