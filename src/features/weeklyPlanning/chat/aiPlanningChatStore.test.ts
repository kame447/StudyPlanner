import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { createInitialPlanningState, weeklyPlanningReducer } from '../weeklyPlanningReducer';
import {
  WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION,
} from '../application/weeklyPlanningStableV5SessionCodec';
import {
  createAiPlanningChat,
  deleteAiPlanningChat,
  loadAiPlanningChatIndex,
  loadAiPlanningChatSnapshot,
  saveAiPlanningChatIndex,
  saveAiPlanningChatSnapshot,
  searchAiPlanningChats,
  updateAiPlanningChatRecord,
} from './aiPlanningChatStore';

const USER_ID = 'chat-store-user';
const WEEK_START = '2026-08-17';

beforeEach(() => {
  window.localStorage.clear();
});

describe('AI planning chat store', () => {
  it('keeps separate chats and restores a Stable V5 snapshot', () => {
    const initial = loadAiPlanningChatIndex(USER_ID);
    const created = createAiPlanningChat(initial);
    const chat = created.chat;
    const conversationId = 'weekly-conversation-chat-store';
    const message = {
      id: `${conversationId}:turn:1:user`,
      role: 'user' as const,
      content: '線形代数の試験勉強を優先したい',
      createdAt: '2026-08-21T00:00:00.000Z',
    };
    const planningState = weeklyPlanningReducer(createInitialPlanningState(WEEK_START), {
      type: 'append_message',
      message,
    });
    const snapshot = {
      version: WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION,
      ownerId: USER_ID,
      weekStartDate: WEEK_START,
      conversationId,
      graph: createEmptyWeeklyPlanningFactGraphV5(),
      planningState,
      savedAt: '2026-08-21T00:01:00.000Z',
    };

    expect(saveAiPlanningChatSnapshot(USER_ID, chat.id, snapshot)).toBe(true);
    const indexed = updateAiPlanningChatRecord(created.index, chat.id, {
      title: '線形代数の試験勉強',
      weekStartDate: WEEK_START,
    });
    saveAiPlanningChatIndex(USER_ID, indexed);

    const reloadedIndex = loadAiPlanningChatIndex(USER_ID);
    expect(reloadedIndex.chats).toHaveLength(2);
    const reloadedChat = reloadedIndex.chats.find((item) => item.id === chat.id);
    expect(reloadedChat).toBeDefined();
    const restored = loadAiPlanningChatSnapshot(USER_ID, reloadedChat!);
    expect(restored?.conversationId).toBe(conversationId);
    expect(restored?.planningState.messages[0]?.content).toBe(message.content);
    expect(searchAiPlanningChats(USER_ID, reloadedIndex.chats, '線形代数')).toEqual([
      expect.objectContaining({ id: chat.id }),
    ]);
  });

  it('deletes one chat without removing the remaining chat', () => {
    const initial = loadAiPlanningChatIndex(USER_ID);
    const created = createAiPlanningChat(initial);
    const next = deleteAiPlanningChat(USER_ID, created.index, created.chat.id);

    expect(next.chats).toHaveLength(1);
    expect(next.chats[0]?.id).toBe(initial.chats[0]?.id);
    expect(next.activeChatId).toBe(initial.chats[0]?.id);
  });
});
