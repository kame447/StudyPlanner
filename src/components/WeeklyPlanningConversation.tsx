import type { WeeklyPlanningMessage } from '../features/weeklyPlanning/types';

interface WeeklyPlanningConversationProps {
  messages: readonly WeeklyPlanningMessage[];
  isAnalyzing: boolean;
}

export function WeeklyPlanningConversation({
  messages,
  isAnalyzing,
}: WeeklyPlanningConversationProps) {
  if (messages.length === 0 && !isAnalyzing) return null;

  return (
    <div className="weekly-planning-chat-log" aria-label="週間計画の会話履歴">
      {messages.map((message) => (
        <div
          className={`weekly-planning-chat-message weekly-planning-chat-message--${message.role}`}
          key={message.id}
        >
          <strong>{message.role === 'user' ? 'あなた' : 'アプリ'}</strong>
          <p>{message.content}</p>
        </div>
      ))}
      {isAnalyzing ? (
        <div
          className="weekly-planning-chat-message weekly-planning-chat-message--assistant weekly-planning-chat-message--typing"
          role="status"
          aria-label="アプリが回答を作成中"
        >
          <strong>アプリ</strong>
          <span className="weekly-planning-typing-indicator" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </div>
      ) : null}
    </div>
  );
}
