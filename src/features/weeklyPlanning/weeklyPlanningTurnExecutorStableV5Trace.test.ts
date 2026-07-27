import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialPlanningIntakeState } from './intake/weeklyPlanningIntakeReducer';

const {
  executeRuntimeMock,
  takeFailureMock,
  recordTraceMock,
} = vi.hoisted(() => ({
  executeRuntimeMock: vi.fn(),
  takeFailureMock: vi.fn(),
  recordTraceMock: vi.fn(),
}));

vi.mock('./application/weeklyPlanningRuntimeMode', () => ({
  isWeeklyPlanningStableV5RuntimeEnabled: () => true,
}));

vi.mock('./application/weeklyPlanningStableV5InstrumentedRuntimeExecutor', () => ({
  executeWeeklyPlanningStableV5RuntimeTurn: executeRuntimeMock,
}));

vi.mock('./semantic/weeklyPlanningStableV5FailureDiagnostics', () => ({
  takeWeeklyPlanningStableV5FailureDiagnostics: takeFailureMock,
}));

vi.mock('./trace/weeklyPlanningStableV5DebugTrace', () => ({
  recordWeeklyPlanningStableV5DebugTrace: recordTraceMock,
}));

import { executeWeeklyPlanningTurn } from './weeklyPlanningTurnExecutor';

function input() {
  return {
    previousState: undefined,
    messages: [],
    userText: '今回使う期間とは？',
    selectedDate: '2026-07-27',
    userId: 'owner-1',
    plans: [],
    scheduleTemplates: [],
    conversationId: 'conversation-1',
    traceRequestId: 'conversation-1:request:4',
  };
}

function runtimeResult() {
  return {
    state: {
      ...createInitialPlanningIntakeState(),
      status: 'revision_pending' as const,
      questions: ['確認してください。'],
      shouldCreateDraft: false,
      draftGenerationIntent: 'user_authorized' as const,
    },
    message: '確認してください。',
    draftCandidates: [],
  };
}

describe('weeklyPlanningTurnExecutor Stable V5 trace projection', () => {
  beforeEach(() => {
    executeRuntimeMock.mockReset();
    takeFailureMock.mockReset();
    recordTraceMock.mockReset();
    executeRuntimeMock.mockResolvedValue(runtimeResult());
  });

  it('records the no-failure projection branch', async () => {
    takeFailureMock
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null);

    const result = await executeWeeklyPlanningTurn(input());

    expect(result).toEqual(runtimeResult());
    expect(recordTraceMock).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'conversation-1:request:4',
      stage: 'turn_executor_result_projected',
      data: expect.objectContaining({
        branch: 'no_recorded_failure',
        result: runtimeResult(),
      }),
    }));
  });

  it('records the failure projection and the state fields it clears', async () => {
    takeFailureMock
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({
        status: 'canonicalization_rejected',
        traceCode: 'validation=invalid_reference',
        attemptCount: 2,
        repairAttempted: true,
        validationErrorCategories: ['invalid_reference'],
        providerErrorCategory: null,
      });

    const result = await executeWeeklyPlanningTurn(input());

    expect(result).toMatchObject({
      state: {
        status: 'revision_pending',
        questions: [],
        shouldCreateDraft: false,
        draftGenerationIntent: 'not_requested',
      },
      failure: {
        code: 'stable_v5_canonicalization_rejected',
        traceCode: 'validation=invalid_reference',
      },
    });
    expect(recordTraceMock).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'conversation-1:request:4',
      stage: 'turn_executor_result_projected',
      severity: 'error',
      data: expect.objectContaining({
        branch: 'recorded_failure_projected',
        criteria: expect.objectContaining({
          questionsCleared: true,
          draftAuthorizationCleared: true,
        }),
        projectedResult: result,
      }),
    }));
  });
});
