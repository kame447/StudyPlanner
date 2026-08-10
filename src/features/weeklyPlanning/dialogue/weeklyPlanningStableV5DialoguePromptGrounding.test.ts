import { describe, expect, it, vi } from 'vitest';
import type { AiConfig } from '../../../lib/aiConfig';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  createAiWeeklyPlanningStableV5DialogueRenderer,
  createWeeklyPlanningStableV5DialoguePrompt,
  type WeeklyPlanningStableV5DialogueRenderInput,
} from './weeklyPlanningStableV5AiDialogueRenderer';

const config: AiConfig = {
  provider: 'openai',
  baseUrl: 'https://example.test/v1',
  model: 'configured-model',
  apiKey: 'test-key',
};

function input(): WeeklyPlanningStableV5DialogueRenderInput {
  return {
    actionId: 'stable-v5:request-1:missing_schedulable_work',
    currentUserMessage: '来週のやることをいい感じに組みたいです',
    recentConversation: [],
    planningInformation: {
      planningWindows: [{ kind: 'relative_week', value: 'next_week' }],
      tasks: [],
    },
    actionKind: 'question',
    questionCode: 'missing_schedulable_work',
    requiredLabels: [],
    fallbackText: '予定に入れる作業量がまだありません。何をどれくらい進めたいか教えてください。',
    previewCount: 0,
  };
}

function clientReturning(
  renderInput: WeeklyPlanningStableV5DialogueRenderInput,
  text: string,
): OpenAiCompatibleClient {
  return {
    createChatCompletion: vi.fn(async () => JSON.stringify({
      actionId: renderInput.actionId,
      actionKind: renderInput.actionKind,
      questionCode: renderInput.questionCode,
      text,
    })),
  };
}

describe('Stable V5 dialogue grounding boundary', () => {
  it('passes summarized state and typed application decisions without exposing the raw planning object', () => {
    const prompt = createWeeklyPlanningStableV5DialoguePrompt(input());
    const payload = JSON.parse(prompt.userPrompt) as Record<string, unknown>;

    expect(payload).not.toHaveProperty('planningInformation');
    expect(payload).toHaveProperty('planningStateSummary');
    expect(payload).toHaveProperty('applicationDecision');
    expect(payload).toHaveProperty('request');
    expect(Array.isArray(payload.request)).toBe(true);
  });

  it('validates generated text against grounded facts without prescribing one correct wording', async () => {
    const renderInput = input();
    const grounded = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(
        renderInput,
        '来週の予定に入れたい作業と、それぞれどれくらい進めたいかを教えてください。',
      ),
    );
    const inventedExamples = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(
        renderInput,
        'たとえば資料作成を2時間、返信を30分のように教えてください。',
      ),
    );

    await expect(grounded.render(renderInput)).resolves.toMatchObject({
      status: 'rendered',
    });
    await expect(inventedExamples.render(renderInput)).resolves.toMatchObject({
      status: 'fallback',
      reason: 'ungrounded_text',
    });
  });
});
