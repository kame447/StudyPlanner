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

  it('retries one identical repeated question and keeps the repaired output AI-rendered', async () => {
    const previousQuestion = '夏合宿のスライドについて、何を決めたいですか？';
    const renderInput = input({
      actionId: 'stable-v5:request-clarify:missing_schedulable_work',
      currentUserMessage: 'その質問は何を確認したいの？',
      recentConversation: [
        { role: 'user', content: '夏合宿のスライドを終わらせたい' },
        { role: 'assistant', content: previousQuestion },
      ],
      planningInformation: {
        tasks: [{ id: 'task-slides', title: '夏合宿のスライド', category: 'study' }],
      },
      actionKind: 'question',
      questionCode: 'missing_schedulable_work',
      questionTarget: {
        collection: 'tasks',
        fact: { id: 'task-slides', title: '夏合宿のスライド', category: 'study' },
      },
      questionIntent: {
        kind: 'schedulable_work_detail',
        mode: 'existing_target_progress',
        targetFactId: 'task-slides',
        progressBasis: 'completion_progress_without_known_unit',
        knownUnitCode: null,
        knownUnitLabel: null,
        requestedInformation: ['current_progress'],
      },
      requiredLabels: ['夏合宿のスライド'],
      fallbackText: '夏合宿のスライドは、完成までを100%とすると今どのくらい進んでいますか？',
    });
    const createChatCompletion = vi.fn()
      .mockResolvedValueOnce(response(renderInput, previousQuestion))
      .mockResolvedValueOnce(response(
        renderInput,
        '予定に入れるために今の進み具合を知りたいです。完成を100%とすると、今はだいたい何%くらいまで進んでいますか？',
      ));
    const client: OpenAiCompatibleClient = { createChatCompletion };

    await expect(
      createAiWeeklyPlanningStableV5DialogueRenderer(config, client).render(renderInput),
    ).resolves.toMatchObject({
      status: 'rendered',
      text: expect.stringContaining('100%'),
    });
    expect(createChatCompletion).toHaveBeenCalledTimes(2);
    expect(createChatCompletion.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('直前と異なる自然な表現'),
        }),
      ]),
    }));
  });

  it('falls back if the one repair attempt still repeats the same assistant question', async () => {
    const previousQuestion = 'この範囲は今回進めたい量ですか？';
    const renderInput = input({
      currentUserMessage: '質問の意味を教えて',
      recentConversation: [{ role: 'assistant', content: previousQuestion }],
    });
    const createChatCompletion = vi.fn(async () => response(renderInput, previousQuestion));

    await expect(
      createAiWeeklyPlanningStableV5DialogueRenderer(
        config,
        { createChatCompletion },
      ).render(renderInput),
    ).resolves.toMatchObject({
      status: 'fallback',
      reason: 'repeated_question_text',
    });
    expect(createChatCompletion).toHaveBeenCalledTimes(2);
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
