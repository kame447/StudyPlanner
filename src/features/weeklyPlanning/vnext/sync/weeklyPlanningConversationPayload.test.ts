import { describe, expect, it } from 'vitest';
import { createInitialPlanningState } from '../../weeklyPlanningReducer';
import { createEmptyWeeklyPlanningVNextState } from '../semantic/weeklyPlanningVNextTransaction';
import { serializeWeeklyPlanningVNextSessionCheckpoint } from '../application/weeklyPlanningVNextSessionCheckpoint';
import { MAX_CONVERSATION_SYNC_BYTES, validateConversationPayload, validateLocalConversationPayload } from './weeklyPlanningConversationPayload';
import type { ConversationPayload, ConversationScope } from './weeklyPlanningConversationSync';

const scope: ConversationScope = { ownerId: 'owner', chatId: 'ai-chat-payload', weekStartDate: '2026-11-02', conversationId: 'conversation' };
function payload(): ConversationPayload {
  const state = createInitialPlanningState(scope.weekStartDate);
  state.messages = [{ id: 'message', role: 'user', content: '数学を1時間', createdAt: '2026-11-07T00:00:00.000Z' }];
  const core = serializeWeeklyPlanningVNextSessionCheckpoint({ ownerId: scope.ownerId, weekStartDate: scope.weekStartDate, conversationId: scope.conversationId,
    vnext: { state: createEmptyWeeklyPlanningVNextState(), presentedQuestion: null, preview: null, messages: [] },
    savedAt: '2026-11-07T00:00:00.000Z' });
  return { core, ui: JSON.stringify({ ownerId: scope.ownerId, conversationId: scope.conversationId, payload: { version: 2, state } }), title: '数学' };
}

describe('cloud conversation payload uses the production readers', () => {
  it('accepts coherent core/UI and a genuinely empty-core conversation', () => {
    expect(validateConversationPayload(scope, payload())).toBe(true);
    expect(validateLocalConversationPayload(scope, payload())).toBe(true);
    expect(validateConversationPayload(scope, { ...payload(), core: null })).toBe(true);
  });
  it('rejects another owner, conversation, or planning week', () => {
    for (const altered of [{ ownerId: 'foreign' }, { conversationId: 'foreign' }, { weekStartDate: '2026-11-09' }]) {
      expect(validateConversationPayload({ ...scope, ...altered }, payload())).toBe(false);
      expect(validateLocalConversationPayload({ ...scope, ...altered }, payload())).toBe(false);
    }
  });
  it('does not synchronize in-flight turns, approvals or unresolved actual-save recovery', () => {
    for (const field of ['pendingTurn', 'pendingApproval', 'approvalRecovery']) {
      const value = payload(); const ui = JSON.parse(value.ui); ui.payload.state[field] = { status: 'pending' };
      expect(validateConversationPayload(scope, { ...value, ui: JSON.stringify(ui) })).toBe(false);
    }
  });
  it('rejects unknown future capabilities, malformed JSON and oversize bytes without truncating', () => {
    const value = payload(); const core = JSON.parse(value.core!); core.requiredCapabilities = ['unknown-future'];
    expect(validateConversationPayload(scope, { ...value, core: JSON.stringify(core) })).toBe(false);
    expect(validateConversationPayload(scope, { ...value, ui: 'not-json' })).toBe(false);
    expect(validateConversationPayload(scope, { ...value, ui: 'あ'.repeat(MAX_CONVERSATION_SYNC_BYTES) })).toBe(false);
    expect(validateConversationPayload(scope, value)).toBe(true);
  });
});
