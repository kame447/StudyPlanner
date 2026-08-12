import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialPlanningIntakeState } from './intake/weeklyPlanningIntakeReducer';
import { executeWeeklyPlanningTurn } from './weeklyPlanningTurnExecutor';

const aiConfigState = vi.hoisted(() => ({
  current: {
    provider: 'openai' as 'openai' | 'rules',
    baseUrl: 'https://example.test/v1',
    model: 'configured-model',
    apiKey: 'test-key',
  },
}));
const stableV5RuntimeMock = vi.hoisted(() => vi.fn());
const stableV5RendererMock = vi.hoisted(() => vi.fn());
const takeStableV5FailureMock = vi.hoisted(() => vi.fn());
const recordStableV5DebugTraceMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/aiConfig', () => ({
  getAiConfig: () => aiConfigState.current,
  getAiConfigValidationMessage: () => undefined,
}));

vi.mock('./application/weeklyPlanningStableV5InstrumentedRuntimeExecutor', () => ({
  executeWeeklyPlanningStableV5RuntimeTurn: stableV5RuntimeMock,
}));

vi.mock('./semantic/weeklyPlanningStableV5FailureDiagnostics', () => ({
  takeWeeklyPlanningStableV5FailureDiagnostics: takeStableV5FailureMock,
}));

vi.mock('./trace/weeklyPlanningStableV5DebugTrace', () => ({
  recordWeeklyPlanningStableV5DebugTrace: recordStableV5DebugTraceMock,
}));

vi.mock('./dialogue/weeklyPlanningStableV5AiDialogueRenderer', () => ({
  createAiWeeklyPlanningStableV5DialogueRenderer: () => ({ render: stableV5RendererMock }),
}));

function stableV5QuestionResult() {
  const fallback = '院試の勉強の量は、今回進めたい量ですか、それとも残っている全体量ですか？';
  return {
    state: {
      ...createInitialPlanningIntakeState(),
      status: 'revision_pending' as const,
      questions: [fallback],
      lastQuestionContext: {
        kind: 'missing' as const,
        targetSlot: 'stable_v5:quantity_role_unresolved',
        intent: 'quantity_role_unresolved',
      },
    },
    message: fallback,
    draftCandidates: [],
  };
}

const input = {
  messages: [],
  userText: '来週の予定を立てたい',
  selectedDate: '2026-07-20',
  userId: 'user-1',
  plans: [],
  scheduleTemplates: [],
  conversationId: 'weekly-conversation-real',
  traceRequestId: 'weekly-conversation-real:request:1',
};

describe('executeWeeklyPlanningTurn', () => {
  beforeEach(() => {
    aiConfigState.current.provider = 'openai';
    stableV5RuntimeMock.mockReset();
    stableV5RendererMock.mockReset();
    takeStableV5FailureMock.mockReset();
    takeStableV5FailureMock.mockReturnValue(null);
    recordStableV5DebugTraceMock.mockReset();
  });

  it('keeps a machine-decided question deterministic while preserving question context', async () => {
    stableV5RuntimeMock.mockResolvedValue(stableV5QuestionResult());

    const result = await executeWeeklyPlanningTurn(input);

    expect(result.message).toBe(stableV5QuestionResult().message);
    expect(result.state.questions).toEqual([result.message]);
    expect(result.state.lastQuestionContext).toEqual({
      kind: 'missing',
      targetSlot: 'stable_v5:quantity_role_unresolved',
      intent: 'quantity_role_unresolved',
    });
    expect(result.responseSource).toBe('rules');
    expect(result.dialogueRendererTrace).toMatchObject({
      actionKind: 'question',
      questionCode: 'quantity_role_unresolved',
      request: null,
      response: {
        status: 'bypassed',
        reason: 'deterministic_question',
        rawResponse: null,
        renderedText: null,
      },
      decision: {
        branch: 'deterministic_question_bypass',
        responseSource: 'rules',
        finalMessage: result.message,
      },
    });
    expect(stableV5RendererMock).not.toHaveBeenCalled();
    expect(recordStableV5DebugTraceMock).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'dialogue_renderer_decision',
      data: expect.objectContaining({
        branch: 'deterministic_question_bypass',
        responseSource: 'rules',
      }),
    }));
    expect(recordStableV5DebugTraceMock).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'turn_executor_result_projected',
      data: expect.objectContaining({
        branch: 'no_recorded_failure',
        projectedResult: result,
      }),
    }));
  });

  it('uses the deterministic text if an AI-routed explanation cannot be rendered', async () => {
    stableV5RuntimeMock.mockResolvedValue(stableV5QuestionResult());
    stableV5RendererMock.mockResolvedValue({
      status: 'fallback',
      reason: 'provider_error',
      rawResponse: null,
    });

    const result = await executeWeeklyPlanningTurn({
      ...input,
      userText: 'それってどういう意味？',
    });

    expect(result.message).toBe(stableV5QuestionResult().message);
    expect(result.state.questions).toEqual([stableV5QuestionResult().message]);
    expect(result.responseSource).toBe('deterministic_fallback');
    expect(result.dialogueRendererTrace).toMatchObject({
      request: {
        purpose: 'weekly_planning_renderer',
        fallbackText: stableV5QuestionResult().message,
      },
      response: {
        status: 'fallback',
        reason: 'provider_error',
        rawResponse: null,
        renderedText: null,
      },
      decision: {
        branch: 'deterministic_fallback',
        responseSource: 'deterministic_fallback',
        finalMessage: stableV5QuestionResult().message,
      },
    });
    expect(stableV5RendererMock).toHaveBeenCalledTimes(1);
  });

  it('does not send Stable V5 system and normalization failure messages to the dialogue renderer', async () => {
    stableV5RuntimeMock.mockResolvedValue({
      ...stableV5QuestionResult(),
      message: '入力内容は保持していますが、予定条件の構造化処理に失敗しました。同じ内容をそのままもう一度送ってください。',
      state: {
        ...stableV5QuestionResult().state,
        questions: [],
        lastQuestionContext: undefined,
      },
    });
    takeStableV5FailureMock
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({
        status: 'normalization_rejected',
        traceCode: 'stable_v5_normalization_rejected',
        attemptCount: 2,
        repairAttempted: true,
        validationErrorCategories: ['invalid_reference'],
        providerErrorCategory: null,
      });

    const result = await executeWeeklyPlanningTurn(input);

    expect(result.responseSource).toBe('system');
    expect(result.failure?.code).toBe('stable_v5_normalization_rejected');
    expect(result.dialogueRendererTrace).toMatchObject({
      request: null,
      response: { status: 'bypassed', reason: 'system_message' },
      decision: { branch: 'system_message_bypass', responseSource: 'system' },
    });
    expect(stableV5RendererMock).not.toHaveBeenCalled();
  });
});