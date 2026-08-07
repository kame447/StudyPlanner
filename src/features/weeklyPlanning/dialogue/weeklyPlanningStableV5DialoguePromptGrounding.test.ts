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

describe('Stable V5 dialogue prompt grounding contract', () => {
  it('states the no-invention invariant once and avoids raw state duplication', () => {
    const prompt = createWeeklyPlanningStableV5DialoguePrompt(input());
    const payload = JSON.parse(prompt.userPrompt) as Record<string, unknown>;
    const combined = `${prompt.systemPrompt}\n${prompt.userPrompt}`;

    expect(prompt.systemPrompt).toContain(
      '入力にない具体情報は、例としても補わないでください',
    );
    expect(combined.match(/入力にない/g)).toHaveLength(1);
    expect(payload).not.toHaveProperty('planningInformation');
    expect(payload).toHaveProperty('planningStateSummary');
    expect(prompt.userPrompt).not.toContain('仮の作業名');
    expect(prompt.userPrompt).not.toContain('仮の数量');
  });

  it('accepts a grounded abstract question and still rejects invented examples', async () => {
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
