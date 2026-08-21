import type { WeeklyPlanningMessage } from '../types';
import {
  largestWeeklyPlanningStableV5Checkpoint,
  parseWeeklyPlanningStableV5PersistedSession,
  type WeeklyPlanningStableV5PersistedSession,
} from '../application/weeklyPlanningStableV5SessionCodec';

const CHAT_INDEX_VERSION = 1 as const;
const TITLE_MAX_LENGTH = 32;
const SEARCH_TEXT_MAX_LENGTH = 12_000;

export interface AiPlanningChatRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  weekStartDate: string | null;
}

export interface AiPlanningChatIndex {
  version: typeof CHAT_INDEX_VERSION;
  activeChatId: string;
  chats: AiPlanningChatRecord[];
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `ai-chat-${crypto.randomUUID()}`;
  }
  return `ai-chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function indexKey(userId: string): string {
  return `studyplanner.aiPlanning.chats.v1.${userId}`;
}

function snapshotKey(userId: string, chatId: string): string {
  return `studyplanner.aiPlanning.chat.v1.${userId}.${chatId}`;
}

function searchTextKey(userId: string, chatId: string): string {
  return `studyplanner.aiPlanning.chatSearch.v1.${userId}.${chatId}`;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isChatRecord(value: unknown): value is AiPlanningChatRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string'
    && record.id.startsWith('ai-chat-')
    && typeof record.title === 'string'
    && isTimestamp(record.createdAt)
    && isTimestamp(record.updatedAt)
    && (record.weekStartDate === null
      || (typeof record.weekStartDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.weekStartDate)));
}

function createBlankRecord(now = new Date().toISOString()): AiPlanningChatRecord {
  return {
    id: createId(),
    title: '新しいチャット',
    createdAt: now,
    updatedAt: now,
    weekStartDate: null,
  };
}

function createBlankIndex(): AiPlanningChatIndex {
  const chat = createBlankRecord();
  return {
    version: CHAT_INDEX_VERSION,
    activeChatId: chat.id,
    chats: [chat],
  };
}

function deriveSearchText(messages: readonly WeeklyPlanningMessage[]): string {
  const text = messages
    .map((message) => message.content.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return text.length > SEARCH_TEXT_MAX_LENGTH
    ? text.slice(text.length - SEARCH_TEXT_MAX_LENGTH)
    : text;
}

export function loadAiPlanningChatIndex(userId: string): AiPlanningChatIndex {
  if (typeof window === 'undefined') return createBlankIndex();
  try {
    const raw = window.localStorage.getItem(indexKey(userId));
    if (!raw) return createBlankIndex();
    const parsed = JSON.parse(raw) as Partial<AiPlanningChatIndex>;
    if (
      parsed.version !== CHAT_INDEX_VERSION
      || typeof parsed.activeChatId !== 'string'
      || !Array.isArray(parsed.chats)
    ) {
      return createBlankIndex();
    }
    const chats = parsed.chats.filter(isChatRecord);
    if (chats.length === 0) return createBlankIndex();
    const activeChatId = chats.some((chat) => chat.id === parsed.activeChatId)
      ? parsed.activeChatId
      : chats[0].id;
    return { version: CHAT_INDEX_VERSION, activeChatId, chats };
  } catch {
    return createBlankIndex();
  }
}

export function hasStoredAiPlanningChatIndex(userId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(indexKey(userId)) !== null;
  } catch {
    return false;
  }
}

export function saveAiPlanningChatIndex(userId: string, index: AiPlanningChatIndex): void {
  if (typeof window === 'undefined') return;
  const chats = [...index.chats]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const activeChatId = chats.some((chat) => chat.id === index.activeChatId)
    ? index.activeChatId
    : chats[0]?.id ?? '';
  try {
    window.localStorage.setItem(indexKey(userId), JSON.stringify({
      version: CHAT_INDEX_VERSION,
      activeChatId,
      chats,
    } satisfies AiPlanningChatIndex));
  } catch {
    // Chat navigation remains usable in memory when browser storage is unavailable.
  }
}

export function createAiPlanningChat(index: AiPlanningChatIndex): {
  index: AiPlanningChatIndex;
  chat: AiPlanningChatRecord;
} {
  const chat = createBlankRecord();
  return {
    chat,
    index: {
      version: CHAT_INDEX_VERSION,
      activeChatId: chat.id,
      chats: [chat, ...index.chats],
    },
  };
}

export function setActiveAiPlanningChat(
  index: AiPlanningChatIndex,
  chatId: string,
): AiPlanningChatIndex {
  if (!index.chats.some((chat) => chat.id === chatId)) return index;
  return { ...index, activeChatId: chatId };
}

export function updateAiPlanningChatRecord(
  index: AiPlanningChatIndex,
  chatId: string,
  update: Partial<Pick<AiPlanningChatRecord, 'title' | 'updatedAt' | 'weekStartDate'>>,
): AiPlanningChatIndex {
  return {
    ...index,
    chats: index.chats.map((chat) => chat.id === chatId ? { ...chat, ...update } : chat),
  };
}

export function deleteAiPlanningChat(
  userId: string,
  index: AiPlanningChatIndex,
  chatId: string,
): AiPlanningChatIndex {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(snapshotKey(userId, chatId));
      window.localStorage.removeItem(searchTextKey(userId, chatId));
    } catch {
      // Best effort cleanup.
    }
  }
  const remaining = index.chats.filter((chat) => chat.id !== chatId);
  if (remaining.length === 0) return createBlankIndex();
  return {
    ...index,
    activeChatId: index.activeChatId === chatId ? remaining[0].id : index.activeChatId,
    chats: remaining,
  };
}

export function saveAiPlanningChatSnapshot(
  userId: string,
  chatId: string,
  snapshot: WeeklyPlanningStableV5PersistedSession,
): boolean {
  if (typeof window === 'undefined') return false;
  const checkpoint = largestWeeklyPlanningStableV5Checkpoint({
    ownerId: snapshot.ownerId,
    weekStartDate: snapshot.weekStartDate,
    conversationId: snapshot.conversationId,
    graph: snapshot.graph,
    planningState: snapshot.planningState,
    savedAt: new Date().toISOString(),
  });
  if (!checkpoint) return false;
  try {
    window.localStorage.setItem(snapshotKey(userId, chatId), checkpoint.raw);
    try {
      window.localStorage.setItem(
        searchTextKey(userId, chatId),
        deriveSearchText(snapshot.planningState.messages),
      );
    } catch {
      // Search cache is optional; the validated snapshot remains authoritative.
    }
    return true;
  } catch {
    return false;
  }
}

export function loadAiPlanningChatSnapshot(
  userId: string,
  chat: AiPlanningChatRecord,
): WeeklyPlanningStableV5PersistedSession | null {
  if (typeof window === 'undefined' || !chat.weekStartDate) return null;
  try {
    const raw = window.localStorage.getItem(snapshotKey(userId, chat.id));
    if (!raw) return null;
    return parseWeeklyPlanningStableV5PersistedSession({
      raw,
      ownerId: userId,
      weekStartDate: chat.weekStartDate,
    });
  } catch {
    return null;
  }
}

export function deriveAiPlanningChatTitle(messages: readonly WeeklyPlanningMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === 'user')?.content
    .replace(/\s+/g, ' ')
    .trim();
  if (!firstUserMessage) return '新しいチャット';
  return firstUserMessage.length > TITLE_MAX_LENGTH
    ? `${firstUserMessage.slice(0, TITLE_MAX_LENGTH)}…`
    : firstUserMessage;
}

export function searchAiPlanningChats(
  userId: string,
  chats: readonly AiPlanningChatRecord[],
  query: string,
): AiPlanningChatRecord[] {
  const normalizedQuery = query.trim().toLocaleLowerCase('ja-JP');
  if (!normalizedQuery) return [...chats];
  return chats.filter((chat) => {
    if (chat.title.toLocaleLowerCase('ja-JP').includes(normalizedQuery)) return true;
    let searchable = '';
    try {
      searchable = window.localStorage.getItem(searchTextKey(userId, chat.id)) ?? '';
    } catch {
      searchable = '';
    }
    if (searchable.toLocaleLowerCase('ja-JP').includes(normalizedQuery)) return true;
    if (searchable) return false;
    const snapshot = loadAiPlanningChatSnapshot(userId, chat);
    if (!snapshot) return false;
    const fallback = deriveSearchText(snapshot.planningState.messages);
    try {
      window.localStorage.setItem(searchTextKey(userId, chat.id), fallback);
    } catch {
      // Search still works for this invocation without caching.
    }
    return fallback.toLocaleLowerCase('ja-JP').includes(normalizedQuery);
  });
}
