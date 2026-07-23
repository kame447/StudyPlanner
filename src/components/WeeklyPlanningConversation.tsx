import { useEffect, useState } from 'react';
import {
  getWeeklyPlanningRuntimeMode,
  setWeeklyPlanningRuntimeMode,
  WEEKLY_PLANNING_RUNTIME_MODE_CHANGE_EVENT,
  type WeeklyPlanningRuntimeMode,
} from '../features/weeklyPlanning/application/weeklyPlanningRuntimeMode';
import type { WeeklyPlanningMessage } from '../features/weeklyPlanning/types';

interface WeeklyPlanningConversationProps {
  messages: readonly WeeklyPlanningMessage[];
  isAnalyzing: boolean;
}

const RUNTIME_LABELS: Record<WeeklyPlanningRuntimeMode, string> = {
  legacy: '現行方式',
  stable_v5: 'Stable V5',
};

export function WeeklyPlanningConversation({
  messages,
  isAnalyzing,
}: WeeklyPlanningConversationProps) {
  const [runtimeMode, setRuntimeModeState] = useState<WeeklyPlanningRuntimeMode>(() =>
    getWeeklyPlanningRuntimeMode(),
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const syncRuntimeMode = () => setRuntimeModeState(getWeeklyPlanningRuntimeMode());
    window.addEventListener(WEEKLY_PLANNING_RUNTIME_MODE_CHANGE_EVENT, syncRuntimeMode);
    return () => window.removeEventListener(
      WEEKLY_PLANNING_RUNTIME_MODE_CHANGE_EVENT,
      syncRuntimeMode,
    );
  }, []);

  function changeRuntimeMode(nextMode: WeeklyPlanningRuntimeMode): void {
    if (nextMode === runtimeMode || isAnalyzing) return;
    if (
      messages.length > 0
      && typeof window !== 'undefined'
      && !window.confirm(
        '実行方式を切り替えると、現在の週間計画の会話と未保存previewを初期化します。切り替えますか？',
      )
    ) {
      return;
    }

    setWeeklyPlanningRuntimeMode(nextMode);
    setRuntimeModeState(getWeeklyPlanningRuntimeMode());
  }

  return (
    <div className="section-stack">
      <div className="assistant-feedback-card" aria-label="週間計画AIの実行方式">
        <div className="label-row">
          <strong>週間計画AIの実行方式</strong>
          <span className="confidence-badge">現在実行中: {RUNTIME_LABELS[runtimeMode]}</span>
        </div>
        <div
          className="segmented-control"
          role="radiogroup"
          aria-label="週間計画AIの実行方式を選択"
        >
          <button
            aria-checked={runtimeMode === 'legacy'}
            className={runtimeMode === 'legacy' ? 'segment active' : 'segment'}
            disabled={isAnalyzing}
            onClick={() => changeRuntimeMode('legacy')}
            role="radio"
            type="button"
          >
            現行方式
          </button>
          <button
            aria-checked={runtimeMode === 'stable_v5'}
            className={runtimeMode === 'stable_v5' ? 'segment active' : 'segment'}
            disabled={isAnalyzing}
            onClick={() => changeRuntimeMode('stable_v5')}
            role="radio"
            type="button"
          >
            Stable V5
          </button>
        </div>
        <p className="detail-note">
          Stable V5では、AIが意味構造だけを作り、質問選択と予定配置はアプリ側が決定します。切替時は新旧の状態を混在させないため会話を初期化します。
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
