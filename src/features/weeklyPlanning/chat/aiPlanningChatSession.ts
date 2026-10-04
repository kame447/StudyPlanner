import {
  createAiPlanningChat, deriveAiPlanningChatTitle, readAiPlanningChatIndex,
  loadAiPlanningChatSnapshot, removeAiPlanningChatFromIndex,
  removeAiPlanningChatSnapshot, saveAiPlanningChatIndex, saveAiPlanningChatSnapshot,
  setActiveAiPlanningChat, updateAiPlanningChatRecord, type AiPlanningChatIndex,
} from './aiPlanningChatStore';

type Snapshot = NonNullable<ReturnType<typeof loadAiPlanningChatSnapshot>>;
export type AiPlanningChatResult = { readonly status: 'saved' } | { readonly status: 'blocked'; readonly reason:
  'owner-changed' | 'busy' | 'index-unavailable' | 'initialization-unavailable' | 'snapshot-unavailable' | 'snapshot-write-failed' | 'index-write-failed' | 'target-unavailable' };
interface ChatSessionPorts {
  isCurrent(): boolean;
  isBusy(): boolean;
  exportSnapshot(includeEmpty: boolean): Snapshot | null;
  prepareImport(snapshot: Snapshot): (() => void) | null;
  prepareNew(): (() => void) | null;
  changed(): void;
}

function immutableIndex(value: AiPlanningChatIndex): AiPlanningChatIndex {
  value.chats.forEach(Object.freeze);
  Object.freeze(value.chats);
  return Object.freeze(value);
}

/** Owner/application-lifetime index; the application remains the only unsaved conversation authority. */
export function createAiPlanningChatSession(ownerId: string, ports: ChatSessionPorts) {
  let index: AiPlanningChatIndex | undefined;
  let hadStoredIndex = false;
  let phase: 'uninitialized' | 'ready' | 'index-unavailable' | 'snapshot-unavailable' = 'uninitialized';
  const unavailableIndex = immutableIndex({ version: 1, activeChatId: '', chats: [] });
  let result: AiPlanningChatResult | null = null;
  let dirty = false;
  function currentIndex(retryRead = false): AiPlanningChatIndex {
    if (phase === 'index-unavailable' && !retryRead) return unavailableIndex;
    if (!index) {
      const read = readAiPlanningChatIndex(ownerId);
      if (read.status === 'unavailable') { phase = 'index-unavailable'; return unavailableIndex; }
      hadStoredIndex = read.status === 'ready';
      index = immutableIndex(read.index);
      phase = 'uninitialized';
    }
    return index;
  }
  function initializationBlocked() { return phase === 'index-unavailable' || phase === 'snapshot-unavailable'; }
  function guard(): AiPlanningChatResult | null {
    if (!ports.isCurrent()) return { status: 'blocked', reason: 'owner-changed' };
    return ports.isBusy() ? { status: 'blocked', reason: 'busy' } : null;
  }
  function fail(reason: Extract<AiPlanningChatResult, { status: 'blocked' }>['reason']) {
    result = Object.freeze({ status: 'blocked', reason });
    dirty = dirty || !['target-unavailable', 'index-unavailable', 'initialization-unavailable'].includes(reason);
    ports.changed();
    return result;
  }
  function publish(next: AiPlanningChatIndex): AiPlanningChatResult {
    index = immutableIndex(next);
    dirty = false;
    result = Object.freeze({ status: 'saved' });
    ports.changed();
    return result;
  }
  function checkpoint(): AiPlanningChatResult {
    const blocked = guard(); if (blocked) return blocked;
    if (initializationBlocked()) return fail(phase === 'index-unavailable' ? 'index-unavailable' : 'initialization-unavailable');
    const current = currentIndex();
    if (!index) return fail('index-unavailable');
    // A caller is committing the live state, including authoritative empty state.
    // Never restore an older disk snapshot on a later view remount after this point.
    phase = 'ready';
    const snapshot = ports.exportSnapshot(true);
    if (!snapshot || snapshot.ownerId !== ownerId) return fail('snapshot-unavailable');
    if (!saveAiPlanningChatSnapshot(ownerId, current.activeChatId, snapshot)) return fail('snapshot-write-failed');
    const next = updateAiPlanningChatRecord(current, current.activeChatId, {
      title: deriveAiPlanningChatTitle(snapshot.planningState.messages),
      updatedAt: snapshot.savedAt, weekStartDate: snapshot.weekStartDate,
    });
    if (!saveAiPlanningChatIndex(ownerId, next)) return fail('index-write-failed');
    return publish(next);
  }
  function initialize(): AiPlanningChatResult {
    const blocked = guard(); if (blocked) return blocked;
    if (phase === 'ready') return result ?? { status: 'saved' };
    const current = currentIndex(true);
    if (!index) return fail('index-unavailable');
    const active = current.chats.find((chat) => chat.id === current.activeChatId)!;
    const snapshot = loadAiPlanningChatSnapshot(ownerId, active);
    if (snapshot) {
      const commit = ports.prepareImport(snapshot);
      if (!commit) { phase = 'snapshot-unavailable'; return fail('initialization-unavailable'); }
      phase = 'ready'; commit(); return publish(current);
    }
    if (active.weekStartDate !== null) { phase = 'snapshot-unavailable'; return fail('initialization-unavailable'); }
    phase = 'ready';
    if (!hadStoredIndex && ports.exportSnapshot(false)) return checkpoint();
    if (!saveAiPlanningChatIndex(ownerId, current)) return fail('index-write-failed');
    return publish(current);
  }
  function destination(chatId: string, next: AiPlanningChatIndex) {
    const chat = next.chats.find((candidate) => candidate.id === chatId);
    if (!chat) return null;
    if (chat.weekStartDate === null) return ports.prepareNew();
    const snapshot = loadAiPlanningChatSnapshot(ownerId, chat);
    return snapshot ? ports.prepareImport(snapshot) : null;
  }
  function navigate(kind: 'select' | 'create' | 'delete', chatId?: string): AiPlanningChatResult {
    const blocked = guard(); if (blocked) return blocked;
    if (initializationBlocked()) return fail(phase === 'index-unavailable' ? 'index-unavailable' : 'initialization-unavailable');
    const current = currentIndex();
    if (!index) return fail('index-unavailable');
    if (kind === 'select' && chatId === current.activeChatId) return { status: 'saved' };
    if (kind !== 'create' && !current.chats.some((chat) => chat.id === chatId)) return fail('target-unavailable');
    const prepared = kind === 'create' ? createAiPlanningChat(current).index
      : kind === 'delete' ? removeAiPlanningChatFromIndex(current, chatId!)
      : setActiveAiPlanningChat(current, chatId!);
    const replacing = prepared.activeChatId !== current.activeChatId;
    const commit = replacing ? destination(prepared.activeChatId, prepared) : () => {};
    if (!commit) return fail('target-unavailable');
    const saved = checkpoint();
    if (saved.status !== 'saved') return saved;
    // Preserve metadata updated by checkpoint; only selection/deletion/new record differs.
    const latest = currentIndex();
    const next = kind === 'create'
      ? { ...latest, activeChatId: prepared.activeChatId, chats: [prepared.chats[0], ...latest.chats] }
      : kind === 'delete'
        ? { ...prepared, chats: prepared.chats.map((chat) => latest.chats.find((item) => item.id === chat.id) ?? chat) }
        : setActiveAiPlanningChat(latest, chatId!);
    if (!saveAiPlanningChatIndex(ownerId, next)) return fail('index-write-failed');
    commit();
    if (kind === 'delete') removeAiPlanningChatSnapshot(ownerId, chatId!);
    return publish(next);
  }
  function startWithoutRestoring(): AiPlanningChatResult {
    const blocked = guard(); if (blocked) return blocked;
    if (phase !== 'snapshot-unavailable' || !index) return fail('target-unavailable');
    const commit = ports.prepareNew();
    if (!commit) return fail('target-unavailable');
    const next = createAiPlanningChat(index).index;
    if (!saveAiPlanningChatIndex(ownerId, next)) return fail('index-write-failed');
    phase = 'ready'; commit(); return publish(next);
  }
  return {
    get index() { return currentIndex(); },
    get result() { return result; },
    get dirty() { return dirty; },
    get requiresInitialization() { return initializationBlocked(); },
    get canStartWithoutRestoring() { return phase === 'snapshot-unavailable'; },
    initialize, checkpoint, startWithoutRestoring,
    retry: () => initializationBlocked() ? initialize() : checkpoint(),
    select: (chatId: string) => navigate('select', chatId),
    create: () => navigate('create'),
    remove: (chatId: string) => navigate('delete', chatId),
  };
}
export type AiPlanningChatSession = ReturnType<typeof createAiPlanningChatSession>;
