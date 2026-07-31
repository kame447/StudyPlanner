import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiConfig } from '../../../lib/aiConfig';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  boundWeeklyPlanningDialogueRendererTraceForTransport,
  resetWeeklyPlanningDialogueRendererPromptContextsForTest,
  type WeeklyPlanningDialogueRendererTrace,
} from '../trace/weeklyPlanningDialogueRendererTrace';
import {
  createAiWeeklyPlanningStableV5DialogueRenderer,
  type WeeklyPlanningStableV5DialogueRenderInput,
} from './weeklyPlanningStableV5AiDialogueRenderer';

const config: AiConfig = {
  provider: 'openai',
  baseUrl: 'https://example.test/v1',
  model: 'configured-model',
  apiKey: 'test-key',
};

const renderInput: WeeklyPlanningStableV5DialogueRenderInput = {
  actionId: 'stable-v5:trace-contract:quantity_role_unresolved',
  currentUserMessage: 'どういうこと？',
  recentConversation: [
    { role: 'user', content: '院試は2分野それぞれ3時間やりたい' },
    {
      role: 'assistant',
      content: '第2分野の3時間は、今回進める量ですか、それとも残っている全体量ですか？',
    },
  ],
  planningInformation: {
    revision: 4,
    tasks: [{ id: 'task-1', category: 'study', title: '院試' }],
    workloads: [{
      taskId: 'task-1',
      quantityRole: 'unknown',
      amount: 3,
      unitLabel: '時間',
    }],
    uncertainties: [{
      targetFactId: 'workload-1',
      field: 'quantityRole',
      reason: '今回進める量か残っている全体量か不明',
    }],
  },
  actionKind: 'question',
  questionCode: 'quantity_role_unresolved',
  requiredLabels: ['院試', '第2分野'],
  fallbackText: '第2分野の3時間は、今回進める量ですか、それとも残っている全体量ですか？',
  previewCount: 0,
};

function rendererTrace(): WeeklyPlanningDialogueRendererTrace {
  return {
    actionId: renderInput.actionId,
    actionKind: renderInput.actionKind,
    questionCode: renderInput.questionCode,
    request: {
      purpose: 'weekly_planning_renderer',
      requiredLabels: [...renderInput.requiredLabels],
      fallbackText: renderInput.fallbackText,
      previewCount: renderInput.previewCount,
    },
    response: {
      status: 'rendered',
      reason: null,
      rawResponse: JSON.stringify({
        actionId: renderInput.actionId,
        text: '3時間が今回進める量なのか、残り全体なのかを確認しています。',
      }),
      renderedText: '3時間が今回進める量なのか、残り全体なのかを確認しています。',
    },
    decision: {
      branch: 'ai_rendered',
      responseSource: 'ai',
      finalMessage: '3時間が今回進める量なのか、残り全体なのかを確認しています。',
    },
  };
}

afterEach(() => {
  resetWeeklyPlanningDialogueRendererPromptContextsForTest();
});

describe('Stable V5 renderer prompt trace', () => {
  it('captures the exact messages sent to the renderer and attaches them at the trace boundary', async () => {
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => JSON.stringify({
        actionId: renderInput.actionId,
        text: '3時間が今回進める量なのか、残り全体なのかを確認しています。',
      })),
    };
    const renderer = createAiWeeklyPlanningStableV5DialogueRenderer(config, client);

    await renderer.render(renderInput);
    const actualRequest = vi.mocked(client.createChatCompletion).mock.calls[0][0];
    const bounded = boundWeeklyPlanningDialogueRendererTraceForTransport(rendererTrace());
    const promptContext = bounded.request?.promptContext as {
      messages: Array<{ role: string; content: string }>;
      requestBytes: number;
    };

    expect(promptContext.messages).toEqual(actualRequest.messages);
    expect(promptContext.requestBytes).toBeGreaterThan(0);
    const userPayload = JSON.parse(promptContext.messages[1].content) as Record<string, unknown>;
    expect(userPayload).toMatchObject({
      currentUserMessage: 'どういうこと？',
      recentConversation: renderInput.recentConversation,
      planningInformation: renderInput.planningInformation,
      planningStateSummary: {
        decidedFacts: expect.any(Object),
        undecidedItems: expect.any(Array),
        currentQuestion: {
          questionCode: 'quantity_role_unresolved',
        },
      },
    });
  });
});
