import { useEffect, useState } from 'react';
import { createEmptyPlanDraft } from '../domain/planner';
import { minutesBetween } from '../lib/date';
import { NaturalLanguageAssistant } from './NaturalLanguageAssistant';
import { PlanFieldsEditor } from './PlanFieldsEditor';
import type { Plan, PlanDraft } from '../types/domain';

type DayPlanInputMode = 'manual' | 'ai';

interface DayPlanInputPanelProps {
  selectedDate: string;
  userId: string;
  plans: Plan[];
  mode: DayPlanInputMode;
  onModeChange: (mode: DayPlanInputMode) => void;
  onApplyDraft: (draft: PlanDraft, targetPlanId?: string) => Promise<void>;
  onClose: () => void;
  embedded?: boolean;
}

export function DayPlanInputPanel({
  selectedDate,
  userId,
  plans,
  mode,
  onModeChange,
  onApplyDraft,
  onClose,
  embedded = false,
}: DayPlanInputPanelProps) {
  const [draft, setDraft] = useState<PlanDraft>(() =>
    createEmptyPlanDraft(userId, selectedDate),
  );
  const [status, setStatus] = useState('');

  useEffect(() => {
    setDraft(createEmptyPlanDraft(userId, selectedDate));
    setStatus('');
  }, [selectedDate, userId]);

  const hasInvalidTime = minutesBetween(draft.startTime, draft.endTime) <= 0;

  async function handleManualSubmit() {
    if (hasInvalidTime || !draft.title.trim()) {
      return;
    }

    await onApplyDraft(draft);
    setDraft(createEmptyPlanDraft(userId, selectedDate));
    setStatus('予定を追加しました。');
  }

  const content = (
    <>
      <div className="section-header">
        <div>
          <h2>予定入力</h2>
          <p>手入力とAI入力を切り替えて、その日の予定を追加できます。</p>
        </div>
        <button className="ghost-button" onClick={onClose} type="button">
          閉じる
        </button>
      </div>

      <div className="segmented-control">
        <button
          className={mode === 'manual' ? 'segment active' : 'segment'}
          onClick={() => onModeChange('manual')}
          type="button"
        >
          手入力で追加
        </button>
        <button
          className={mode === 'ai' ? 'segment active' : 'segment'}
          onClick={() => onModeChange('ai')}
          type="button"
        >
          AI入力補助
        </button>
      </div>

      {mode === 'manual' ? (
        <div className="section-stack">
          <PlanFieldsEditor draft={draft} onChange={setDraft} />

          {hasInvalidTime ? (
            <p className="inline-error">終了時刻は開始時刻より後にしてください。</p>
          ) : null}
          {status ? <p className="inline-note">{status}</p> : null}

          <div className="row-actions">
            <button
              className="ghost-button"
              onClick={() => setDraft(createEmptyPlanDraft(userId, selectedDate))}
              type="button"
            >
              リセット
            </button>
            <button
              className="primary-button"
              onClick={() => void handleManualSubmit()}
              type="button"
              disabled={hasInvalidTime || !draft.title.trim()}
            >
              予定を追加
            </button>
          </div>
        </div>
      ) : (
        <NaturalLanguageAssistant
          selectedDate={selectedDate}
          userId={userId}
          plans={plans}
          onApplyDraft={onApplyDraft}
          embedded
        />
      )}
    </>
  );

  if (embedded) {
    return <div className="section-stack">{content}</div>;
  }

  return <section className="panel section-stack">{content}</section>;
}
