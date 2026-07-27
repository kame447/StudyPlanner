import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
} from '../semantic/weeklyPlanningFactGraphV5';
import {
  resetWeeklyPlanningStableV5DebugTraceForTest,
  takeWeeklyPlanningStableV5DebugTrace,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import {
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

function input(requestId: string) {
  return {
    previousState: undefined,
    messages: [],
    userText: '今日の予定を作って',
    selectedDate: '2026-07-27',
    userId: 'owner-1',
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

describe('Stable V5 instrumented runtime duplicate guard', () => {
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
      graph: {
        ...createEmptyWeeklyPlanningFactGraphV5(),
        revision: 1,
        appliedTurnKeys: ['conversation-1:request-1'],
      },
    });

    const result = await executeWeeklyPlanningStableV5RuntimeTurn(input('request-1'));

    expect(coreExecutorMock).not.toHaveBeenCalled();
    expect(result.draftCandidates).toEqual([]);
    expect(result.state.shouldCreateDraft).toBe(false);
    expect(result.message).toContain('予定を重複して作成しませんでした');
    expect(takeWeeklyPlanningStableV5DebugTrace('request-1')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: 'runtime_duplicate_turn_suppressed',
          data: expect.objectContaining({
            coreExecutorInvoked: false,
            previewCandidateCount: 0,
          }),
        }),
      ]),
    );
  });

  it('delegates a new request even when the conversation already has committed turns', async () => {
    hydrateWeeklyPlanningStableV5RuntimeSession({
      ownerId: 'owner-1',
      weekStartDate: '2026-07-27',
      conversationId: 'conversation-1',
      graph: {
        ...createEmptyWeeklyPlanningFactGraphV5(),
        revision: 1,
        appliedTurnKeys: ['conversation-1:request-1'],
      },
    });

    const result = await executeWeeklyPlanningStableV5RuntimeTurn(input('request-2'));

    expect(coreExecutorMock).toHaveBeenCalledTimes(1);
    expect(coreExecutorMock).toHaveBeenCalledWith(input('request-2'));
    expect(result).toEqual(coreResult());
  });
});
