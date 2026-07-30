import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialPlanningIntakeState } from './intake/weeklyPlanningIntakeReducer';
import type { WeeklyPlanningBehaviorAwarePipelineOutput } from './pipeline/weeklyPlanningBehaviorAwareIntakePipeline';
import { executeWeeklyPlanningTurn } from './weeklyPlanningTurnExecutor';

const aiConfigState = vi.hoisted(() => ({
  current: {
    provider: 'openai' as 'openai' | 'rules',
    baseUrl: 'https://example.test/v1',
    model: 'configured-model',
    apiKey: 'test-key',
  },
}));
const stableV5RuntimeState = vi.hoisted(() => ({ enabled: false }));
const runAiPipelineMock = vi.hoisted(() => vi.fn());
const renderExamDialogueMock = vi.hoisted(() => vi.fn());
const stableV5RuntimeMock = vi.hoisted(() => vi.fn());
const stableV5RendererMock = vi.hoisted(() => vi.fn());
const takeStableV5FailureMock = vi.hoisted(() => vi.fn());
const recordStableV5DebugTraceMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/aiConfig', () => ({
  getAiConfig: () => aiConfigState.current,
  getAiConfigValidationMessage: () => undefined,
}));

vi.mock('./application/weeklyPlanningRuntimeMode', () => ({
  isWeeklyPlanningStableV5RuntimeEnabled: () => stableV5RuntimeState.enabled,
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

vi.mock('./pipeline/weeklyPlanningBehaviorAwareIntakePipeline', () => ({
  runWeeklyPlanningBehaviorAwarePipelineWithInterpreter: runAiPipelineMock,
}));

vi.mock('./dialogue/weeklyPlanningAiDialogueRenderer', () => ({
  createAiWeeklyPlanningDialogueRenderer: () => ({ render: vi.fn() }),
}));

vi.mock('./dialogue/weeklyPlanningStableV5AiDialogueRenderer', () => ({
  createAiWeeklyPlanningStableV5DialogueRenderer: () => ({ render: stableV5RendererMock }),
}));

vi.mock('./dialogue/weeklyPlanningDialogueRenderer', () => ({
  renderWeeklyPlanningDialogueMessage: renderExamDialogueMock,
}));

function pipelineOutput(): WeeklyPlanningBehaviorAwarePipelineOutput {
  return {
    state: createInitialPlanningIntakeState(),
    behaviorDialogue: { message: '確認しました。' },
    draftCandidates: [],
  } as unknown as WeeklyPlanningBehaviorAwarePipelineOutput;
}

function stableV5QuestionResult() {
  const fallback = '「院試の勉強」の量は、今回進めたい量ですか、それとも残っている全体量ですか？';
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
    stableV5RuntimeState.enabled = false;
    runAiPipelineMock.mockReset();
    runAiPipelineMock.mockResolvedValue(pipelineOutput());
    renderExamDialogueMock.mockReset();
    renderExamDialogueMock.mockResolvedValue('院試向け通常応答');
    stableV5RuntimeMock.mockReset();
    stableV5RendererMock.mockReset();
    takeStableV5FailureMock.mockReset();
    takeStableV5FailureMock.mockReturnValue(null);
    recordStableV5DebugTraceMock.mockReset();
  });

  it('passes the controlled conversationId to the AI-only production pipeline', async () => {
    await executeWeeklyPlanningTurn(input);

    expect(runAiPipelineMock).toHaveBeenCalledTimes(1);
    expect(runAiPipelineMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userText: '来週の予定を立てたい',
        interpreter: expect.objectContaining({ interpretUserTurn: expect.any(Function) }),
      }),
      expect.objectContaining({
        useAiDialoguePlanner: true,
        userId: 'user-1',
        conversationId: 'weekly-conversation-real',
        traceRequestId: 'weekly-conversation-real:request:1',
      }),
    );
  });

  it('fails closed instead of selecting the rules parser provider', async () => {
    aiConfigState.current.provider = 'rules';

    await expect(executeWeeklyPlanningTurn(input)).rejects.toMatchObject({
      name: 'WeeklyPlanningSemanticInterpreterError',
      code: 'interpreter_unavailable',
    });
    expect(runAiPipelineMock).not.toHaveBeenCalled();
  });

  it('keeps the system failure message even when the previous state is an exam flow', async () => {
    const output = pipelineOutput();
    output.state.examPrepScope = {
      examType: '院試',
      fields: ['OS'],
      unitModel: 'year_field_chunk',
      rawText: ['院試のOS'],
    };
    output.interpretationSource = 'ai_interpreter';
    output.interpretationOutcome = 'rejected';
    output.stateMutationSource = 'none';
    output.behaviorDialogue = {
      message: '意味解釈結果を安全に反映できませんでした。',
      response: null,
      source: 'system',
      renderedActionIds: [],
    };
    runAiPipelineMock.mockResolvedValue(output);

    const result = await executeWeeklyPlanningTurn(input);

    expect(result.message).toBe('意味解釈結果を安全に反映できませんでした。');
    expect(renderExamDialogueMock).not.toHaveBeenCalled();
  });

  it('renders a Stable V5 deterministic question with AI while preserving question context', async () => {
    stableV5RuntimeState.enabled = true;
    stableV5RuntimeMock.mockResolvedValue(stableV5QuestionResult());
    stableV5RendererMock.mockResolvedValue({
      status: 'rendered',
      text: '院試の勉強について確認です。今回進めたい量ですか、それとも残っている全体量ですか？',
      rawResponse: '{"actionId":"ok"}',
    });

    const result = await executeWeeklyPlanningTurn(input);

    expect(result.message).toBe(
      '院試の勉強について確認です。今回進めたい量ですか、それとも残っている全体量ですか？',
    );
    expect(result.state.questions).toEqual([result.message]);
    expect(result.state.lastQuestionContext).toEqual({
      kind: 'missing',
      targetSlot: 'stable_v5:quantity_role_unresolved',
      intent: 'quantity_role_unresolved',
    });
    expect(result.responseSource).toBe('ai');
    expect(stableV5RendererMock).toHaveBeenCalledWith(expect.objectContaining({
      actionKind: 'question',
      questionCode: 'quantity_role_unresolved',
      fallbackText: stableV5QuestionResult().message,
      previewCount: 0,
    }));
    expect(recordStableV5DebugTraceMock).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'dialogue_renderer_decision',
      data: expect.objectContaining({ branch: 'ai_rendered', responseSource: 'ai' }),
    }));
  });

  it('keeps the deterministic Stable V5 text when renderer validation or provider access fails', async () => {
    stableV5RuntimeState.enabled = true;
    stableV5RuntimeMock.mockResolvedValue(stableV5QuestionResult());
    stableV5RendererMock.mockResolvedValue({
      status: 'fallback',
      reason: 'provider_error',
      rawResponse: null,
    });

    const result = await executeWeeklyPlanningTurn(input);

    expect(result.message).toBe(stableV5QuestionResult().message);
    expect(result.state.questions).toEqual([stableV5QuestionResult().message]);
    expect(result.responseSource).toBe('deterministic_fallback');
  });

  it('does not send Stable V5 system and normalization failure messages to the dialogue renderer', async () => {
    stableV5RuntimeState.enabled = true;
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
    expect(stableV5RendererMock).not.toHaveBeenCalled();
  });
});
