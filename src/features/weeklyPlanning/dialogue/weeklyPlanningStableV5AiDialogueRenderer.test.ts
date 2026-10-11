import { describe, expect, it, vi } from 'vitest';
import { parseWeeklyPlanningStableV5DialogueRendererResponse } from './weeklyPlanningStableV5DialogueValidation';
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

type GroundingAcknowledgement = null | {
  factIds: string[];
  text: string;
};

function response(
  renderInput: WeeklyPlanningStableV5DialogueRenderInput,
  text: string,
  groundingAcknowledgement: GroundingAcknowledgement = null,
): string {
  return JSON.stringify({
    actionId: renderInput.actionId,
    actionKind: renderInput.actionKind,
    questionCode: renderInput.questionCode,
    groundingAcknowledgement,
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

  it('retries once when a required current-turn acknowledgement is omitted', async () => {
    const renderInput = input({
      actionId: 'stable-v5:request-complete:missing_schedulable_work',
      currentUserMessage: 'もう100%終わっています',
      currentTurnGrounding: {
        mode: 'required_before_resume',
        acceptedFacts: [{
          factId: 'workload-completed-100',
          kind: 'workload',
          sourceText: 'もう100%終わっています',
          data: {
            taskId: 'task-slides',
            quantityRole: 'completed',
            amount: 100,
            unitCode: 'custom',
            unitLabel: '%',
          },
        }],
      },
      planningInformation: {
        tasks: [{ id: 'task-slides', title: '夏合宿の発表スライド', category: 'non_study' }],
        workloads: [{
          id: 'workload-completed-100',
          taskId: 'task-slides',
          quantityRole: 'completed',
          amount: 100,
          unitCode: 'custom',
          unitLabel: '%',
        }],
      },
      questionCode: 'missing_schedulable_work',
      questionIntent: {
        kind: 'schedulable_work_detail',
        mode: 'all_requested_work_complete',
        targetFactId: null,
        progressBasis: null,
        knownUnitCode: null,
        knownUnitLabel: null,
        requestedInformation: ['additional_task_or_constraint'],
      },
      requiredLabels: [],
      fallbackText: '指定された作業は完了済みです。ほかに予定へ加えたい作業や、考慮したい予定・制約があれば教えてください。',
    });
    const acknowledgement = 'スライドは100%まで完了しているんですね。';
    const continuation = 'ほかに予定へ加えたい作業や、考慮したい予定・制約はありますか？';
    const createChatCompletion = vi.fn()
      .mockResolvedValueOnce(response(renderInput, continuation))
      .mockResolvedValueOnce(response(
        renderInput,
        `${acknowledgement}${continuation}`,
        {
          factIds: ['workload-completed-100'],
          text: acknowledgement,
        },
      ));

    await expect(
      createAiWeeklyPlanningStableV5DialogueRenderer(
        config,
        { createChatCompletion },
      ).render(renderInput),
    ).resolves.toMatchObject({
      status: 'rendered',
      text: expect.stringMatching(/^スライドは100%/),
    });
    expect(createChatCompletion).toHaveBeenCalledTimes(2);
    expect(createChatCompletion.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('ACK契約'),
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

  it('contains a provider rejection on the one repeated-question repair', async () => {
    const previousQuestion = '英単語は1回分にどれくらい時間がかかりますか？';
    const renderInput = input({ recentConversation: [{ role: 'assistant', content: previousQuestion }] });
    const before = structuredClone(renderInput);
    const raw = response(renderInput, previousQuestion);
    // Valid JSON can violate the existing repeat contract; arbitrary malformed
    // JSON does not enter this repair path and would be the wrong discriminator.
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(raw, renderInput))
      .toEqual({ status: 'fallback', reason: 'repeated_question_text', rawResponse: raw });
    const providerError = new Error('synthetic second renderer dispatch rejection');
    const createChatCompletion = vi.fn<OpenAiCompatibleClient['createChatCompletion']>()
      .mockResolvedValueOnce(raw).mockRejectedValueOnce(providerError);
    const outcome = await createAiWeeklyPlanningStableV5DialogueRenderer(config, { createChatCompletion })
      .render(renderInput).then(
        (value) => ({ status: 'resolved' as const, value }),
        (error: unknown) => ({ status: 'rejected' as const, error }),
      );
    // These route facts are observed before the expected-red fallback assertion.
    expect(createChatCompletion).toHaveBeenCalledTimes(2);
    expect(createChatCompletion.mock.calls.map(([request]) => request.purpose))
      .toEqual(['weekly_planning_renderer', 'weekly_planning_renderer']);
    expect(createChatCompletion.mock.calls[0]?.[0].responseFormat)
      .toEqual(WEEKLY_PLANNING_STABLE_V5_DIALOGUE_RENDERER_RESPONSE_FORMAT);
    expect(createChatCompletion.mock.calls[1]?.[0].messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: expect.stringContaining('直前と異なる自然な表現') }),
    ]));
    await expect(createChatCompletion.mock.results[1]?.value).rejects.toBe(providerError);
    expect(renderInput).toEqual(before);
    expect(outcome).toEqual({ status: 'resolved', value: {
      status: 'fallback', reason: 'provider_error', rawResponse: null,
    } });
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

describe('failure-only recovery verification inside the existing two-call ceiling', () => {
  const recoveryInput = () => input({
    recoveryQuestionEvidence: { facts: [
      { collection: 'tasks', fact: { id: 'task-1', title: '英単語' } },
      { collection: 'workloads', fact: { id: 'workload-1', taskId: 'task-1', amount: 20, unitLabel: '語' } },
    ], labels: ['英単語'] },
    recovery: { planningDetailsNotApplied: true, acceptedStateUnchanged: true, retainedPreviewUnchanged: true },
    questionIntent: { kind: 'effort_measurement', measurement: 'total_duration',
      quantityRole: 'target', targetFactId: 'workload-1', amount: 20, unitCode: null, unitLabel: '語' },
  });
  const text = '今回はまだ反映していません。以前の候補はそのままです。英単語を終えるのに合計で何分くらいかかりますか？';
  const verdict = (actionId: string) => ({ actionId, questionMatches: 'yes', planningDetailsNotApplied: 'yes',
    acceptedStateUnchanged: 'yes', retainedPreviewUnchanged: 'yes', noUnsupportedClaims: 'yes' });

  it('generates free wording and independently checks the finite obligations once', async () => {
    const renderInput = recoveryInput();
    const call = vi.fn().mockResolvedValueOnce(response(renderInput, text))
      .mockResolvedValueOnce(JSON.stringify(verdict(renderInput.actionId)));
    const result = await createAiWeeklyPlanningStableV5DialogueRenderer(config,
      { createChatCompletion: call }, { canDispatchRecovery: () => true }).render(renderInput);
    expect(result).toMatchObject({ status: 'rendered', text, recoveryVerified: true });
    expect(call).toHaveBeenCalledTimes(2);
    const check = call.mock.calls[1][0];
    expect(check.purpose).toBe('weekly_planning_renderer');
    expect(JSON.parse(check.messages[1].content)).toEqual({ actionId: renderInput.actionId,
      recovery: renderInput.recovery, question: { code: renderInput.questionCode,
        intent: renderInput.questionIntent, identityEvidence: renderInput.recoveryQuestionEvidence }, text });
  });

  it.each(['questionMatches', 'planningDetailsNotApplied', 'acceptedStateUnchanged',
    'retainedPreviewUnchanged', 'noUnsupportedClaims'])('rejects missing or unclear obligation %s without regeneration', async (field) => {
    const renderInput = recoveryInput();
    const call = vi.fn().mockResolvedValueOnce(response(renderInput, text))
      .mockResolvedValueOnce(JSON.stringify({ ...verdict(renderInput.actionId), [field]: 'unclear' }));
    expect(await createAiWeeklyPlanningStableV5DialogueRenderer(config,
      { createChatCompletion: call }, { canDispatchRecovery: () => true }).render(renderInput))
      .toMatchObject({ status: 'fallback', reason: 'recovery_verification_failed' });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it.each(['malformed', 'wrong_action', 'provider_throw'])('stops on verifier %s without a third call', async (failure) => {
    const renderInput = recoveryInput();
    const call = vi.fn().mockResolvedValueOnce(response(renderInput, text));
    if (failure === 'provider_throw') call.mockRejectedValueOnce(new Error('offline'));
    else call.mockResolvedValueOnce(failure === 'malformed' ? '{' : JSON.stringify(verdict('other-action')));
    expect(await createAiWeeklyPlanningStableV5DialogueRenderer(config,
      { createChatCompletion: call }, { canDispatchRecovery: () => true }).render(renderInput))
      .toMatchObject({ status: 'fallback' });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it.each(['provider_throw', 'invalid_candidate', 'cancelled_after_generation'])('makes no verification call after %s', async (failure) => {
    const renderInput = recoveryInput();
    let current = true;
    const call = vi.fn(async () => {
      if (failure === 'provider_throw') throw new Error('offline');
      if (failure === 'invalid_candidate') return '{';
      current = false;
      return response(renderInput, text);
    });
    expect(await createAiWeeklyPlanningStableV5DialogueRenderer(config,
      { createChatCompletion: call }, { canDispatchRecovery: () => current }).render(renderInput))
      .toMatchObject({ status: 'fallback' });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('requires a live current-turn guard before any recovery call', async () => {
    const call = vi.fn();
    expect(await createAiWeeklyPlanningStableV5DialogueRenderer(config,
      { createChatCompletion: call }).render(recoveryInput())).toMatchObject({ status: 'fallback' });
    expect(call).not.toHaveBeenCalled();
  });
});
