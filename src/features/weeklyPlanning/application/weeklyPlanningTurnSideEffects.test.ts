import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import {
  beginWeeklyPlanningStableV5DebugTrace,
  peekWeeklyPlanningStableV5DebugTraceForTest,
  recordWeeklyPlanningStableV5DebugTrace,
  resetWeeklyPlanningStableV5DebugTraceForTest,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import type { WeeklyPlanningPendingTurn } from '../types';
import {
  discardWeeklyPlanningApplicationTurn,
  finalizeWeeklyPlanningApplicationTurn,
  recordCommittedWeeklyPlanningApplicationTurn,
  recordDiscardedWeeklyPlanningApplicationTurn,
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

afterEach(() => {
  resetWeeklyPlanningStableV5DebugTraceForTest();
});

describe('weeklyPlanningTurnSideEffects', () => {
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

  it('records only the committed turn fields needed by the compact trace schema', async () => {
    const services = createServices();

    await recordCommittedWeeklyPlanningApplicationTurn({
      ownerId: 'user-1',
      pending,
      userText: 'この条件で作成して',
      result: {
        state: {
          ...createInitialPlanningIntakeState(),
          status: 'draft_ready' as const,
        },
        message: '仮予定を作成しました。',
        draftCandidates: [{} as never, {} as never],
      },
    }, services);

    expect(services.recordTurnTrace).toHaveBeenCalledWith({
      userId: 'user-1',
      conversationId: 'conversation-1',
      requestId: 'conversation-1:request:2',
      userText: 'この条件で作成して',
      assistantMessage: '仮予定を作成しました。',
      outcome: 'preview_ready',
      debugTraceEvents: [],
      previewCount: 2,
      planningRangeStart: '2026-07-27',
      planningRangeEnd: '2026-08-02',
      errorCode: undefined,
    });
    expect(services.recordTurnTrace).toHaveBeenCalledWith(expect.not.objectContaining({
      graphSummary: expect.anything(),
      compatibilityState: expect.anything(),
    }));
  });

  it('passes ordered debug stages without copying compatibility state', async () => {
    const services = createServices();
    beginWeeklyPlanningStableV5DebugTrace(pending.requestId);
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: pending.requestId,
      stage: 'semantic_provider_request',
      data: {
        request: { messages: [{ role: 'system', content: 'full system message' }] },
      },
    });
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: pending.requestId,
      stage: 'semantic_canonicalization_evaluated',
      data: {
        adoptedOperations: {
          fromRevision: 3,
          toRevision: 4,
          added: [{ kind: 'effort_estimate', id: 'effort-1' }],
        },
      },
    });

    await recordCommittedWeeklyPlanningApplicationTurn({
      ownerId: 'user-1',
      pending,
      userText: '3時間ぐらいかな',
      result: {
        state: {
          ...createInitialPlanningIntakeState(),
          status: 'revision_pending' as const,
        },
        message: '計画期間が複数あります。',
        draftCandidates: [],
      },
    }, services);

    expect(services.recordTurnTrace).toHaveBeenCalledWith(expect.objectContaining({
      debugTraceEvents: [
        expect.objectContaining({ sequence: 0, stage: 'semantic_provider_request' }),
        expect.objectContaining({ sequence: 1, stage: 'semantic_canonicalization_evaluated' }),
      ],
    }));
    expect(services.recordTurnTrace).toHaveBeenCalledWith(expect.not.objectContaining({
      compatibilityState: expect.anything(),
    }));
    expect(peekWeeklyPlanningStableV5DebugTraceForTest(pending.requestId)).toEqual([]);
  });

  it('records controlled execution failure as an error diagnostic with assistant output', async () => {
    const services = createServices();

    await recordCommittedWeeklyPlanningApplicationTurn({
      ownerId: 'user-1',
      pending,
      userText: '続けて',
      result: {
        state: {
          ...createInitialPlanningIntakeState(),
          status: 'revision_pending' as const,
        },
        message: 'AIに接続できませんでした。',
        draftCandidates: [],
        failure: {
          code: 'stable_v5_provider_failure',
          userMessage: 'AIに接続できませんでした。',
          traceCode: 'weekly_planning_provider_failure',
          diagnostics: {
            attemptCount: 1,
            repairAttempted: false,
            validationErrorCategories: [],
            providerErrorCategory: 'provider_error',
          },
        },
      },
    }, services);

    expect(services.recordTurnTrace).toHaveBeenCalledWith(expect.objectContaining({
      assistantMessage: 'AIに接続できませんでした。',
      outcome: 'stable_v5_provider_failure',
      errorCode: 'weekly_planning_provider_failure',
    }));
  });

  it('records and consumes a stale discarded execution without a phantom assistant output', async () => {
    const services = createServices();
    beginWeeklyPlanningStableV5DebugTrace(pending.requestId);
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: pending.requestId,
      stage: 'runtime_branch_selected',
      data: { branch: 'preview_ready' },
    });

    await recordDiscardedWeeklyPlanningApplicationTurn({
      ownerId: 'user-1',
      pending,
      userText: 'この条件で予定を作って',
      result: {
        state: {
          ...createInitialPlanningIntakeState(),
          status: 'draft_ready' as const,
        },
        message: '1件の候補を作りました。',
        draftCandidates: [{} as never],
      },
      reason: 'stale',
    }, services);

    expect(services.recordTurnTrace).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'discarded_stale',
      errorCode: 'stale_async_result_discarded',
      previewCount: 0,
      debugTraceEvents: [
        expect.objectContaining({ stage: 'runtime_branch_selected' }),
      ],
    }));
    expect(services.recordTurnTrace).toHaveBeenCalledWith(expect.not.objectContaining({
      assistantMessage: expect.anything(),
      compatibilityState: expect.anything(),
    }));
    expect(peekWeeklyPlanningStableV5DebugTraceForTest(pending.requestId)).toEqual([]);
  });

  it('records failed trace with assistant output and no application state', async () => {
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
      debugTraceEvents: [],
      previewCount: 0,
      errorCode: 'TypeError',
      assistantMessage: '更新できませんでした。',
    }));
    expect(services.recordTurnTrace).toHaveBeenCalledWith(expect.not.objectContaining({
      compatibilityState: expect.anything(),
    }));
  });
});
