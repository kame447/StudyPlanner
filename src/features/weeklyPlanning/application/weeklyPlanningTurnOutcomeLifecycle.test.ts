import { describe, expect, it, vi } from 'vitest';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import type { WeeklyPlanningPendingTurn } from '../types';
import { createInitialPlanningState } from '../weeklyPlanningReducer';
import {
  createWeeklyPlanningTurnOutcomeLifecycle,
} from './weeklyPlanningTurnOutcomeLifecycle';

function pending(): WeeklyPlanningPendingTurn {
  return {
    conversationId: 'conversation-1',
    turnId: 'conversation-1:turn:1',
    requestId: 'conversation-1:request:1',
    weekStartDate: '2026-07-27',
    baseRevision: 0,
    startedAt: '2026-07-27T09:00:00.000Z',
  };
}

function result() {
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
  };
}

function services() {
  return {
    saveOwnedState: vi.fn(),
    recordCommittedTurn: vi.fn(() => null),
    recordDiscardedTurn: vi.fn(() => null),
    recordFailedTurn: vi.fn(() => null),
    recordStartedOutcome: vi.fn(),
    recordCommittedOutcome: vi.fn(),
    recordDiscardedOutcome: vi.fn(),
    recordFailedOutcome: vi.fn(),
  };
}

describe('weeklyPlanningTurnOutcomeLifecycle', () => {
  it('records an accepted turn start through the typed outcome adapter', () => {
    const effects = services();
    const lifecycle = createWeeklyPlanningTurnOutcomeLifecycle(effects);

    expect(lifecycle.started).toBeTypeOf('function');
    lifecycle.started?.({ ownerId: 'owner-1', pending: pending() });

    expect(effects.recordStartedOutcome).toHaveBeenCalledWith({ pending: pending() });
  });

  it('persists committed state before recording committed observability and trace', () => {
    const effects = services();
    const lifecycle = createWeeklyPlanningTurnOutcomeLifecycle(effects);
    const committed = createInitialPlanningState('2026-07-27');

    lifecycle.committed({
      ownerId: 'owner-1',
      pending: pending(),
      userText: '来週の予定を作りたい',
      result: result(),
      committed,
    });

    expect(effects.saveOwnedState).toHaveBeenCalledWith('owner-1', committed);
    expect(effects.recordCommittedOutcome).toHaveBeenCalledWith({
      pending: pending(),
      result: result(),
      committed,
    });
    expect(effects.recordCommittedTurn).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'owner-1',
      userText: '来週の予定を作りたい',
    }));
    expect(effects.saveOwnedState.mock.invocationCallOrder[0]).toBeLessThan(
      effects.recordCommittedOutcome.mock.invocationCallOrder[0],
    );
  });

  it('records stale and rejected discards but leaves failed-turn outcome to failed()', () => {
    const effects = services();
    const lifecycle = createWeeklyPlanningTurnOutcomeLifecycle(effects);
    const common = {
      ownerId: 'owner-1',
      pending: pending(),
      userText: '来週の予定を作りたい',
      result: result(),
    };

    lifecycle.discarded({ ...common, reason: 'stale' });
    lifecycle.discarded({ ...common, reason: 'failed' });

    expect(effects.recordDiscardedTurn).toHaveBeenCalledTimes(1);
    expect(effects.recordDiscardedTurn).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'stale',
    }));
    expect(effects.recordDiscardedOutcome).toHaveBeenCalledTimes(1);
    expect(effects.recordDiscardedOutcome).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'stale',
    }));
  });

  it('persists failed state before recording the failure outcome and trace', () => {
    const effects = services();
    const lifecycle = createWeeklyPlanningTurnOutcomeLifecycle(effects);
    const failedState = createInitialPlanningState('2026-07-27');
    const error = new Error('provider unavailable');
    const executionResult = result();

    lifecycle.failed({
      ownerId: 'owner-1',
      pending: pending(),
      userText: '来週の予定を作りたい',
      result: executionResult,
      error,
      failedState,
      assistantMessage: {
        id: 'assistant-1',
        role: 'assistant',
        content: '週間計画の会話状態を更新できませんでした。',
        createdAt: '2026-07-27T09:00:01.000Z',
      },
    });

    expect(effects.saveOwnedState).toHaveBeenCalledWith('owner-1', failedState);
    expect(effects.recordFailedOutcome).toHaveBeenCalledWith({
      pending: pending(),
      result: executionResult,
      failedState,
    });
    expect(effects.recordFailedTurn).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'owner-1',
      error,
    }));
    expect(effects.saveOwnedState.mock.invocationCallOrder[0]).toBeLessThan(
      effects.recordFailedOutcome.mock.invocationCallOrder[0],
    );
  });
});
