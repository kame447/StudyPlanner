import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialPlanningIntakeState } from './intake/weeklyPlanningIntakeReducer';

const {
  executeRuntimeMock,
  takeFailureMock,
  recordTraceMock,
  renderDialogueMock,
} = vi.hoisted(() => ({
  executeRuntimeMock: vi.fn(),
  takeFailureMock: vi.fn(),
  recordTraceMock: vi.fn(),
  renderDialogueMock: vi.fn(),
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

vi.mock('./dialogue/weeklyPlanningStableV5AiDialogueRenderer', () => ({
  createAiWeeklyPlanningStableV5DialogueRenderer: () => ({
    render: renderDialogueMock,
  }),
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
      lastQuestionContext: {
        kind: 'missing' as const,
        targetSlot: 'stable_v5:semantic_uncertainty',
        intent: 'semantic_uncertainty',
      },
      shouldCreateDraft: false,
      draftGenerationIntent: 'user_authorized' as const,
    },
    message: '確認してください。',
    draftCandidates: [],
  };
}

function renderedRuntimeResult() {
  return {
    ...runtimeResult(),
    responseSource: 'deterministic_fallback' as const,
    dialogueRendererTrace: {
      actionId: 'stable-v5:conversation-1:request:4:semantic_uncertainty',
      actionKind: 'question' as const,
      questionCode: 'semantic_uncertainty',
      request: {
        purpose: 'weekly_planning_renderer' as const,
        requiredLabels: [],
        fallbackText: '確認してください。',
        previewCount: 0,
      },
      response: {
        status: 'fallback' as const,
        reason: 'provider_error',
        rawResponse: null,
        renderedText: null,
      },
      decision: {
        branch: 'deterministic_fallback' as const,
        responseSource: 'deterministic_fallback' as const,
        finalMessage: '確認してください。',
      },
    },
  };
}

describe('weeklyPlanningTurnExecutor Stable V5 trace projection', () => {
  beforeEach(() => {
    executeRuntimeMock.mockReset();
    takeFailureMock.mockReset();
    recordTraceMock.mockReset();
    renderDialogueMock.mockReset();
    executeRuntimeMock.mockResolvedValue(runtimeResult());
    renderDialogueMock.mockResolvedValue({
      status: 'fallback',
      reason: 'provider_error',
      rawResponse: null,
    });
  });

  it('records the no-failure projection branch', async () => {
    takeFailureMock
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null);

    const result = await executeWeeklyPlanningTurn(input());

    expect(result).toEqual(renderedRuntimeResult());
    expect(recordTraceMock).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'conversation-1:request:4',
      stage: 'turn_executor_result_projected',
      data: expect.objectContaining({
        branch: 'no_recorded_failure',
        projectedResult: renderedRuntimeResult(),
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
      dialogueRendererTrace: {
        request: null,
        response: { status: 'bypassed', reason: 'system_message' },
        decision: { branch: 'system_message_bypass', responseSource: 'system' },
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
