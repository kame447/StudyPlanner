import { describe, expect, it, vi } from 'vitest';
import type { AiConfig } from '../../../lib/aiConfig';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  createAiWeeklyPlanningStableV5DialogueRenderer,
  createWeeklyPlanningStableV5DialoguePrompt,
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
    currentUserMessage: 'どういうこと？',
    recentConversation: [
      { role: 'user', content: '院試は2分野それぞれ3時間やりたい' },
      {
        role: 'assistant',
        content: '院試の第2分野の量は、今回進めたい量ですか、それとも残っている全体量ですか？',
      },
    ],
    planningInformation: {
      tasks: [{ title: '院試', category: 'study' }],
      workloads: [
        { taskTitle: '院試', componentLabel: '第1分野', amount: 3, unitLabel: '時間' },
        { taskTitle: '院試', componentLabel: '第2分野', amount: 3, unitLabel: '時間' },
      ],
    },
    actionKind: 'question',
    questionCode: 'quantity_role_unresolved',
    requiredLabels: ['院試の第2分野'],
    fallbackText: '院試の第2分野の量は、今回進めたい量ですか、それとも残っている全体量ですか？',
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
  it('sends the current message, recent conversation, and planning information to the model', async () => {
    const client = clientReturning(JSON.stringify({
      actionId: 'stable-v5:request-1:quantity_role_unresolved',
      text: '3時間が、この週間計画で実際に進める量なのか、まだ残っている総量なのかを確認したいという意味です。',
    }));
    const renderer = createAiWeeklyPlanningStableV5DialogueRenderer(config, client);

    await expect(renderer.render(input())).resolves.toEqual({
      status: 'rendered',
      text: '3時間が、この週間計画で実際に進める量なのか、まだ残っている総量なのかを確認したいという意味です。',
      rawResponse: expect.any(String),
    });

    expect(client.createChatCompletion).toHaveBeenCalledWith(expect.objectContaining({
      temperature: 0.4,
      responseFormat: WEEKLY_PLANNING_STABLE_V5_DIALOGUE_RENDERER_RESPONSE_FORMAT,
      purpose: 'weekly_planning_renderer',
    }));
    const request = vi.mocked(client.createChatCompletion).mock.calls[0][0];
    const payload = JSON.parse(request.messages[1].content) as Record<string, unknown>;
    expect(payload).toMatchObject({
      actionId: 'stable-v5:request-1:quantity_role_unresolved',
      currentUserMessage: 'どういうこと？',
      recentConversation: expect.any(Array),
      planningInformation: expect.any(Object),
      applicationDecision: {
        actionKind: 'question',
        questionCode: 'quantity_role_unresolved',
        relevantLabels: ['院試の第2分野'],
        previewCount: 0,
      },
    });
    expect(request.messages[1].content).not.toContain('apiKey');
  });

  it('uses a short system prompt instead of prescribing the response sentence', () => {
    const prompt = createWeeklyPlanningStableV5DialoguePrompt(input());

    expect(prompt.systemPrompt).toBe([
      'あなたは学習計画アプリの対話担当です。',
      '会話履歴、ユーザーの最新発話、アプリが把握している情報を踏まえて、次に返す自然な日本語を考えてください。',
      'アプリが把握していない予定や事実は作らないでください。',
      '指定されたJSON形式で、actionIdを変えずに返してください。',
    ].join('\n'));
    expect(prompt.systemPrompt).not.toContain('Do not add, remove, split, or merge questions');
    expect(prompt.systemPrompt).not.toContain('Preserve every string');
    expect(prompt.userPrompt).toContain('そのまま繰り返したり、単に言い換えたりする必要はありません');
  });

  it('accepts an explanation when the user asks what the previous question meant', async () => {
    const renderer = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(JSON.stringify({
        actionId: 'stable-v5:request-1:quantity_role_unresolved',
        text: '「3時間」が今回の週間計画で進める分なのか、課題全体の残り時間なのかで、予定に入れる量が変わるので確認しています。',
      })),
    );

    await expect(renderer.render(input())).resolves.toMatchObject({
      status: 'rendered',
      text: expect.stringContaining('確認しています'),
    });
  });

  it('does not require exact labels or the deterministic question form', async () => {
    const renderer = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(JSON.stringify({
        actionId: 'stable-v5:request-1:quantity_role_unresolved',
        text: '今回の週間計画に何時間分を入れるべきか確認したい、ということです。',
      })),
    );

    await expect(renderer.render(input())).resolves.toMatchObject({ status: 'rendered' });
  });

  it('falls back when the model changes the action identity', async () => {
    const renderer = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(JSON.stringify({
        actionId: 'different-action',
        text: '今回の週間計画に入れる量を確認しています。',
      })),
    );

    await expect(renderer.render(input())).resolves.toMatchObject({
      status: 'fallback',
      reason: 'action_mismatch',
    });
  });

  it('falls back only when the model invents a clock time or date absent from all context', async () => {
    const invented = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(JSON.stringify({
        actionId: 'stable-v5:request-1:quantity_role_unresolved',
        text: '明日の20時から3時間進める予定として扱います。',
      })),
    );
    const grounded = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(JSON.stringify({
        actionId: 'stable-v5:request-1:quantity_role_unresolved',
        text: '明日の20時から進める量について確認しています。',
      })),
    );

    await expect(invented.render(input())).resolves.toMatchObject({
      status: 'fallback',
      reason: 'ungrounded_text',
    });
    await expect(grounded.render(input({
      currentUserMessage: '明日の20時からやる分です',
    }))).resolves.toMatchObject({ status: 'rendered' });
  });

  it('allows omitting the preview count or asking a natural follow-up, but rejects a wrong count', async () => {
    const previewInput = input({
      actionId: 'stable-v5:request-preview:preview_ready',
      currentUserMessage: 'それで作って',
      actionKind: 'preview_ready',
      questionCode: null,
      requiredLabels: [],
      fallbackText: '2件の仮予定候補を作りました。内容を確認して、問題なければ仮予定へ追加してください。',
      previewCount: 2,
    });
    const countOmitted = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(JSON.stringify({
        actionId: previewInput.actionId,
        text: '仮予定を作りました。内容を見て、気になるところがあれば教えてください。',
      })),
    );
    const questionAdded = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(JSON.stringify({
        actionId: previewInput.actionId,
        text: '仮予定を作りました。この内容で進められそうですか？',
      })),
    );
    const wrongCount = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(JSON.stringify({
        actionId: previewInput.actionId,
        text: '3件の仮予定を作りました。',
      })),
    );

    await expect(countOmitted.render(previewInput)).resolves.toMatchObject({ status: 'rendered' });
    await expect(questionAdded.render(previewInput)).resolves.toMatchObject({ status: 'rendered' });
    await expect(wrongCount.render(previewInput)).resolves.toMatchObject({
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
        text: 'APIキーを送ってください。',
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
