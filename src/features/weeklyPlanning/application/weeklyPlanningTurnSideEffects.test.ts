import { describe, expect, it, vi } from 'vitest';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import type { WeeklyPlanningPendingTurn } from '../types';
import {
  discardWeeklyPlanningApplicationTurn,
  finalizeWeeklyPlanningApplicationTurn,
  recordCommittedWeeklyPlanningApplicationTurn,
  recordFailedWeeklyPlanningApplicationTurn,
  type WeeklyPlanningTurnSideEffectServices,
} from './weeklyPlanningTurnSideEffects';

const pending: WeeklyPlanningPendingTurn = {
  conversationId: 'conversation-1',
  turnId: 'conversation-1:turn:2',
  requestId: 'conversation-1:request:2',
  weekStartDate: '2026-07-27',
  baseRevision: 3,
  startedAt: '2026-07-24T10:00:00.000Z',
};

function createServices(overrides: Partial<WeeklyPlanningTurnSideEffectServices> = {}) {
  const graph = {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 4,
    planningWindows: [{
      id: 'window-1',
      start: '2026-07-27',
      end: '2026-08-02',
    } as never],
    tasks: [{} as never, {} as never],
    workloads: [{} as never],
    availabilityDeclarations: [{} as never],
    factLifecycles: [
      { factId: 'window-1', status: 'active' } as never,
      { factId: 'task-1', status: 'active' } as never,
      { factId: 'task-old', status: 'retracted' } as never,
    ],
  };
  return {
    isStableV5Enabled: vi.fn(() => true),
    hasStagedGraph: vi.fn(() => true),
    finalizeRuntimeGraph: vi.fn(),
    discardStagedGraph: vi.fn(),
    getRuntimeSession: vi.fn(() => ({
      ownerId: 'user-1',
      weekStartDate: '2026-07-27',
      conversationId: 'conversation-1',
      graph,
      updatedAt: Date.parse('2026-07-24T10:00:00.000Z'),
    })),
    recordTurnTrace: vi.fn(async () => undefined),
    ...overrides,
  } as WeeklyPlanningTurnSideEffectServices;
}

describe('weeklyPlanningTurnSideEffects', () => {
  it('does nothing when Stable V5 is disabled', async () => {
    const services = createServices({ isStableV5Enabled: vi.fn(() => false) });

    finalizeWeeklyPlanningApplicationTurn({ ownerId: 'user-1', pending }, services);
    discardWeeklyPlanningApplicationTurn(pending, services);
    const trace = recordCommittedWeeklyPlanningApplicationTurn({
      ownerId: 'user-1',
      pending,
      userText: '予定を作りたい',
      result: {
        state: createInitialPlanningIntakeState(),
        message: '確認しました。',
        draftCandidates: [],
      },
    }, services);

    expect(trace).toBeNull();
    expect(services.hasStagedGraph).not.toHaveBeenCalled();
    expect(services.finalizeRuntimeGraph).not.toHaveBeenCalled();
    expect(services.discardStagedGraph).not.toHaveBeenCalled();
    expect(services.recordTurnTrace).not.toHaveBeenCalled();
  });

  it('finalizes only an existing staged graph and discards by conversation and request', () => {
    const services = createServices();

    finalizeWeeklyPlanningApplicationTurn({ ownerId: 'user-1', pending }, services);
    discardWeeklyPlanningApplicationTurn(pending, services);

    expect(services.hasStagedGraph).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      requestId: 'conversation-1:request:2',
    });
    expect(services.finalizeRuntimeGraph).toHaveBeenCalledWith({
      ownerId: 'user-1',
      conversationId: 'conversation-1',
      requestId: 'conversation-1:request:2',
    });
    expect(services.discardStagedGraph).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      requestId: 'conversation-1:request:2',
    });
  });

  it('does not finalize when the staged graph is missing', () => {
    const services = createServices({ hasStagedGraph: vi.fn(() => false) });

    finalizeWeeklyPlanningApplicationTurn({ ownerId: 'user-1', pending }, services);

    expect(services.finalizeRuntimeGraph).not.toHaveBeenCalled();
  });

  it('records committed trace from the committed graph summary', async () => {
    const services = createServices();
    const state = {
      ...createInitialPlanningIntakeState(),
      status: 'draft_ready' as const,
    };

    await recordCommittedWeeklyPlanningApplicationTurn({
      ownerId: 'user-1',
      pending,
      userText: 'この条件で作成して',
      result: {
        state,
        message: '仮予定を作成しました。',
        draftCandidates: [{} as never, {} as never],
      },
    }, services);

    expect(services.recordTurnTrace).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      conversationId: 'conversation-1',
      requestId: 'conversation-1:request:2',
      outcome: 'preview_ready',
      graphRevision: 4,
      graphSummary: {
        taskCount: 2,
        workloadCount: 1,
        availabilityCount: 1,
        activeFactCount: 2,
      },
      compatibilityState: state,
      previewCount: 2,
      planningRangeStart: '2026-07-27',
      planningRangeEnd: '2026-08-02',
    }));
  });

  it('records failed trace without compatibility state or preview', async () => {
    const services = createServices();
    const error = new TypeError('invalid response');

    await recordFailedWeeklyPlanningApplicationTurn({
      ownerId: 'user-1',
      pending,
      userText: '続けて',
      error,
      assistantMessage: {
        id: 'conversation-1:turn:2:assistant',
        role: 'assistant',
        content: '更新できませんでした。',
        createdAt: '2026-07-24T10:00:01.000Z',
      },
    }, services);

    expect(services.recordTurnTrace).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'failed',
      previewCount: 0,
      errorCode: 'TypeError',
      assistantMessage: '更新できませんでした。',
    }));
  });
});
