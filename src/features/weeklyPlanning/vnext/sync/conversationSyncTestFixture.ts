import { conversationScopeKey } from './weeklyPlanningConversationSync';
import { createInitialPlanningState } from '../../weeklyPlanningReducer';
import type { ConversationLocalRecord, ConversationScope, ConversationSnapshot } from './weeklyPlanningConversationSync';
import type { ConversationWorkspaceLocal, ConversationWorkspaceRemote } from './weeklyPlanningConversationWorkspace';

export const SYNC_TEST_NOW = '2026-11-07T03:00:00.000Z';
export function conversationSyncMemoryStore(): ConversationWorkspaceLocal {
  const rows = new Map<string, ConversationLocalRecord>();
  const key = conversationScopeKey;
  return {
    read: async scope => structuredClone(rows.get(key(scope)) ?? null),
    update: async (scope, change) => {
      const next = change(structuredClone(rows.get(key(scope)) ?? null));
      rows.set(key(scope), structuredClone(next)); return structuredClone(next);
    },
    listOwner: async owner => structuredClone([...rows.values()].filter(row => row.scope.ownerId === owner)),
    close: async () => {},
  };
}
export function conversationSyncFakeServer() {
  const rows = new Map<string, ConversationSnapshot>();
  let enabled = false;
  let offline = false;
  let loseReply = false;
  let writes = 0;
  const key = (scope: ConversationScope) => `${scope.ownerId}/${scope.chatId}/${scope.weekStartDate}`;
  const connected = () => { if (offline) throw Object.assign(new Error('offline'), { code: 'unavailable' }); };
  const remote: ConversationWorkspaceRemote = {
    consent: async () => { connected(); return enabled; },
    enable: async () => { connected(); enabled = true; },
    read: async scope => { connected(); return structuredClone(rows.get(key(scope)) ?? null); },
    list: async () => { connected(); return { items: structuredClone([...rows.values()]), cursor: null }; },
    commit: async operation => {
      connected();
      const before = rows.get(key(operation.scope)) ?? null;
      if (before?.operationId === operation.operationId) return { status: 'accepted', snapshot: structuredClone(before) };
      if ((before?.revision ?? 0) !== operation.baseRevision || before?.deleted) return { status: 'conflict', snapshot: structuredClone(before) };
      const snapshot: ConversationSnapshot = { scope: operation.scope, revision: operation.baseRevision + 1,
        operationId: operation.operationId, deleted: operation.payload === null, payload: operation.payload, updatedAt: SYNC_TEST_NOW };
      rows.set(key(operation.scope), structuredClone(snapshot)); writes++;
      if (loseReply) { loseReply = false; throw Object.assign(new Error('response lost'), { code: 'unavailable' }); }
      return { status: 'accepted', snapshot };
    },
  };
  return { remote, rows, get writes() { return writes; }, setOffline(value: boolean) { offline = value; },
    loseNextReply() { loseReply = true; } };
}
export function syncTestPayload(scope: ConversationScope, text: string) {
  const state = createInitialPlanningState(scope.weekStartDate);
  state.updatedAt = SYNC_TEST_NOW;
  state.messages = [{ id: 'message', role: 'user', content: text, createdAt: SYNC_TEST_NOW }];
  return { core: null, title: text.slice(0, 32), ui: JSON.stringify({ ownerId: scope.ownerId,
    conversationId: scope.conversationId, payload: { version: 2, state } }) };
}
