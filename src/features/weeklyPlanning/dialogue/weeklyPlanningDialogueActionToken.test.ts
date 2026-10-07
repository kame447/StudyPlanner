import { describe, expect, it, vi } from 'vitest';
import type { AiConfig } from '../../../lib/aiConfig';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { createAiWeeklyPlanningStableV5DialogueRenderer } from './weeklyPlanningStableV5AiDialogueRenderer';
import { createWeeklyPlanningStableV5DialoguePrompt } from './weeklyPlanningStableV5DialoguePrompt';
import { WEEKLY_PLANNING_STABLE_V5_DIALOGUE_RENDERER_RESPONSE_FORMAT, type WeeklyPlanningStableV5DialogueRenderInput } from './weeklyPlanningStableV5DialogueContracts';

const config: AiConfig = { provider: 'openai', baseUrl: 'https://example.test/v1', model: 'test', apiKey: 'test' };
const actionId = 'stable-v5:weekly-conversation-5b787bee-4b57-4eaf-b078-d07d3f389256:request:4:missing_effort_estimate:wp_workload_6870755f';
function input(): WeeklyPlanningStableV5DialogueRenderInput {
  return { actionId, conversationArchitecture: 'interaction_v1', currentUserMessage: '教材Aのこと', recentConversation: [],
    planningInformation: { tasks: [{ title: '教材A' }] }, actionKind: 'question', questionCode: 'missing_effort_estimate',
    requiredLabels: ['教材A'], fallbackText: '1問にどれくらいかかりますか？', previewCount: 0 };
}
function reply(id: unknown) {
  return JSON.stringify({ actionId: id, actionKind: 'question', questionCode: 'missing_effort_estimate',
    groundingAcknowledgement: null, text: '教材Aは1問にどれくらいかかりますか？' });
}

describe('interaction renderer action binding', () => {
  it('sends a short schema-bound action token and preserves application identity and provider bytes', async () => {
    const original = input();
    const before = structuredClone(original);
    const createChatCompletion = vi.fn<OpenAiCompatibleClient['createChatCompletion']>(async request => {
      const payload = JSON.parse(request.messages[1].content);
      expect(payload.actionId).toBe('a1');
      expect(request.responseFormat!.json_schema.schema.properties).toMatchObject({ actionId: { type: 'string', enum: ['a1'] } });
      expect(JSON.stringify(request.messages)).not.toContain(actionId);
      return reply(payload.actionId);
    });
    const result = await createAiWeeklyPlanningStableV5DialogueRenderer(config, { createChatCompletion }).render(original);
    expect(result).toMatchObject({ status: 'rendered', rawResponse: reply('a1') });
    expect(createChatCompletion).toHaveBeenCalledTimes(1);
    expect(original).toEqual(before);
  });

  it.each(['a2', actionId, actionId.replace('6870755f', '6870755e')])('rejects an unbound action id %s without fuzzy matching or another call', async id => {
    const createChatCompletion = vi.fn(async () => reply(id));
    await expect(createAiWeeklyPlanningStableV5DialogueRenderer(config, { createChatCompletion }).render(input()))
      .resolves.toMatchObject({ status: 'fallback', reason: 'action_mismatch', rawResponse: reply(id) });
    expect(createChatCompletion).toHaveBeenCalledTimes(1);
  });


  it('replays the live B explanation shape with synthetic material labels and no long-id copying', async () => {
    const original: WeeklyPlanningStableV5DialogueRenderInput = {
      ...input(), actionId: 'stable-v5:weekly-conversation-11111111-2222-4e4e-8888-999999999999:request:2:semantic_uncertainty',
      currentUserMessage: 'なんで時間が必要なの？', questionCode: 'semantic_uncertainty',
      planningInformation: { tasks: [{ title: '数学の問題集' }], registeredMaterials: [{ name: '演習書A' }, { name: '演習書B' }] },
      requiredLabels: ['数学の問題集'],
      communication: { goal: 'explain_question' as const, questionPurposes: ['resolve_unclear_detail'], askQuestion: true,
        laterNeeds: ['estimate_time_to_fit_available_time'], statusReason: null, planningDetailsNotApplied: false,
        consultationDeferred: false, previewDisclosure: null },
    };
    const text = '数学の問題集が複数あるため、対象を特定して、違う教材を予定に入れないように確認しています。『演習書A』と『演習書B』のどちらですか？';
    const createChatCompletion = vi.fn<OpenAiCompatibleClient['createChatCompletion']>(async request => {
      const payload = JSON.parse(request.messages[1].content);
      expect(payload.actionId).toBe('a1');
      return JSON.stringify({ actionId: payload.actionId, actionKind: 'question', questionCode: 'semantic_uncertainty', groundingAcknowledgement: null, text });
    });
    await expect(createAiWeeklyPlanningStableV5DialogueRenderer(config, { createChatCompletion }).render(original))
      .resolves.toMatchObject({ status: 'rendered', text });
    expect(createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('keeps the legacy request and exact full-id validation unchanged', async () => {
    const original = { ...input(), conversationArchitecture: 'legacy_v5' as const };
    const prompt = createWeeklyPlanningStableV5DialoguePrompt(original);
    const createChatCompletion = vi.fn<OpenAiCompatibleClient['createChatCompletion']>(async request => {
      expect(request.messages).toEqual([{ role: 'system', content: prompt.systemPrompt }, { role: 'user', content: prompt.userPrompt }]);
      expect(request.responseFormat).toEqual(WEEKLY_PLANNING_STABLE_V5_DIALOGUE_RENDERER_RESPONSE_FORMAT);
      return reply(actionId);
    });
    await expect(createAiWeeklyPlanningStableV5DialogueRenderer(config, { createChatCompletion }).render(original))
      .resolves.toMatchObject({ status: 'rendered', rawResponse: reply(actionId) });
    expect(WEEKLY_PLANNING_STABLE_V5_DIALOGUE_RENDERER_RESPONSE_FORMAT.json_schema.schema.properties).toMatchObject({ actionId: { type: 'string' } });
  });
});
