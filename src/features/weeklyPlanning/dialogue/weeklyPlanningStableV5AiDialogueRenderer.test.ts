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
    actionId: 'stable-v5:request-1:quantity_role_unresolved',
    actionKind: 'question',
    questionCode: 'quantity_role_unresolved',
    fallbackText: '「院試の勉強」の量は、今回進めたい量ですか、それとも残っている全体量ですか？',
    previewCount: 0,
    ...overrides,
  };
}

function clientReturning(contentOrError: string | Error): OpenAiCompatibleClient {
  return {
    createChatCompletion: vi.fn(async () => {
      if (contentOrError instanceof Error) throw contentOrError;
      return contentOrError;
    }),
  };
}

describe('Stable V5 AI dialogue renderer', () => {
  it('rewrites a deterministic question without changing its action identity or target', async () => {
    const client = clientReturning(JSON.stringify({
      actionId: 'stable-v5:request-1:quantity_role_unresolved',
      text: '院試の勉強について確認です。今回進めたい量ですか、それとも残っている全体量ですか？',
    }));
    const renderer = createAiWeeklyPlanningStableV5DialogueRenderer(config, client);

    await expect(renderer.render(input())).resolves.toEqual({
      status: 'rendered',
      text: '院試の勉強について確認です。今回進めたい量ですか、それとも残っている全体量ですか？',
      rawResponse: expect.any(String),
    });

    expect(client.createChatCompletion).toHaveBeenCalledWith(expect.objectContaining({
      temperature: 0.2,
      responseFormat: WEEKLY_PLANNING_STABLE_V5_DIALOGUE_RENDERER_RESPONSE_FORMAT,
      purpose: 'weekly_planning_renderer',
    }));
    const request = vi.mocked(client.createChatCompletion).mock.calls[0][0];
    const payload = JSON.parse(request.messages[1].content) as Record<string, unknown>;
    expect(payload).toMatchObject({
      actionId: 'stable-v5:request-1:quantity_role_unresolved',
      actionKind: 'question',
      questionCode: 'quantity_role_unresolved',
      previewCount: 0,
    });
    expect(request.messages[1].content).not.toContain('apiKey');
  });

  it('falls back when the model changes the deterministic action identity', async () => {
    const renderer = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(JSON.stringify({
        actionId: 'different-action',
        text: '院試の勉強の量を教えてください。',
      })),
    );

    await expect(renderer.render(input())).resolves.toMatchObject({
      status: 'fallback',
      reason: 'action_mismatch',
    });
  });

  it('falls back when the model omits a quoted task target', async () => {
    const renderer = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(JSON.stringify({
        actionId: 'stable-v5:request-1:quantity_role_unresolved',
        text: '今回進めたい量ですか、それとも残っている全体量ですか？',
      })),
    );

    await expect(renderer.render(input())).resolves.toMatchObject({
      status: 'fallback',
      reason: 'ungrounded_text',
    });
  });

  it('falls back when the model invents a clock time or relative date', async () => {
    const clockRenderer = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(JSON.stringify({
        actionId: 'stable-v5:request-1:quantity_role_unresolved',
        text: '院試の勉強は、明日の20時から進める量ですか、それとも残っている全体量ですか？',
      })),
    );

    await expect(clockRenderer.render(input())).resolves.toMatchObject({
      status: 'fallback',
      reason: 'ungrounded_text',
    });
  });

  it('requires the exact candidate count for a preview-ready response', async () => {
    const previewInput = input({
      actionId: 'stable-v5:request-preview:preview_ready',
      actionKind: 'preview_ready',
      questionCode: null,
      fallbackText: '2件の仮予定候補を作りました。内容を確認して、問題なければ仮予定へ追加してください。',
      previewCount: 2,
    });
    const accepted = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(JSON.stringify({
        actionId: previewInput.actionId,
        text: '2件の仮予定候補を作りました。内容を確認してください。',
      })),
    );
    const rejected = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(JSON.stringify({
        actionId: previewInput.actionId,
        text: '仮予定候補を作りました。内容を確認してください。',
      })),
    );

    await expect(accepted.render(previewInput)).resolves.toMatchObject({ status: 'rendered' });
    await expect(rejected.render(previewInput)).resolves.toMatchObject({
      status: 'fallback',
      reason: 'ungrounded_text',
    });
  });

  it('falls back on invalid JSON, unsafe content, and provider failure', async () => {
    const invalidJson = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning('not-json'),
    );
    const unsafe = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(JSON.stringify({
        actionId: 'stable-v5:request-1:quantity_role_unresolved',
        text: '院試の勉強について、設定画面を開いてください。',
      })),
    );
    const failed = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(new Error('network failure')),
    );

    await expect(invalidJson.render(input())).resolves.toMatchObject({
      status: 'fallback',
      reason: 'invalid_json',
    });
    await expect(unsafe.render(input())).resolves.toMatchObject({
      status: 'fallback',
      reason: 'unsafe_text',
    });
    await expect(failed.render(input())).resolves.toEqual({
      status: 'fallback',
      reason: 'provider_error',
      rawResponse: null,
    });
  });
});
