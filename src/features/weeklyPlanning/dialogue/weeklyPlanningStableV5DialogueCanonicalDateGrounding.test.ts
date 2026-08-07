import { describe, expect, it, vi } from 'vitest';
import type { AiConfig } from '../../../lib/aiConfig';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
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

function input(
  planningInformation: Record<string, unknown>,
): WeeklyPlanningStableV5DialogueRenderInput {
  return {
    actionId: 'stable-v5:request-1:missing_schedulable_work',
    currentUserMessage: '次の日の勉強計画を立てたいです',
    recentConversation: [],
    planningInformation,
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

describe('Stable V5 renderer canonical date grounding', () => {
  it('accepts a natural Japanese date label derived from a canonical relative fact', async () => {
    const renderInput = input({
      planningWindows: [
        { kind: 'relative_day', value: 'tomorrow', start: null, end: null },
      ],
      tasks: [],
    });
    const text = '明日の勉強計画を作るために、入れたい作業内容と、どれくらい進めたいかを教えてください。';
    const renderer = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(renderInput, text),
    );

    await expect(renderer.render(renderInput)).resolves.toMatchObject({
      status: 'rendered',
      text,
    });
  });

  it('accepts a localized absolute date derived from a canonical calendar fact', async () => {
    const renderInput = input({
      planningWindows: [
        {
          kind: 'absolute',
          value: '2026-08-04',
          start: '2026-08-04',
          end: '2026-08-04',
        },
      ],
      tasks: [],
    });
    const text = '8月4日の予定に入れたい作業と量を教えてください。';
    const renderer = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(renderInput, text),
    );

    await expect(renderer.render(renderInput)).resolves.toMatchObject({
      status: 'rendered',
      text,
    });
  });

  it('still rejects a date label not supported by the canonical facts', async () => {
    const renderInput = input({
      planningWindows: [
        { kind: 'relative_day', value: 'tomorrow', start: null, end: null },
      ],
      tasks: [],
    });
    const renderer = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(
        renderInput,
        '明後日の予定に入れたい作業と量を教えてください。',
      ),
    );

    await expect(renderer.render(renderInput)).resolves.toMatchObject({
      status: 'fallback',
      reason: 'ungrounded_text',
    });
  });
});
