import { createConversationSync, conversationScopeKey, type ConversationLocalRecord, type ConversationLocalStore,
  type ConversationPayload, type ConversationRemoteStore, type ConversationScope, type ConversationSnapshot } from './weeklyPlanningConversationSync';
import { validateConversationPayload } from './weeklyPlanningConversationPayload';
import { createAiPlanningChat, readAiPlanningChatIndex, saveAiPlanningChatIndex, type AiPlanningChatRecord } from '../../chat/aiPlanningChatStore';

export interface ConversationWorkspaceLocal extends ConversationLocalStore {
  listOwner(ownerId: string): Promise<ConversationLocalRecord[]>;
  close(): Promise<void>;
}
export interface ConversationWorkspaceRemote extends ConversationRemoteStore {
  consent(): Promise<boolean>;
  enable(): Promise<void>;
  watch?(changed: () => void, failed: () => void): () => void;
  list(cursor?: string | null, pageSize?: number): Promise<{ items: ConversationSnapshot[]; cursor: string | null }>;
}
export type ConversationWorkspaceStatus = 'synced' | 'pending' | 'offline' | 'conflict' | 'error';
export interface ConversationWorkspaceView {
  status: ConversationWorkspaceStatus;
  unpersisted: boolean;
  conflict: ConversationLocalRecord | null;
  message: string;
}

/** The computation uses a memory replica. IndexedDB alone owns its durable state/outbox;
 * localStorage is only read for first migration and keeps the small navigation index. */
export function createConversationWorkspace(ports: {
  ownerId: string;
  local: ConversationWorkspaceLocal;
  remote: ConversationWorkspaceRemote;
  legacy: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  legacyKeys(): string[];
  active(): boolean;
  busy(): boolean;
  changed(): void;
  installed(): void;
  online(): boolean;
  now(): string;
}) {
  const prefix = `studyplanner.weeklyPlanning.vnext.${ports.ownerId}.`;
  const memory = new Map<string, string>();
  const records = new Map<string, ConversationLocalRecord>();
  const dirty = new Set<string>();
  let serial: Promise<unknown> = Promise.resolve();
  let view: ConversationWorkspaceView = { status: 'pending', unpersisted: false, conflict: null, message: '' };
  let hydrated = false;
  let installing = false;
  let syncRequest: Promise<boolean> | null = null;
  const sync = createConversationSync({ ...ports, validatePayload: validateConversationPayload,
    operationId: () => crypto.randomUUID() });
  const guard = () => { if (!ports.active()) throw new Error('owner-changed'); };
  const pair = (scope: Pick<ConversationScope, 'chatId' | 'weekStartDate'>) => `${prefix}${scope.weekStartDate}.${scope.chatId}`;
  function publish(next: Partial<ConversationWorkspaceView>) {
    const updated = { ...view, ...next };
    // A server read or no-op durability preflight is not a conversation mutation.
    // Spurious notifications remount the owning application while a turn is being
    // prepared, making a valid input appear stale and preventing submission.
    if (updated.status === view.status && updated.unpersisted === view.unpersisted
      && updated.conflict === view.conflict && updated.message === view.message) return;
    view = updated;
    if (ports.active()) ports.changed();
  }
  function enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = serial.catch(() => {}).then(() => { guard(); return run(); });
    serial = next; return next;
  }
  function remember(record: ConversationLocalRecord, install = false) {
    records.set(conversationScopeKey(record.scope), record);
    if (install) {
      const key = pair(record.scope);
      if (record.working === null) { memory.delete(`${key}.core`); memory.delete(`${key}.ui`); }
      else {
        if (record.working.core === null) memory.delete(`${key}.core`); else memory.set(`${key}.core`, record.working.core);
        memory.set(`${key}.ui`, record.working.ui);
      }
      dirty.delete(key);
    }
  }
  function readPair(key: string): { scope: ConversationScope; payload: ConversationPayload } | null {
    const raw = memory.get(`${key}.ui`);
    if (raw === undefined) return null;
    const suffix = key.slice(prefix.length);
    const match = /^(\d{4}-\d{2}-\d{2})\.(ai-chat-[A-Za-z0-9_-]+)$/.exec(suffix);
    if (!match) return null;
    const value = JSON.parse(raw);
    const scope: ConversationScope = { ownerId: ports.ownerId, weekStartDate: match[1], chatId: match[2], conversationId: value.conversationId };
    const messages = value.payload?.state?.messages as Array<{ role: string; content: string }> | undefined;
    const title = messages?.find(message => message.role === 'user')?.content.trim().slice(0, 32) || '新しいチャット';
    const payload = { core: memory.get(`${key}.core`) ?? null, ui: raw, title };
    if (!validateConversationPayload(scope, payload)) throw new Error('invalid-conversation-payload');
    return { scope, payload };
  }
  const storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
    getItem: key => key.startsWith(prefix) ? memory.get(key) ?? null : ports.legacy.getItem(key),
    setItem: (key, value) => {
      guard();
      if (!key.startsWith(prefix)) throw new Error('unowned-conversation-key');
      if (memory.get(key) === value) return;
      memory.set(key, value); dirty.add(key.replace(/\.(core|ui)$/, ''));
      view = { ...view, unpersisted: true };
    },
    removeItem: key => {
      guard();
      if (!key.startsWith(prefix)) throw new Error('unowned-conversation-key');
      if (memory.delete(key)) { dirty.add(key.replace(/\.(core|ui)$/, '')); view = { ...view, unpersisted: true }; }
    },
  };
  function status(message = '') {
    const conflict = [...records.values()].find(row => row.blocked === 'conflict') ?? null;
    const pending = dirty.size > 0 || [...records.values()].some(row => row.dirty || row.pending);
    publish({ status: conflict ? 'conflict' : pending ? ports.online() ? 'pending' : 'offline' : 'synced',
      conflict, unpersisted: dirty.size > 0, message });
  }
  async function persistInner() {
    guard();
    for (const key of [...dirty]) {
      const captured = readPair(key);
      const known = captured ? records.get(conversationScopeKey(captured.scope))
        : [...records.values()].find(row => pair(row.scope) === key);
      if (!captured && !known) { dirty.delete(key); continue; }
      const scope = captured?.scope ?? known!.scope;
      const payload = captured?.payload ?? null;
      if (!known && payload && payload.core === null) {
        const state = JSON.parse(payload.ui).payload.state;
        if (!state.messages.length && !state.draftBlocks.length) { dirty.delete(key); continue; }
      }
      const uiBefore = memory.get(`${key}.ui`), coreBefore = memory.get(`${key}.core`);
      const record = await sync.stage(scope, payload, known?.generation ?? 0);
      guard(); remember(record);
      if (memory.get(`${key}.ui`) === uiBefore && memory.get(`${key}.core`) === coreBefore) dirty.delete(key);
    }
    status();
  }
  function installIndex() {
    const existing = readAiPlanningChatIndex(ports.ownerId);
    if (existing.status === 'unavailable') throw new Error('chat-index-unavailable');
    const previous = existing.index;
    const byChat = new Map<string, AiPlanningChatRecord>(previous.chats.map(row => [row.id, row]));
    const available = [...records.values()].filter(row => row.working !== null);
    const deletedChatIds = new Set([...records.values()].filter(row => row.working === null).map(row => row.scope.chatId));
    for (const chatId of deletedChatIds) if (!available.some(row => row.scope.chatId === chatId)) byChat.delete(chatId);
    for (const row of available) {
      const old = byChat.get(row.scope.chatId);
      const updatedAt = row.editedAt ?? row.confirmed?.updatedAt ?? ports.now();
      if (old && old.weekStartDate !== null && old.updatedAt > updatedAt) continue;
      byChat.set(row.scope.chatId, { id: row.scope.chatId, title: row.working!.title,
        createdAt: old?.createdAt ?? updatedAt, updatedAt, weekStartDate: row.scope.weekStartDate });
    }
    if (available.length) for (const candidate of previous.chats) {
      if (available.some(row => row.scope.chatId === candidate.id)) continue;
      const raw = candidate.weekStartDate ? memory.get(`${pair({ chatId: candidate.id, weekStartDate: candidate.weekStartDate })}.ui`) : null;
      const state = raw ? JSON.parse(raw).payload?.state : null;
      if (candidate.title === '新しいチャット' && (!state || (!state.messages.length && !state.draftBlocks.length))) byChat.delete(candidate.id);
    }
    const chats = [...byChat.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (!chats.length) {
      const blank = createAiPlanningChat({ version: 1, activeChatId: '', chats: [] }).index;
      if (!saveAiPlanningChatIndex(ports.ownerId, blank)) throw new Error('chat-index-write-failed');
      return;
    }
    const previousRecord = previous.chats.find(row => row.id === previous.activeChatId);
    const activeHasContent = available.some(row => row.scope.chatId === previous.activeChatId
      && JSON.parse(row.working!.ui).payload.state.messages.length > 0);
    const activeChatId = byChat.has(previous.activeChatId) && activeHasContent
      ? previous.activeChatId : available.find(row => JSON.parse(row.working!.ui).payload.state.messages.length > 0)?.scope.chatId ?? previousRecord?.id ?? chats[0].id;
    if (!saveAiPlanningChatIndex(ports.ownerId, { version: 1, activeChatId, chats })) throw new Error('chat-index-write-failed');
  }
  function report(error: unknown) {
    if (!ports.active()) return;
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    const offline = !ports.online() || code === 'unavailable' || code === 'deadline-exceeded';
    publish({ status: offline ? 'offline' : 'error', unpersisted: dirty.size > 0,
      message: offline ? '端末内に保持しています。接続が戻ったら同期します。'
        : dirty.size > 0 ? '端末への保存が完了していません。画面を閉じずに再試行してください。'
        : '同期できませんでした。端末内の内容は保持しています。' });
  }
  async function open() {
    return enqueue(async () => {
      // Legacy bytes remain untouched for rollback. Existing IDB records always take precedence.
      for (const key of ports.legacyKeys()) if (key.startsWith(prefix) && /\.(core|ui)$/.test(key)) {
        const raw = ports.legacy.getItem(key); if (raw !== null) memory.set(key, raw);
      }
      const stored = await ports.local.listOwner(ports.ownerId); guard();
      // A device clock is not authority to destroy unsent edits. The server expires bodies;
      // its tombstone is reconciled on reconnect, with explicit review if this device is dirty.
      for (const record of stored) remember(record, true);
      for (const key of [...memory.keys()].filter(key => key.endsWith('.ui'))) {
        const base = key.slice(0, -3);
        const value = readPair(base);
        if (value && !records.has(conversationScopeKey(value.scope))) dirty.add(base);
      }
      await persistInner(); guard(); hydrated = true; installIndex(); status();
    }).catch(error => { report(error); throw error; });
  }
  function persist() { return enqueue(persistInner).catch(error => { report(error); throw error; }); }
  function synchronize(): Promise<boolean> {
    if (syncRequest) return syncRequest;
    const request = enqueue(async () => {
      if (!hydrated || ports.busy()) return false;
      await persistInner();
      if (!ports.online()) { status(); return false; }
      let cursor: string | null = null;
      const snapshots: ConversationSnapshot[] = [];
      let pages = 0;
      do {
        const page = await ports.remote.list(cursor); guard(); snapshots.push(...page.items); cursor = page.cursor;
        if (++pages >= 100 && cursor) throw new Error('conversation-page-limit');
      } while (cursor);
      // User activity while the network was pending is staged before remote state is accepted.
      if (ports.busy()) return false;
      await persistInner();
      // Merely checking an unchanged server version must not revoke a prepared send.
      // Freeze the runtime only when adopting genuinely different clean shared bytes.
      installing = snapshots.some(snapshot => {
        const before = records.get(conversationScopeKey(snapshot.scope));
        return !before?.dirty && !before?.pending && !before?.blocked
          && JSON.stringify(before?.working) !== JSON.stringify(snapshot.payload);
      });
      let installed = false;
      for (const snapshot of snapshots) {
        const before = records.get(conversationScopeKey(snapshot.scope));
        // Do not replace the receipt needed to determine whether an actual-save committed.
        if (before?.working && JSON.parse(before.working.ui).actualSaveAttempt) continue;
        const next = await sync.ingest(snapshot.scope, snapshot); guard();
        const canInstall = !next.dirty && !next.pending && !next.blocked && !dirty.has(pair(next.scope)) && !ports.busy();
        remember(next, canInstall);
        // Acknowledging this device's unchanged bytes must not remount an active input.
        if (canInstall && JSON.stringify(before?.working) !== JSON.stringify(next.working)) installed = true;
      }
      installing = false;
      // A recovered response is acknowledged before considering a later local edit.
      for (const row of [...records.values()]) {
        if (!row.dirty && !row.pending || row.blocked) continue;
        if (row.working && JSON.parse(row.working.ui).actualSaveAttempt) continue;
        const result = await sync.flush(row.scope); guard(); remember(result.record);
        // A newer edit is a separate immutable operation, not a replacement of an uncertain send.
        if (result.status === 'pending' && !ports.busy()) {
          const next = await sync.flush(row.scope); guard(); remember(next.record);
        }
      }
      installIndex(); status();
      if (installed && !ports.busy()) ports.installed();
      return view.status === 'synced';
    }).catch(error => { report(error); return false; }).finally(() => {
      installing = false;
      if (syncRequest === request) syncRequest = null;
    });
    syncRequest = request; return request;
  }
  function resolve(choice: 'local' | 'remote') {
    return enqueue(async () => {
      if (ports.busy()) return false;
      const record = view.conflict;
      if (!record) return false;
      const next = await sync.resolve(record.scope, choice, record.generation); guard();
      remember(next, true); installIndex(); status(); ports.installed(); return true;
    }).then(async changed => changed ? synchronize() : false).catch(error => { report(error); return false; });
  }
  function deleteChat(chatId: string) {
    for (const row of records.values()) if (row.scope.chatId === chatId) {
      const key = pair(row.scope); memory.delete(`${key}.core`); memory.delete(`${key}.ui`); dirty.add(key);
    }
    return persist().then(synchronize);
  }
  return { storage, open, persist, synchronize, resolve, deleteChat,
    get view() { return view; },
    get hasUnpersisted() { return dirty.size > 0; },
    get hasWork() { return dirty.size > 0; },
    get installing() { return installing; },
  };
}
export type ConversationWorkspace = ReturnType<typeof createConversationWorkspace>;
