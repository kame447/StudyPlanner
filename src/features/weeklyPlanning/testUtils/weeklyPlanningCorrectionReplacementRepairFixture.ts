import { CAMPAIGN, campaignPayload, campaignProviderReply, type CampaignRequest } from './weeklyPlanningRealE2ECampaignFixture';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime } from './weeklyPlanningScriptedConversationHarness';
import type { Json } from './weeklyPlanningSchedulingConstraintsFixture';

export const REPLACEMENT_REPLY_TEXT = CAMPAIGN.C[2];
export function correctionReplacementRepairFixture(mode: 'include' | 'drop' | 'repeat' = 'include') {
  resetScriptedConversationRuntime();
  let answers = 0;
  const provider = installScriptedWeeklyPlanningProvider(call => {
    const reply = campaignProviderReply('C', call.request as unknown as CampaignRequest);
    if (call.kind !== 'semantic_generic'
      || campaignPayload(call.request as unknown as CampaignRequest).userText !== REPLACEMENT_REPLY_TEXT) return reply;
    answers += 1;
    const invalid = JSON.parse(reply) as Json;
    for (const task of invalid.tasks as Json[]) task.temporalConstraints = [];
    if (answers === 1 || mode === 'repeat') return JSON.stringify(invalid);
    const instruction = JSON.parse(call.messages[call.messages.length - 1].content) as { requiredChanges?: string[] };
    const guidance = instruction.requiredChanges?.join(' ') ?? '';
    if (!guidance.includes('corrected kind') || !guidance.includes('referenced correction.replacementLocalId')
      || !guidance.includes('drop the correction if no change is meant')) return JSON.stringify(invalid);
    if (mode === 'include') return reply;
    return JSON.stringify({ ...invalid, planningIntent: 'discuss', tasks: [], corrections: [],
      conversationActs: [{ kind: 'topic_shift', targetPublicId: null }] });
  });
  const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1',
    conversationId: 'weekly-conversation-723e4567-e89b-42d3-a456-426614174000' });
  return { provider, conversation, async setup() {
    for (const text of CAMPAIGN.C.slice(0, 2)) {
      const turn = await conversation.submit(text);
      if (turn.result?.failure) throw new Error('synthetic correction setup failed');
    }
  } };
}
