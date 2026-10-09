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
    actionId: renderInput.conversationArchitecture === 'legacy_v5' ? renderInput.actionId : 'a1',
    actionKind: renderInput.actionKind,
    questionCode: renderInput.questionCode,
    groundingAcknowledgement,
    text,
  });
}

describe('Stable V5 AI dialogue renderer adapter', () => {
  it.each([false, true])('repairs an alternative promotion invitation once, then returns safe wording or fallback (repair safe: %s)', async repairSafe => {
    const renderInput = input({ actionKind: 'status', questionCode: null, requiredLabels: [],
      communication: { goal: 'report_status', askQuestion: false, questionPurposes: [], laterNeeds: [], statusReason: null,
        planningDetailsNotApplied: false, consultationDeferred: true, previewDisclosure: null, alternativeRequiresAdoption: true,
        consultation: { mode: 'advisory_only', assessmentScope: 'proposed_days',
          alternative: { scope: 'task', taskIds: ['task'], taskLabels: ['数学'], dates: ['2030-01-12'] },
          feasibility: { status: 'fits', basis: 'alternative_scheduler' }, missingQuestionCodes: [], workEstimates: [], dailyLimits: [], nextAction: 'offer_alternative_adoption' },
      } });
    let calls = 0;
    const createChatCompletion = vi.fn(async (_request: Parameters<OpenAiCompatibleClient['createChatCompletion']>[0]) => JSON.stringify({ ...JSON.parse(response(renderInput,
      repairSafe && calls++ > 0 ? 'その案を希望する場合は教えてください。' : '今の候補でよければ「この内容で仮予定にする」を押してください。')), feasibilityClaim: 'fits' }));
    const result = await createAiWeeklyPlanningStableV5DialogueRenderer(config, { createChatCompletion }).render(renderInput);
    expect(createChatCompletion).toHaveBeenCalledTimes(2);
    const repair = createChatCompletion.mock.calls[1]![0] as Parameters<OpenAiCompatibleClient['createChatCompletion']>[0];
    expect(repair.messages[repair.messages.length - 1]!.content).toContain('unadopted what-if');
    expect(result).toMatchObject(repairSafe ? { status: 'rendered' } : { status: 'fallback', reason: 'unadopted_alternative_promotion' });
  });
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
      responseFormat: {
        ...WEEKLY_PLANNING_STABLE_V5_DIALOGUE_RENDERER_RESPONSE_FORMAT,
        json_schema: {
          ...WEEKLY_PLANNING_STABLE_V5_DIALOGUE_RENDERER_RESPONSE_FORMAT.json_schema,
          schema: {
            ...WEEKLY_PLANNING_STABLE_V5_DIALOGUE_RENDERER_RESPONSE_FORMAT.json_schema.schema,
            properties: {
              ...(WEEKLY_PLANNING_STABLE_V5_DIALOGUE_RENDERER_RESPONSE_FORMAT.json_schema.schema.properties as Record<string, unknown>),
              actionId: { type: 'string', enum: ['a1'] },
            },
          },
        },
      },
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

  it('asks the interaction repair to continue with the typed goal after the acknowledgement; legacy keeps its wording', async () => {
    const renderInput = input({
      currentTurnGrounding: {
        mode: 'required_before_resume',
        acceptedFacts: [{ factId: 'effort-30', kind: 'effort_estimate', sourceText: '30分くらい', data: { minutes: 30 } }],
      },
    });
    const repairOf = async (architecture: 'interaction_v1' | 'legacy_v5') => {
      const createChatCompletion = vi.fn().mockResolvedValue(response({ ...renderInput, conversationArchitecture: architecture }, '英単語は1回分にどれくらいかかりますか？'));
      await createAiWeeklyPlanningStableV5DialogueRenderer(config, { createChatCompletion })
        .render({ ...renderInput, conversationArchitecture: architecture });
      expect(createChatCompletion).toHaveBeenCalledTimes(2);
      const messages = createChatCompletion.mock.calls[1]?.[0].messages as Array<{ content: string }>;
      return messages[messages.length - 1].content;
    };
    const interaction = await repairOf('interaction_v1');
    const legacy = await repairOf('legacy_v5');
    expect(interaction).toContain('ACK契約');
    expect(interaction).toContain('communication.goal');
    expect(legacy).toContain('ACK契約');
    expect(legacy).toContain('applicationDecisionの質問へ戻ってください');
    expect(legacy).not.toContain('communication');
  });

  it('falls back instead of rejecting when the repair dispatch itself fails, in both architectures', async () => {
    const renderInput = input({
      currentTurnGrounding: {
        mode: 'required_before_resume',
        acceptedFacts: [{ factId: 'effort-30', kind: 'effort_estimate', sourceText: '30分くらい', data: { minutes: 30 } }],
      },
    });
    for (const architecture of ['interaction_v1', 'legacy_v5'] as const) {
      const createChatCompletion = vi.fn()
        .mockResolvedValueOnce(response({ ...renderInput, conversationArchitecture: architecture }, '英単語は1回分にどれくらいかかりますか？'))
        .mockRejectedValueOnce(new TypeError('fetch failed'));
      await expect(createAiWeeklyPlanningStableV5DialogueRenderer(config, { createChatCompletion })
        .render({ ...renderInput, conversationArchitecture: architecture }))
        .resolves.toEqual({ status: 'fallback', reason: 'provider_error', rawResponse: null });
      expect(createChatCompletion).toHaveBeenCalledTimes(2);
    }
  });

  it('repairs once when the reply had to ask the question but did not', async () => {
    const renderInput = input({
      conversationArchitecture: 'interaction_v1',
      communication: {
        goal: 'explain_question', questionPurposes: ['estimate_time_to_fit_available_time'], askQuestion: true,
        laterNeeds: [], statusReason: null, planningDetailsNotApplied: false, consultationDeferred: false, previewDisclosure: null,
      },
    });
    const createChatCompletion = vi.fn()
      .mockResolvedValueOnce(response(renderInput, '空き時間に収めるためです。'))
      .mockResolvedValueOnce(response(renderInput, '空き時間に収めるためです。英単語は1回分にどれくらいかかりますか？'));
    await expect(createAiWeeklyPlanningStableV5DialogueRenderer(config, { createChatCompletion }).render(renderInput))
      .resolves.toMatchObject({ status: 'rendered' });
    const messages = createChatCompletion.mock.calls[1]?.[0].messages as Array<{ content: string }>;
    expect(messages[messages.length - 1].content).toContain('askQuestion=true');
  });

  describe('ungrounded_text single repair (interaction only; shared repair slot)', () => {
    const interactionInput = () => input({
      conversationArchitecture: 'interaction_v1',
      communication: {
        goal: 'explain_question', questionPurposes: ['estimate_time_to_fit_available_time'], askQuestion: true,
        laterNeeds: [], statusReason: null, planningDetailsNotApplied: false, consultationDeferred: false, previewDisclosure: null,
      },
    });
    const SLIP = '夕方5時から始めて、英単語は1回分にどれくらいかかりますか？';
    const GOOD = '英単語は1回分にどれくらいかかりますか？';

    it('one ungrounded slip is repaired once with the grounding instruction and the repaired reply passes', async () => {
      const renderInput = interactionInput();
      const createChatCompletion = vi.fn()
        .mockResolvedValueOnce(response(renderInput, SLIP))
        .mockResolvedValueOnce(response(renderInput, GOOD));
      await expect(createAiWeeklyPlanningStableV5DialogueRenderer(config, { createChatCompletion }).render(renderInput))
        .resolves.toMatchObject({ status: 'rendered', text: GOOD });
      expect(createChatCompletion).toHaveBeenCalledTimes(2);
      const messages = createChatCompletion.mock.calls[1]?.[0].messages as Array<{ content: string }>;
      expect(messages[messages.length - 1].content).toContain('24時間表記');
      expect(messages[messages.length - 1].content).toContain('時間の長さはそのまま使って構いません');
    });

    it('two slips stop at the existing fallback, with one regeneration only', async () => {
      const renderInput = interactionInput();
      const createChatCompletion = vi.fn().mockResolvedValue(response(renderInput, SLIP));
      await expect(createAiWeeklyPlanningStableV5DialogueRenderer(config, { createChatCompletion }).render(renderInput))
        .resolves.toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
      expect(createChatCompletion).toHaveBeenCalledTimes(2);
    });

    it('legacy keeps its behaviour: no repair, the same fallback', async () => {
      const legacy = input({ conversationArchitecture: 'legacy_v5' });
      const createChatCompletion = vi.fn().mockResolvedValue(response(legacy, SLIP));
      await expect(createAiWeeklyPlanningStableV5DialogueRenderer(config, { createChatCompletion }).render(legacy))
        .resolves.toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
      expect(createChatCompletion).toHaveBeenCalledTimes(1);
    });
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


describe('interaction claim repair and neutral acknowledgements', () => {
  const liveAcknowledgement = '1回1時間くらいで2回に分けて、どっちも夜がいいのですね。';
  function preview(): WeeklyPlanningStableV5DialogueRenderInput {
    return input({
      conversationArchitecture: 'interaction_v1', actionKind: 'preview_ready', questionCode: null, previewCount: 3,
      currentUserMessage: '1回1時間くらいで2回に分けたい。どっちも夜がいい。20:00から22:00。',
      previewPromotionControlLabel: 'この内容で仮予定にする', requiredLabels: ['この内容で仮予定にする'],
      currentTurnGrounding: { mode: 'required_before_resume', acceptedFacts: [{ factId: 'night',
        kind: 'temporal_constraint', sourceText: '20:00から22:00', data: { startTime: '20:00', endTime: '22:00' } }] },
      communication: { goal: 'present_preview', askQuestion: false, questionPurposes: [], laterNeeds: [],
        statusReason: null, planningDetailsNotApplied: false, consultationDeferred: false, previewDisclosure: null,
        previewConstraintSatisfaction: [{ sourceFactId: 'night', taskId: 'research', taskLabel: '研究',
          kind: 'preferred_window', status: 'not_satisfied' }] },
    });
  }
  const neutral = 'ご希望を受け取りました。';
  const announcement = '候補3件です。「この内容で仮予定にする」を選んで確認してください。';
  it('accepts a neutral ACK with the accepted fact IDs without forcing forbidden clock values in one call', async () => {
    const renderInput = preview();
    const before = structuredClone(renderInput);
    const client: OpenAiCompatibleClient = { createChatCompletion: vi.fn(async () => response(renderInput,
      neutral + announcement, { factIds: ['night'], text: neutral })) };
    await expect(createAiWeeklyPlanningStableV5DialogueRenderer(config, client).render(renderInput))
      .resolves.toMatchObject({ status: 'rendered' });
    expect(client.createChatCompletion).toHaveBeenCalledTimes(1);
    expect(renderInput).toEqual(before);
  });
  it.each(['value-ack', 'live-detached-ack', 'invalid-fact-id'] as const)('repairs %s once with neutral ACK instructions', async shape => {
    const renderInput = preview();
    const initialAck = shape === 'invalid-fact-id' ? neutral : liveAcknowledgement;
    // Live D returned the ACK separately, not as the text prefix. Use session evidence
    // here so it reaches the same composition/claim boundary as the live response.
    renderInput.currentTurnGrounding!.acceptedFacts[0] = {
      factId: 'night', kind: 'effort_estimate', sourceText: '1回1時間くらいで2回に分けたい', data: { minutes: 60 },
    };
    const client: OpenAiCompatibleClient = { createChatCompletion: vi.fn()
      .mockResolvedValueOnce(response(renderInput, (shape === 'live-detached-ack' ? '' : initialAck) + announcement,
        { factIds: [shape === 'invalid-fact-id' ? 'foreign' : 'night'], text: initialAck }))
      .mockResolvedValueOnce(response(renderInput, neutral + announcement, { factIds: ['night'], text: neutral })) };
    await expect(createAiWeeklyPlanningStableV5DialogueRenderer(config, client).render(renderInput))
      .resolves.toMatchObject({ status: 'rendered' });
    expect(client.createChatCompletion).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(client.createChatCompletion).mock.calls;
    expect(calls.every(([call]) => call.purpose === 'weekly_planning_renderer')).toBe(true);
    expect(calls[1][0].messages.slice(-1)[0]?.content).toContain('具体値を繰り返さない');
    expect(calls[1][0].messages.slice(-1)[0]?.content).toContain('acceptedFacts');
  });
  it('stops after one unsuccessful claim repair and retains a distinct failure reason', async () => {
    const renderInput = preview();
    const claim = '20:00から22:00に分けました。';
    const client: OpenAiCompatibleClient = { createChatCompletion: vi.fn(async () => response(renderInput,
      claim + announcement, { factIds: ['night'], text: claim })) };
    await expect(createAiWeeklyPlanningStableV5DialogueRenderer(config, client).render(renderInput))
      .resolves.toMatchObject({ status: 'fallback', reason: 'unverified_preview_constraint_claim' });
    expect(client.createChatCompletion).toHaveBeenCalledTimes(2);
  });
  it.each(['satisfied', 'legacy_v5'] as const)('preserves concrete-value ACK requirements outside unmet interaction previews (%s)', async scope => {
    const renderInput = preview();
    if (scope === 'legacy_v5') renderInput.conversationArchitecture = scope;
    else renderInput.communication!.previewConstraintSatisfaction![0].status = 'satisfied';
    const client: OpenAiCompatibleClient = { createChatCompletion: vi.fn(async () => response(renderInput,
      neutral + announcement, { factIds: ['night'], text: neutral })) };
    await expect(createAiWeeklyPlanningStableV5DialogueRenderer(config, client).render(renderInput))
      .resolves.toMatchObject({ status: 'fallback', reason: 'grounding_contract_mismatch' });
    expect(client.createChatCompletion).toHaveBeenCalledTimes(2);
  });
  it('repairs an unchecked typed consultation assertion once, with a consultation-only schema', async () => {
    const renderInput = input({ actionKind: 'status', questionCode: null, requiredLabels: [],
      conversationArchitecture: 'interaction_v1', communication: {
        goal: 'acknowledge_aside', askQuestion: false, questionPurposes: [], laterNeeds: [], statusReason: null,
        planningDetailsNotApplied: false, consultationDeferred: false, previewDisclosure: null,
        consultation: { mode: 'advisory_only', assessmentScope: 'accepted_plan_only',
          feasibility: { status: 'not_evaluated', reason: 'existing_preview_not_rechecked' },
          workEstimates: [], dailyLimits: [], missingQuestionCodes: [], nextAction: 'offer_preference_change' },
      } });
    const withClaim = (claim: string, text: string) => JSON.stringify({ ...JSON.parse(response(renderInput, text)), feasibilityClaim: claim });
    const client: OpenAiCompatibleClient = { createChatCompletion: vi.fn()
      .mockResolvedValueOnce(withClaim('fits', 'まとめて進める形も可能ですが、空き時間を確かめましょう。'))
      .mockResolvedValueOnce(withClaim('none', '土日にまとめる形で候補を試してみましょう。')) };
    await expect(createAiWeeklyPlanningStableV5DialogueRenderer(config, client).render(renderInput))
      .resolves.toMatchObject({ status: 'rendered' });
    expect(client.createChatCompletion).toHaveBeenCalledTimes(2);
    for (const [call] of vi.mocked(client.createChatCompletion).mock.calls) {
      expect(call.purpose).toBe('weekly_planning_renderer');
      expect(call.responseFormat?.json_schema.schema.required).toContain('feasibilityClaim');
    }
    expect(vi.mocked(client.createChatCompletion).mock.calls[1][0].messages.slice(-1)[0]?.content).toContain('feasibilityClaim=none');
    expect(WEEKLY_PLANNING_STABLE_V5_DIALOGUE_RENDERER_RESPONSE_FORMAT.json_schema.schema.required).not.toContain('feasibilityClaim');
  });
});
