import { useState } from 'react';
import {
  getAiConfig,
  getAiConfigValidationMessage,
  resetAiConfig,
  saveAiConfig,
  type AiConfig,
} from '../lib/aiConfig';
import { sortByDateTime } from '../lib/date';
import { AiRuntimeSettings } from './AiRuntimeSettings';
import { PlanFieldsEditor } from './PlanFieldsEditor';
import {
  generateNaturalLanguageSuggestion,
  getPlannerAiRuntimeInfo,
} from '../services/naturalLanguagePlanner';
import type {
  NaturalLanguageMode,
  NaturalLanguageSuggestion,
  Plan,
  PlanDraft,
  SuggestionField,
} from '../types/domain';

interface NaturalLanguageAssistantProps {
  selectedDate: string;
  userId: string;
  plans: Plan[];
  onApplyDraft: (draft: PlanDraft, targetPlanId?: string) => Promise<void>;
  embedded?: boolean;
}

const FIELD_LABELS: Record<SuggestionField, string> = {
  targetPlan: '修正対象',
  date: '日付',
  startTime: '開始時刻',
  endTime: '終了時刻',
  subject: '科目',
  type: '種別',
  title: '予定名',
  memo: 'メモ',
};

const STATUS_LABELS = {
  ready: '反映可',
  needs_review: '要確認',
  failed: '反映不可',
} as const;

const ISSUE_LABELS: Record<string, string> = {
  ai_unavailable: 'AIに接続できませんでした',
  model_output_unusable: 'モデル出力が不安定で採用できませんでした',
  date_format_invalid: '日付の形式が不正です',
  date_hallucinated: '入力文にない日付が出力されました',
  start_time_invalid: '開始時刻の形式が不正です',
  end_time_invalid: '終了時刻の形式が不正です',
  time_reversed: '終了時刻が開始時刻より前になっています',
  start_time_conflicts_with_input: '開始時刻が入力文と矛盾しています',
  end_time_conflicts_with_input: '終了時刻が入力文と矛盾しています',
  title_not_grounded: '予定名に入力文にない内容が含まれています',
  memo_not_grounded: 'メモに入力文にない内容が含まれています',
  subject_not_grounded: '科目推定が入力文と一致していません',
};

export function NaturalLanguageAssistant({
  selectedDate,
  userId,
  plans,
  onApplyDraft,
  embedded = false,
}: NaturalLanguageAssistantProps) {
  const [aiConfig, setAiConfig] = useState<AiConfig>(() => getAiConfig());
  const [mode, setMode] = useState<NaturalLanguageMode>('add');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [suggestion, setSuggestion] = useState<NaturalLanguageSuggestion | null>(null);
  const [targetPlanId, setTargetPlanId] = useState('');
  const runtimeInfo = getPlannerAiRuntimeInfo(aiConfig);
  const configError = getAiConfigValidationMessage(aiConfig);

  const nearbyPlans = plans.filter((plan) => {
    const deltaDays =
      Math.abs(
        new Date(`${plan.date}T00:00:00`).getTime() -
          new Date(`${selectedDate}T00:00:00`).getTime(),
      ) /
      (1000 * 60 * 60 * 24);

    return deltaDays <= 7;
  });
  const candidatePlans = sortByDateTime(nearbyPlans.length > 0 ? nearbyPlans : plans);
  const canApply =
    suggestion !== null &&
    suggestion.status !== 'failed' &&
    suggestion.parsedPlan.title.trim().length > 0 &&
    suggestion.parsedPlan.date.trim().length > 0 &&
    suggestion.parsedPlan.startTime.trim().length > 0 &&
    suggestion.parsedPlan.endTime.trim().length > 0 &&
    (suggestion.mode !== 'edit' || targetPlanId.trim().length > 0);

  async function handleAnalyze() {
    if (!text.trim()) {
      setError('自然言語の入力内容を入れてください。');
      return;
    }

    if (configError) {
      setError(configError);
      return;
    }

    setIsAnalyzing(true);

    try {
      const nextSuggestion = await generateNaturalLanguageSuggestion({
        mode,
        text,
        selectedDate,
        plans,
        userId,
      });

      setError('');
      setStatus('');
      setSuggestion(nextSuggestion);
      setTargetPlanId(nextSuggestion.matchedPlanId ?? '');
    } catch {
      setError('提案の生成に失敗しました。');
    } finally {
      setIsAnalyzing(false);
    }
  }

  function handleSaveAiConfig(nextConfig: AiConfig) {
    const savedConfig = saveAiConfig(nextConfig);
    setAiConfig(savedConfig);
    setSuggestion(null);
    setError('');
    setStatus('AI接続設定を反映しました。');
  }

  function handleResetAiConfig() {
    const resetConfig = resetAiConfig();
    setAiConfig(resetConfig);
    setSuggestion(null);
    setError('');
    setStatus('AI接続設定を初期値へ戻しました。');
  }

  async function handleApply() {
    if (!suggestion) {
      return;
    }

    if (suggestion.mode === 'edit' && !targetPlanId) {
      setError('修正対象の予定を選んでください。');
      return;
    }

    setError('');
    await onApplyDraft(
      suggestion.parsedPlan,
      suggestion.mode === 'edit' ? targetPlanId : undefined,
    );
    setStatus('提案を反映しました。');
    setText('');
    setSuggestion(null);
  }

  const content = (
    <>
      <div className="section-header">
        <div>
          <h2>AI入力補助</h2>
          <p>自然言語から追加案または修正案を作り、確認して反映します。</p>
        </div>
        <div className="assistant-runtime">
          <span className="confidence-badge">{runtimeInfo.providerLabel}</span>
          <span className="assistant-runtime-help">{runtimeInfo.fallbackLabel}</span>
        </div>
      </div>

      <div className="segmented-control">
        <button
          className={mode === 'add' ? 'segment active' : 'segment'}
          onClick={() => setMode('add')}
          type="button"
        >
          追加案
        </button>
        <button
          className={mode === 'edit' ? 'segment active' : 'segment'}
          onClick={() => setMode('edit')}
          type="button"
        >
          修正案
        </button>
      </div>

      <AiRuntimeSettings
        config={aiConfig}
        onSave={handleSaveAiConfig}
        onReset={handleResetAiConfig}
      />

      <label className="field field-full">
        <span>自然言語入力</span>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={4}
          placeholder={
            mode === 'add'
              ? '例: 明日18時から20時で英語の勉強を追加'
              : '例: 数学の勉強を19時半開始に変更'
          }
        />
      </label>

      <button
        className="primary-button"
        onClick={() => void handleAnalyze()}
        type="button"
        disabled={isAnalyzing}
      >
        {isAnalyzing ? '解析中...' : '叩き台を作る'}
      </button>

      {error ? <p className="inline-error">{error}</p> : null}
      {status ? <p className="inline-note">{status}</p> : null}

      {suggestion ? (
        <div className="suggestion-card">
          <div className="label-row">
            <strong>AI提案</strong>
            <span className="confidence-badge">
              {suggestion.providerLabel} / {STATUS_LABELS[suggestion.status]} / 推定 {Math.round(suggestion.confidence * 100)}%
            </span>
          </div>
          <p className="detail-note">{suggestion.reason}</p>

          {suggestion.issues.length > 0 ? (
            <div className="assistant-feedback-card warning">
              <strong>検出した問題</strong>
              <ul className="assistant-feedback-list">
                {suggestion.issues.map((issue) => (
                  <li key={issue}>{ISSUE_LABELS[issue] ?? issue}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {suggestion.assumptions.length > 0 ? (
            <div className="assistant-feedback-card">
              <strong>AIの補足</strong>
              <ul className="assistant-feedback-list">
                {suggestion.assumptions.map((assumption) => (
                  <li key={assumption}>{assumption}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {suggestion.unresolvedFields.length > 0 ? (
            <div className="assistant-feedback-card warning">
              <strong>未確定の項目</strong>
              <p className="detail-note">
                {suggestion.unresolvedFields.map((field) => FIELD_LABELS[field]).join(' / ')}
              </p>
            </div>
          ) : null}

          {suggestion.mode === 'edit' ? (
            <label className="field field-full">
              <span>修正対象</span>
              <select
                value={targetPlanId}
                onChange={(event) => setTargetPlanId(event.target.value)}
              >
                <option value="">予定を選ぶ</option>
                {candidatePlans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.date} {plan.title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <PlanFieldsEditor
            draft={suggestion.parsedPlan}
            onChange={(draft) =>
              setSuggestion({
                ...suggestion,
                parsedPlan: draft,
              })
            }
          />

          <div className="row-actions">
            <button
              className="ghost-button"
              onClick={() => setSuggestion(null)}
              type="button"
            >
              破棄
            </button>
            <button
              className="primary-button"
              onClick={() => void handleApply()}
              type="button"
              disabled={!canApply}
            >
              {suggestion.mode === 'edit' ? '修正として反映' : '追加として反映'}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );

  if (embedded) {
    return <div className="section-stack">{content}</div>;
  }

  return <section className="panel section-stack">{content}</section>;
}
