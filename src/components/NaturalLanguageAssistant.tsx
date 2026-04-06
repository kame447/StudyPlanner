import { useState } from 'react';
import { sortByDateTime } from '../lib/date';
import { PlanFieldsEditor } from './PlanFieldsEditor';
import { generateNaturalLanguageSuggestion } from '../services/naturalLanguagePlanner';
import type {
  NaturalLanguageMode,
  NaturalLanguageSuggestion,
  Plan,
  PlanDraft,
} from '../types/domain';

interface NaturalLanguageAssistantProps {
  selectedDate: string;
  userId: string;
  plans: Plan[];
  onApplyDraft: (draft: PlanDraft, targetPlanId?: string) => Promise<void>;
}

export function NaturalLanguageAssistant({
  selectedDate,
  userId,
  plans,
  onApplyDraft,
}: NaturalLanguageAssistantProps) {
  const [mode, setMode] = useState<NaturalLanguageMode>('add');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [suggestion, setSuggestion] = useState<NaturalLanguageSuggestion | null>(null);
  const [targetPlanId, setTargetPlanId] = useState('');

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

  function handleAnalyze() {
    if (!text.trim()) {
      setError('自然言語の入力内容を入れてください。');
      return;
    }

    const nextSuggestion = generateNaturalLanguageSuggestion({
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

  return (
    <section className="panel section-stack">
      <div className="section-header">
        <div>
          <h2>AI入力補助</h2>
          <p>自然言語から追加案または修正案を作り、確認して反映します。</p>
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

      <button className="primary-button" onClick={handleAnalyze} type="button">
        叩き台を作る
      </button>

      {error ? <p className="inline-error">{error}</p> : null}
      {status ? <p className="inline-note">{status}</p> : null}

      {suggestion ? (
        <div className="suggestion-card">
          <div className="label-row">
            <strong>AI提案</strong>
            <span className="confidence-badge">
              推定 {Math.round(suggestion.confidence * 100)}%
            </span>
          </div>
          <p className="detail-note">{suggestion.reason}</p>

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
            >
              {suggestion.mode === 'edit' ? '修正として反映' : '追加として反映'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
