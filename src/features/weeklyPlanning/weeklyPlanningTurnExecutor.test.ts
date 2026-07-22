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
const runAiPipelineMock = vi.hoisted(() => vi.fn());
const renderExamDialogueMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/aiConfig', () => ({
  getAiConfig: () => aiConfigState.current,
  getAiConfigValidationMessage: () => undefined,
}));

vi.mock('./pipeline/weeklyPlanningBehaviorAwareIntakePipeline', () => ({
  runWeeklyPlanningBehaviorAwarePipelineWithInterpreter: runAiPipelineMock,
}));

vi.mock('./dialogue/weeklyPlanningAiDialogueRenderer', () => ({
  createAiWeeklyPlanningDialogueRenderer: () => ({ render: vi.fn() }),
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
    runAiPipelineMock.mockReset();
    runAiPipelineMock.mockResolvedValue(pipelineOutput());
    renderExamDialogueMock.mockReset();
    renderExamDialogueMock.mockResolvedValue('院試向け通常応答');
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

});
