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
      groundingRecords: [{
        targetFactId: 'window-1',
        interpretationKind: 'relative_date_resolution',
        status: 'proposed',
        sourceExpression: '来週',
        startDate: '2026-08-17',
        endDate: '2026-08-23',
      }],
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
    createChatCompletion: vi.fn(async request => JSON.stringify({
      actionId: JSON.parse(request.messages[1].content).actionId,
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
    expect(payload.planningStateSummary).toEqual(expect.objectContaining({
      groundingContext: [expect.objectContaining({
        status: 'proposed',
        startDate: '2026-08-17',
        endDate: '2026-08-23',
      })],
    }));
    expect(typeof payload.request).toBe('string');
    expect(String(payload.request).length).toBeGreaterThan(0);
  });

  it('validates generated text against grounded facts without prescribing one correct wording', async () => {
    const renderInput = input();
    const grounded = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(
        renderInput,
        '来週は8月17日から8月23日として考えます。予定に入れたい作業を一つ教えてください。',
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
    // legacy_v5 is unchanged: an invented duration is still caught by the clock pattern (「2時」 inside 「2時間」).
    const legacyInput = { ...renderInput, conversationArchitecture: 'legacy_v5' as const };
    await expect(createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(legacyInput, 'たとえば資料作成を2時間、返信を30分のように教えてください。'),
    ).render(legacyInput)).resolves.toMatchObject({
      status: 'fallback',
      reason: 'ungrounded_text',
    });
    // interaction: a real clock time that nothing grounds is still caught; an invented duration is the declared P4
    // re-targeting (a duration is not a clock; amounts become facts only through typed acceptance).
    await expect(createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(renderInput, 'たとえば資料作成を2時に始める、のように教えてください。'),
    ).render(renderInput)).resolves.toMatchObject({
      status: 'fallback',
      reason: 'ungrounded_text',
    });
    await expect(inventedExamples.render(renderInput)).resolves.toMatchObject({ status: 'rendered' });
  });
});
