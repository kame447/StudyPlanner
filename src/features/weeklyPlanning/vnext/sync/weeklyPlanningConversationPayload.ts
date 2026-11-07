import { createWeeklyPlanningVNextLocalSession } from '../application/weeklyPlanningVNextLocalSession';
import type { ConversationPayload, ConversationScope } from './weeklyPlanningConversationSync';

// Leave room for Firestore's document metadata and UTF-8 encoding; never truncate a conversation.
export const MAX_CONVERSATION_SYNC_BYTES = 700 * 1024;

export function validConversationScope(scope: ConversationScope): boolean {
  return typeof scope.ownerId === 'string' && scope.ownerId.length > 0 && scope.ownerId.length <= 128 && !scope.ownerId.includes('/')
    && typeof scope.chatId === 'string' && /^ai-chat-[A-Za-z0-9_-]{1,120}$/.test(scope.chatId)
    && typeof scope.weekStartDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(scope.weekStartDate)
    && Number.isFinite(Date.parse(`${scope.weekStartDate}T00:00:00.000Z`))
    && typeof scope.conversationId === 'string' && scope.conversationId.length > 0 && scope.conversationId.length <= 256;
}

/** Decode at the cloud/local trust boundary using the actual VNext/UI readers, not a second graph schema. */
export function validateConversationPayload(scope: ConversationScope, payload: ConversationPayload): boolean {
  if (!validConversationScope(scope) || !payload || typeof payload !== 'object'
    || (payload.core !== null && typeof payload.core !== 'string') || typeof payload.ui !== 'string'
    || typeof payload.title !== 'string' || payload.title.length > 32
    || new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_CONVERSATION_SYNC_BYTES) return false;
  try {
    const ui = JSON.parse(payload.ui);
    if (ui?.ownerId !== scope.ownerId || ui?.conversationId !== scope.conversationId || ui?.payload?.version !== 2
      || !ui.payload.state || ui.payload.state.pendingTurn || ui.payload.state.pendingApproval
      || ui.payload.state.approvalRecovery) return false;
    const session = createWeeklyPlanningVNextLocalSession({ ...scope, legacyV5Raw: null, storage: {
      getItem: key => key.endsWith('.core') ? payload.core : key.endsWith('.ui') ? payload.ui : null,
      setItem: () => { throw new Error('validation-cannot-write'); },
      removeItem: () => { throw new Error('validation-cannot-delete'); },
    } });
    const decoded = session.load();
    return decoded.conversationId === scope.conversationId && decoded.state.weekStartDate === scope.weekStartDate;
  } catch { return false; }
}
