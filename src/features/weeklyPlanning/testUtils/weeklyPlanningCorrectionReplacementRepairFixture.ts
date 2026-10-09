import { CAMPAIGN, campaignPayload, campaignProviderReply, type CampaignRequest } from './weeklyPlanningRealE2ECampaignFixture';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime } from './weeklyPlanningScriptedConversationHarness';
import type { Json } from './weeklyPlanningSchedulingConstraintsFixture';

export const REPLACEMENT_REPLY_TEXT = CAMPAIGN.C[2];
/**
 * 'repeat': the generic repair dangles again and the focused temporal recovery finds no new date (unrecoverable → disclosed).
 * 'repeat_recovered': same, but the focused recovery reads the user's date (D2: recovered → the new deadline previews).
 */
export function correctionReplacementRepairFixture(mode: 'include' | 'drop' | 'repeat' | 'repeat_recovered' | 'recurrence_dangling' = 'include') {
  resetScriptedConversationRuntime();
  let answers = 0;
  const provider = installScriptedWeeklyPlanningProvider(call => {
    if (call.schemaName === 'weekly_planning_focused_temporal_replacement_repair_v5') {
      const asked = JSON.parse(call.messages[call.messages.length - 1].content) as { corrections: Array<{ localId: string }> };
      return JSON.stringify({ replacements: asked.corrections.map(item => mode === 'repeat_recovered'
        ? { localId: item.localId, decision: 'provided', dateExpression: '2026-10-16', sourceText: REPLACEMENT_REPLY_TEXT }
        : { localId: item.localId, decision: 'fallback', dateExpression: '', sourceText: '' }) });
    }
    const reply = campaignProviderReply('C', call.request as unknown as CampaignRequest);
    if (call.kind !== 'semantic_generic'
      || campaignPayload(call.request as unknown as CampaignRequest).userText !== REPLACEMENT_REPLY_TEXT) return reply;
    answers += 1;
    const invalid = JSON.parse(reply) as Json;
    for (const task of invalid.tasks as Json[]) task.temporalConstraints = [];
    if (mode === 'recurrence_dangling') {
      // A kind with NO focused recovery: a dangling recurrence replacement, in the initial reading and again in the repair.
      return JSON.stringify({ ...invalid, tasks: [], corrections: [{ localId: 'c1', target: { kind: 'recurrence', publicId: 'wpf_recurrence_missing', localId: null, mention: null },
        operation: 'replace', replacementLocalId: 'recurrence_1', sourceText: REPLACEMENT_REPLY_TEXT }] });
    }
    if (answers === 1 || mode === 'repeat' || mode === 'repeat_recovered') return JSON.stringify(invalid);
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
