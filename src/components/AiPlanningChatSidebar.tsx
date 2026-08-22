import { MessageCircle, Plus, RotateCcw, Search, Trash2, TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';
import type { AiPlanningChatRecord } from '../features/weeklyPlanning/chat/aiPlanningChatStore';
import './AiPlanningChatSidebar.css';

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
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);

  if (!open) return null;

  function closeDrawer() {
    setIsResetConfirmOpen(false);
    onClose();
  }

  function resetWeeklyPlan() {
    if (disabled) return;
    setIsResetConfirmOpen(false);
    onCreate();
  }

  return (
    <div className="ai-chat-drawer-layer" role="presentation" onClick={closeDrawer}>
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
          <button type="button" onClick={closeDrawer} aria-label="チャット一覧を閉じる">
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

        <div className="ai-chat-week-reset-zone">
          <button
            className="ai-chat-week-reset-button"
            type="button"
            disabled={disabled}
            onClick={() => setIsResetConfirmOpen(true)}
          >
            <RotateCcw aria-hidden="true" size={18} />
            <span>
              <strong>週間計画をリセット</strong>
              <small>過去のチャット履歴は残ります</small>
            </span>
          </button>
        </div>
      </aside>

      {isResetConfirmOpen ? (
        <div
          className="ai-week-reset-confirm-layer"
          role="presentation"
          onClick={(event) => {
            event.stopPropagation();
            setIsResetConfirmOpen(false);
          }}
        >
          <section
            className="ai-week-reset-confirm-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-week-reset-title"
            aria-describedby="ai-week-reset-description"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="ai-week-reset-confirm-handle" aria-hidden="true" />
            <div className="ai-week-reset-confirm-icon" aria-hidden="true">
              <TriangleAlert size={22} />
            </div>
            <div className="ai-week-reset-confirm-copy">
              <h2 id="ai-week-reset-title">今週の計画をリセットしますか？</h2>
              <p id="ai-week-reset-description">
                現在の計画案と入力途中の週間計画を破棄して、新しいチャットからやり直します。過去のチャット履歴、保存済みの予定、学習記録は削除されません。
              </p>
            </div>
            <div className="ai-week-reset-confirm-actions">
              <button
                className="ai-week-reset-cancel"
                type="button"
                onClick={() => setIsResetConfirmOpen(false)}
              >
                キャンセル
              </button>
              <button
                className="ai-week-reset-confirm"
                type="button"
                disabled={disabled}
                onClick={resetWeeklyPlan}
              >
                <RotateCcw aria-hidden="true" size={17} />
                リセット
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
