import { describe, expect, it, vi } from 'vitest';
import type { AiConfig } from '../../../lib/aiConfig';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  createAiWeeklyPlanningStableV5DialogueRenderer,
  WEEKLY_PLANNING_STABLE_V5_DIALOGUE_RENDERER_RESPONSE_FORMAT,
  type WeeklyPlanningStableV5DialogueRenderInput,
} from './weeklyPlanningStableV5AiDialogueRenderer';

const config: AiConfig = {
  provider: 'openai',
  baseUrl: 'https://example.test/v1',
  model: 'configured-model',
  apiKey: 'test-key',
};

function input(
  overrides: Partial<WeeklyPlanningStableV5DialogueRenderInput> = {},
): WeeklyPlanningStableV5DialogueRenderInput {
  return {
    actionId: 'stable-v5:request-1:missing_effort_estimate',
    currentUserMessage: '30分くらい',
    recentConversation: [],
    planningInformation: { tasks: [{ title: '英単語' }] },
    actionKind: 'question',
    questionCode: 'missing_effort_estimate',
    requiredLabels: ['英単語'],
    fallbackText: '英単語は1回分にどれくらい時間がかかりますか？',
    previewCount: 0,
    ...overrides,
  };
}

function response(renderInput: WeeklyPlanningStableV5DialogueRenderInput, text: string): string {
  return JSON.stringify({
    actionId: renderInput.actionId,
    actionKind: renderInput.actionKind,
    questionCode: renderInput.questionCode,
    text,
  });
}

describe('Stable V5 AI dialogue renderer adapter', () => {
  it('sends one structured rendering request when the caller chooses the AI route', async () => {
    const renderInput = input();
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => response(
        renderInput,
        '英単語は1回分にどれくらい時間がかかりそうですか？',
      )),
    };
    const renderer = createAiWeeklyPlanningStableV5DialogueRenderer(config, client);

    await expect(renderer.render(renderInput)).resolves.toMatchObject({
      status: 'rendered',
      text: '英単語は1回分にどれくらい時間がかかりそうですか？',
    });
    expect(client.createChatCompletion).toHaveBeenCalledTimes(1);
    expect(client.createChatCompletion).toHaveBeenCalledWith(expect.objectContaining({
      temperature: 0.4,
      responseFormat: WEEKLY_PLANNING_STABLE_V5_DIALOGUE_RENDERER_RESPONSE_FORMAT,
      purpose: 'weekly_planning_renderer',
    }));
  });

  it('does not own deterministic-vs-AI routing', async () => {
    const renderInput = input();
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => response(
        renderInput,
        '英単語は1回分にどれくらい時間がかかりそうですか？',
      )),
    };

    await expect(
      createAiWeeklyPlanningStableV5DialogueRenderer(config, client).render(renderInput),
    ).resolves.toMatchObject({ status: 'rendered' });
    expect(client.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('maps provider failures to a renderer fallback without changing the application decision', async () => {
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => {
        throw new Error('network failure');
      }),
    };

    await expect(
      createAiWeeklyPlanningStableV5DialogueRenderer(config, client).render(input()),
    ).resolves.toEqual({
      status: 'fallback',
      reason: 'provider_error',
      rawResponse: null,
    });
  });
});
