import type { WeeklyPlanningMessage } from '../features/weeklyPlanning/types';

interface WeeklyPlanningConversationProps {
  messages: readonly WeeklyPlanningMessage[];
  isAnalyzing: boolean;
}

export function WeeklyPlanningConversation({
  messages,
  isAnalyzing,
}: WeeklyPlanningConversationProps) {
  return (
    <div className="section-stack">
      <div className="assistant-feedback-card" aria-label="週間計画AIの実行方式">
        <div className="label-row">
          <strong>週間計画AI</strong>
          <span className="confidence-badge">Stable V5</span>
        </div>
        <p className="detail-note">
          発話の意味構造化、質問選択、予定配置、訂正、承認をStable V5経路で処理します。
        </p>
      </div>

      {messages.length > 0 || isAnalyzing ? (
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
      ) : null}
    </div>
  );
}
