import { MessageCircle, Plus, Search, Trash2, X } from 'lucide-react';
import type { AiPlanningChatRecord } from '../features/weeklyPlanning/chat/aiPlanningChatStore';

interface AiPlanningChatSidebarProps {
  open: boolean;
  chats: readonly AiPlanningChatRecord[];
  activeChatId: string;
  query: string;
  disabled?: boolean;
  onQueryChange: (query: string) => void;
  onCreate: () => void;
  onSelect: (chatId: string) => void;
  onDelete: (chatId: string) => void;
  onClose: () => void;
}

function formatUpdatedAt(timestamp: string): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function AiPlanningChatSidebar({
  open,
  chats,
  activeChatId,
  query,
  disabled = false,
  onQueryChange,
  onCreate,
  onSelect,
  onDelete,
  onClose,
}: AiPlanningChatSidebarProps) {
  if (!open) return null;

  return (
    <div className="ai-chat-drawer-layer" role="presentation" onClick={onClose}>
      <aside
        className="ai-chat-drawer"
        aria-label="AI計画のチャット"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="ai-chat-drawer-header">
          <div>
            <MessageCircle aria-hidden="true" size={21} />
            <strong>AI計画</strong>
          </div>
          <button type="button" onClick={onClose} aria-label="チャット一覧を閉じる">
            <X aria-hidden="true" size={20} />
          </button>
        </header>

        <button
          className="ai-chat-new-button"
          type="button"
          disabled={disabled}
          onClick={onCreate}
        >
          <Plus aria-hidden="true" size={19} />
          新しいチャット
        </button>

        <label className="ai-chat-search">
          <Search aria-hidden="true" size={18} />
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="チャットを検索"
            aria-label="チャットを検索"
          />
        </label>

        <div className="ai-chat-list" aria-label="チャット履歴">
          {chats.length > 0 ? (
            chats.map((chat) => (
              <div
                className={chat.id === activeChatId ? 'ai-chat-row active' : 'ai-chat-row'}
                key={chat.id}
              >
                <button
                  className="ai-chat-select"
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelect(chat.id)}
                  aria-current={chat.id === activeChatId ? 'page' : undefined}
                >
                  <MessageCircle aria-hidden="true" size={17} />
                  <span>
                    <strong>{chat.title}</strong>
                    <small>{formatUpdatedAt(chat.updatedAt)}</small>
                  </span>
                </button>
                <button
                  className="ai-chat-delete"
                  type="button"
                  disabled={disabled}
                  onClick={() => onDelete(chat.id)}
                  aria-label={`${chat.title}を削除`}
                >
                  <Trash2 aria-hidden="true" size={16} />
                </button>
              </div>
            ))
          ) : (
            <p className="ai-chat-empty">一致するチャットはありません。</p>
          )}
        </div>
      </aside>
    </div>
  );
}
