import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
} from '../semantic/weeklyPlanningFactGraphV5';
import {
  resetWeeklyPlanningStableV5DebugTraceForTest,
  takeWeeklyPlanningStableV5DebugTrace,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import {
  commitWeeklyPlanningStableV5RuntimeGraph,
  getWeeklyPlanningStableV5RuntimeSession,
  hydrateWeeklyPlanningStableV5RuntimeSession,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from './weeklyPlanningStableV5RuntimeSession';

const { coreExecutorMock } = vi.hoisted(() => ({
  coreExecutorMock: vi.fn(),
}));

vi.mock('./weeklyPlanningStableV5RuntimeExecutor', () => ({
  executeWeeklyPlanningStableV5RuntimeTurn: coreExecutorMock,
}));

import {
  executeWeeklyPlanningStableV5RuntimeTurn,
} from './weeklyPlanningStableV5InstrumentedRuntimeExecutor';

function input(requestId: string, userId = 'owner-1') {
  return {
    previousState: undefined,
    messages: [],
    userText: '今日の予定を作って',
    selectedDate: '2026-07-27',
    userId,
    plans: [],
    scheduleTemplates: [],
    conversationId: 'conversation-1',
    traceRequestId: requestId,
  };
}

function coreResult() {
  return {
    state: {
      status: 'idle' as const,
      intent: 'weekly_study_planning' as const,
      tasks: [],
      progress: [],
      unitRates: [],
      constraints: [],
      priorityPolicy: { kind: 'unknown' as const },
      missing: [],
      assumptions: [],
      uncertainties: [],
      questions: [],
      shouldCreateDraft: false,
      shouldSavePlan: false,
      draftGenerationIntent: 'not_requested' as const,
      sourceTurns: [],
    },
    message: '新しいturnを処理しました。',
    draftCandidates: [],
  };
}

function graph(revision: number, appliedTurnKeys: string[]) {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision,
    appliedTurnKeys,
  };
}

describe('Stable V5 instrumented runtime result projection', () => {
  beforeEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    resetWeeklyPlanningStableV5DebugTraceForTest();
    coreExecutorMock.mockReset();
    coreExecutorMock.mockResolvedValue(coreResult());
  });

  it('does not invoke semantic or preview execution for a committed duplicate request', async () => {
    hydrateWeeklyPlanningStableV5RuntimeSession({
      ownerId: 'owner-1',
      weekStartDate: '2026-07-27',
      conversationId: 'conversation-1',
      graph: graph(1, ['conversation-1:request-1']),
    });

    const result = await executeWeeklyPlanningStableV5RuntimeTurn(input('request-1'));
    const trace = takeWeeklyPlanningStableV5DebugTrace('request-1');

    expect(coreExecutorMock).not.toHaveBeenCalled();
    expect(result.draftCandidates).toEqual([]);
    expect(result.state.shouldCreateDraft).toBe(false);
    expect(result.message).toContain('予定を重複して作成しませんでした');
    expect(result.stableV5Graph).toMatchObject({
      revision: 1,
      appliedTurnKeys: ['conversation-1:request-1'],
    });
    expect(trace).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: 'runtime_duplicate_turn_suppressed',
        data: expect.objectContaining({
          coreExecutorInvoked: false,
          previewCandidateCount: 0,
        }),
      }),
      expect.objectContaining({
        stage: 'runtime_turn_output',
        data: expect.objectContaining({
          finalDecision: expect.objectContaining({ graphRevision: 1 }),
        }),
      }),
    ]));
  });

  it('projects the exact current-turn staged graph before application finalization', async () => {
    hydrateWeeklyPlanningStableV5RuntimeSession({
      ownerId: 'owner-1',
      weekStartDate: '2026-07-27',
      conversationId: 'conversation-1',
      graph: graph(0, []),
    });
    coreExecutorMock.mockImplementationOnce(async () => {
      commitWeeklyPlanningStableV5RuntimeGraph({
        ownerId: 'owner-1',
        conversationId: 'conversation-1',
        graph: graph(1, ['conversation-1:request-1']),
      });
      return coreResult();
    });

    const result = await executeWeeklyPlanningStableV5RuntimeTurn(input('request-1'));

    expect(result.stableV5Graph).toMatchObject({
      revision: 1,
      appliedTurnKeys: ['conversation-1:request-1'],
    });
    expect(getWeeklyPlanningStableV5RuntimeSession('conversation-1')?.graph).toMatchObject({
      revision: 0,
      appliedTurnKeys: [],
    });
    expect(takeWeeklyPlanningStableV5DebugTrace('request-1')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: 'runtime_turn_output',
          data: expect.objectContaining({
            finalDecision: expect.objectContaining({ graphRevision: 1 }),
          }),
        }),
      ]),
    );
  });

  it('projects a newer committed session graph over a stale core result', async () => {
    hydrateWeeklyPlanningStableV5RuntimeSession({
      ownerId: 'owner-1',
      weekStartDate: '2026-07-27',
      conversationId: 'conversation-1',
      graph: graph(1, ['conversation-1:request-1']),
    });
    coreExecutorMock.mockImplementationOnce(async () => {
      hydrateWeeklyPlanningStableV5RuntimeSession({
        ownerId: 'owner-1',
        weekStartDate: '2026-07-27',
        conversationId: 'conversation-1',
        graph: graph(2, [
          'conversation-1:request-1',
          'conversation-1:request-2',
        ]),
      });
      return {
        ...coreResult(),
        stableV5Graph: graph(1, ['conversation-1:request-1']),
      };
    });

    const result = await executeWeeklyPlanningStableV5RuntimeTurn(input('request-2'));

    expect(coreExecutorMock).toHaveBeenCalledTimes(1);
    expect(coreExecutorMock).toHaveBeenCalledWith(input('request-2'));
    expect(result).toMatchObject(coreResult());
    expect(result.stableV5Graph).toMatchObject({
      revision: 2,
      appliedTurnKeys: [
        'conversation-1:request-1',
        'conversation-1:request-2',
      ],
    });
  });

  it('keeps a fresher core graph while the bound session commit is still behind', async () => {
    hydrateWeeklyPlanningStableV5RuntimeSession({
      ownerId: 'owner-1',
      weekStartDate: '2026-07-27',
      conversationId: 'conversation-1',
      graph: graph(0, []),
    });
    coreExecutorMock.mockResolvedValueOnce({
      ...coreResult(),
      stableV5Graph: graph(1, ['conversation-1:request-1']),
    });

    const result = await executeWeeklyPlanningStableV5RuntimeTurn(input('request-1'));

    expect(result.stableV5Graph).toMatchObject({
      revision: 1,
      appliedTurnKeys: ['conversation-1:request-1'],
    });
  });

  it('does not expose another owner runtime graph when the core result has none', async () => {
    hydrateWeeklyPlanningStableV5RuntimeSession({
      ownerId: 'owner-1',
      weekStartDate: '2026-07-27',
      conversationId: 'conversation-1',
      graph: graph(1, ['conversation-1:request-1']),
    });

    const result = await executeWeeklyPlanningStableV5RuntimeTurn(
      input('request-2', 'owner-2'),
    );

    expect(coreExecutorMock).toHaveBeenCalledTimes(1);
    expect(result.stableV5Graph).toBeUndefined();
  });
});
