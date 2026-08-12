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

function rendererResponse(
  renderInput: WeeklyPlanningStableV5DialogueRenderInput,
  text: string,
  overrides: Partial<{
    actionId: string;
    actionKind: string;
    questionCode: string | null;
  }> = {},
): string {
  return JSON.stringify({
    actionId: overrides.actionId ?? renderInput.actionId,
    actionKind: overrides.actionKind ?? renderInput.actionKind,
    questionCode: overrides.questionCode === undefined
      ? renderInput.questionCode
      : overrides.questionCode,
    text,
  });
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
  it('sends one state summary and the typed application decision to the model for explanation requests', async () => {
    const renderInput = input();
    const client = clientReturning(rendererResponse(
      renderInput,
      '3時間が、この週間計画で実際に進める量なのか、まだ残っている総量なのかを確認したいという意味です。',
    ));
    const renderer = createAiWeeklyPlanningStableV5DialogueRenderer(config, client);

    await expect(renderer.render(renderInput)).resolves.toEqual({
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
      actionId: renderInput.actionId,
      currentUserMessage: 'どういうこと？',
      recentConversation: expect.any(Array),
      planningStateSummary: {
        decidedFacts: expect.any(Object),
        undecidedItems: expect.any(Array),
      },
      applicationDecision: {
        actionKind: 'question',
        questionCode: 'quantity_role_unresolved',
        relevantLabels: ['院試の第2分野'],
        previewCount: 0,
      },
    });
    expect(payload).not.toHaveProperty('planningInformation');
    expect(
      payload.planningStateSummary as Record<string, unknown>,
    ).not.toHaveProperty('currentQuestion');
    expect(request.messages[1].content).not.toContain('apiKey');
  });

  it('uses a short prompt while preserving the typed action and safety contracts', () => {
    const prompt = createWeeklyPlanningStableV5DialoguePrompt(input());
    const combined = `${prompt.systemPrompt}\n${prompt.userPrompt}`;

    expect(prompt.systemPrompt).toContain('action識別子を変更しないでください');
    expect(prompt.systemPrompt).toContain('入力にない具体情報は、例としても補わないでください');
    expect(combined.match(/入力にない/g)).toHaveLength(1);
    expect(prompt.systemPrompt).not.toContain('Do not add, remove, split, or merge questions');
    expect(prompt.systemPrompt).not.toContain('Preserve every string');
    expect(prompt.userPrompt).toContain('referenceResponseはアプリが必要としている確認意図の参考');
    expect(prompt.userPrompt).toContain('文型・列挙順・語句をコピーする必要はありません');
    expect(prompt.userPrompt).toContain('未実行の作成・保存を完了したとは言わないでください');
  });

  it('accepts an explanation when the user asks what the previous question meant', async () => {
    const renderInput = input();
    const renderer = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(rendererResponse(
        renderInput,
        '「3時間」が今回の週間計画で進める分なのか、課題全体の残り時間なのかで、予定に入れる量が変わるので確認しています。',
      )),
    );

    await expect(renderer.render(renderInput)).resolves.toMatchObject({
      status: 'rendered',
      text: expect.stringContaining('確認しています'),
    });
  });

  it('does not require exact labels or the deterministic question form for explanations', async () => {
    const renderInput = input();
    const renderer = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(rendererResponse(
        renderInput,
        '今回の週間計画に何時間分を入れるべきか確認したい、ということです。',
      )),
    );

    await expect(renderer.render(renderInput)).resolves.toMatchObject({ status: 'rendered' });
  });

  it('bypasses AI for an ordinary machine-decided slot question', async () => {
    const renderInput = input({
      actionId: 'stable-v5:request-tomorrow:missing_schedulable_work',
      currentUserMessage: '明日',
      recentConversation: [
        { role: 'user', content: '明日の予定立てたいです' },
        { role: 'assistant', content: '明日の予定に入れたいことと量を教えてください。' },
      ],
      planningInformation: {
        planningWindows: [{ kind: 'relative_day', value: 'tomorrow' }],
        tasks: [],
      },
      actionKind: 'question',
      questionCode: 'missing_schedulable_work',
      requiredLabels: [],
      fallbackText: '予定に入れる作業量がまだありません。何をどれくらい進めたいか教えてください。',
      previewCount: 0,
    });
    const client = clientReturning(rendererResponse(
      renderInput,
      '明日の予定には、何をどれくらい入れたいですか？',
    ));
    const renderer = createAiWeeklyPlanningStableV5DialogueRenderer(config, client);

    await expect(renderer.render(renderInput)).resolves.toEqual({
      status: 'fallback',
      reason: 'deterministic_question',
      rawResponse: null,
    });
    expect(client.createChatCompletion).not.toHaveBeenCalled();
  });

  it('falls back when the model changes the action identity or question contract', async () => {
    const renderInput = input();
    const changedId = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(rendererResponse(
        renderInput,
        '今回進める量ですか？',
        { actionId: 'different-action' },
      )),
    );
    const changedQuestion = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(rendererResponse(
        renderInput,
        'いつからいつまでの予定ですか？',
        { questionCode: 'invalid_planning_horizon' },
      )),
    );

    await expect(changedId.render(renderInput)).resolves.toMatchObject({
      status: 'fallback',
      reason: 'action_mismatch',
    });
    await expect(changedQuestion.render(renderInput)).resolves.toMatchObject({
      status: 'fallback',
      reason: 'action_contract_mismatch',
    });
  });

  it('falls back only when an explanation invents a clock time or date absent from all context', async () => {
    const baseInput = input();
    const invented = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(rendererResponse(
        baseInput,
        '明日の20時から3時間進める予定として扱います。',
      )),
    );
    const groundedInput = input({
      currentUserMessage: '明日の20時ってどういう意味？',
    });
    const grounded = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(rendererResponse(
        groundedInput,
        '明日の20時から進める分は、今回進めたい量ですか、それとも残っている全体量ですか？',
      )),
    );

    await expect(invented.render(baseInput)).resolves.toMatchObject({
      status: 'fallback',
      reason: 'ungrounded_text',
    });
    await expect(grounded.render(groundedInput)).resolves.toMatchObject({ status: 'rendered' });
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
      clientReturning(rendererResponse(
        previewInput,
        '仮予定を作りました。内容を見て、気になるところがあれば教えてください。',
      )),
    );
    const questionAdded = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(rendererResponse(
        previewInput,
        '仮予定を作りました。この内容で進められそうですか？',
      )),
    );
    const wrongCount = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(rendererResponse(previewInput, '3件の仮予定を作りました。')),
    );

    await expect(countOmitted.render(previewInput)).resolves.toMatchObject({ status: 'rendered' });
    await expect(questionAdded.render(previewInput)).resolves.toMatchObject({ status: 'rendered' });
    await expect(wrongCount.render(previewInput)).resolves.toMatchObject({
      status: 'fallback',
      reason: 'ungrounded_text',
    });
  });

  it('falls back on invalid JSON, unsafe content, and provider failure', async () => {
    const renderInput = input();
    const invalidJson = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning('not-json'),
    );
    const unsafe = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(rendererResponse(renderInput, 'APIキーを送ってください。')),
    );
    const failed = createAiWeeklyPlanningStableV5DialogueRenderer(
      config,
      clientReturning(new Error('network failure')),
    );

    await expect(invalidJson.render(renderInput)).resolves.toMatchObject({
      status: 'fallback',
      reason: 'invalid_json',
    });
    await expect(unsafe.render(renderInput)).resolves.toMatchObject({
      status: 'fallback',
      reason: 'unsafe_text',
    });
    await expect(failed.render(renderInput)).resolves.toEqual({
      status: 'fallback',
      reason: 'provider_error',
      rawResponse: null,
    });
  });
});
